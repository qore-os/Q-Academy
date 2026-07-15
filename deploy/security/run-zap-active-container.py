#!/usr/bin/env python3
"""Run the authenticated ZAP plan without exporting credentials or raw traffic."""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

OWNER_FILE = Path("/run/secrets/owner.json")
MEMBER_FILE = Path("/run/secrets/member.json")
PLAN_FILE = Path("/tmp/zap-active-plan.json")
OPENAPI_FILE = Path("/tmp/q-academy-openapi.json")
RAW_REPORT_FILE = Path("/tmp/raw-zap-report.json")
SAFE_REPORT_FILE = Path("/evidence/scanner-result.json")
ZAP_HOME = Path("/tmp/.ZAP")
RISK_NAMES = {"0": "Informational", "1": "Low", "2": "Medium", "3": "High"}


class ContractError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ContractError("openapi_redirect_forbidden")


def parse_args():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--max-requests", required=True, type=int)
    parser.add_argument("--spider-minutes", required=True, type=int)
    parser.add_argument("--browser-spider-minutes", required=True, type=int)
    parser.add_argument("--active-scan-minutes", required=True, type=int)
    return parser.parse_args()


def read_credentials(path, project):
    try:
        raw = path.read_bytes()
        if len(raw) > 4096:
            raise ContractError("credential_file_too_large")
        value = json.loads(raw)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ContractError("credential_file_invalid") from error
    expected_keys = {"email", "password", "organizationSlug"}
    if not isinstance(value, dict) or set(value) != expected_keys:
        raise ContractError("credential_schema_invalid")
    if not isinstance(value["email"], str) or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value["email"]):
        raise ContractError("credential_email_invalid")
    if not isinstance(value["password"], str) or not 16 <= len(value["password"]) <= 512:
        raise ContractError("credential_password_invalid")
    if any(ord(character) < 32 for character in value["password"]):
        raise ContractError("credential_password_invalid")
    if value["organizationSlug"] != project:
        raise ContractError("credential_project_mismatch")
    return value


def fetch_openapi(origin, max_requests):
    request = urllib.request.Request(
        origin + "/api/v1/openapi",
        headers={"Accept": "application/json", "User-Agent": "q-academy-active-dast/1"},
        method="GET",
    )
    try:
        response = urllib.request.build_opener(NoRedirect).open(request, timeout=15)
        if response.status != 200:
            raise ContractError("openapi_status_invalid")
        raw = response.read(1_048_577)
    except ContractError:
        raise
    except (OSError, urllib.error.URLError) as error:
        raise ContractError("openapi_fetch_failed") from error
    if len(raw) > 1_048_576:
        raise ContractError("openapi_too_large")
    try:
        document = json.loads(raw)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ContractError("openapi_json_invalid") from error
    paths = document.get("paths") if isinstance(document, dict) else None
    if not isinstance(paths, dict):
        raise ContractError("openapi_paths_missing")
    methods = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}
    operation_count = sum(
        1
        for path_item in paths.values()
        if isinstance(path_item, dict)
        for method in path_item
        if method.lower() in methods
    )
    if operation_count < 1 or operation_count > max(25, max_requests // 10):
        raise ContractError("openapi_operation_bound_exceeded")
    OPENAPI_FILE.write_bytes(raw)
    os.chmod(OPENAPI_FILE, 0o600)
    return operation_count


def auth_context(origin, project, role, credentials):
    escaped_origin = re.escape(origin)
    destructive_exclusions = [
        "/api/internal/.*",
        "/api/v1/auth/.*",
        "/api/v1/me/sessions(?:/.*)?",
        "/api/v1/media/.*",
        "/api/v1/integrations/.*",
    ]
    login_body = json.dumps(
        {
            "email": "{%username%}",
            "password": "{%password%}",
            "organizationSlug": project,
        },
        separators=(",", ":"),
    )
    return {
        "name": f"{role}-context",
        "urls": [origin],
        "includePaths": [escaped_origin + ".*"],
        "excludePaths": [escaped_origin + expression for expression in destructive_exclusions],
        "authentication": {
            "method": "json",
            "parameters": {
                "loginPageUrl": origin + "/login",
                "loginRequestUrl": origin + "/api/v1/auth/login",
                "loginRequestBody": login_body,
            },
            "verification": {
                "method": "poll",
                "loggedInRegex": rf'\"role\"\s*:\s*\"{role}\"',
                "loggedOutRegex": r'\"code\"\s*:\s*\"authentication_required\"',
                "pollFrequency": 5,
                "pollUnits": "requests",
                "pollUrl": origin + "/api/v1/me",
                "pollPostData": "",
            },
        },
        "sessionManagement": {"method": "cookie"},
        "users": [
            {
                "name": f"{role}-user",
                "credentials": {
                    "username": credentials["email"],
                    "password": credentials["password"],
                },
            }
        ],
    }


def monitor_tests(job_request_budget):
    return [
        {
            "name": "Hard outbound request budget",
            "type": "monitor",
            "statistic": "stats.network.send.success",
            "threshold": job_request_budget,
            "onFail": "error",
        },
        {
            "name": "Failed outbound request budget",
            "type": "monitor",
            "statistic": "stats.network.send.failure",
            "threshold": 5,
            "onFail": "error",
        },
    ]


def build_plan(args, owner, member, operation_count):
    # The reserve covers imports, authentication polls, requestor jobs, failures, and monitor overshoot.
    import_budget = operation_count * 2
    reserve = import_budget + 100
    job_request_budget = max(10, (args.max_requests - reserve) // 6)
    scan_exclusions = [
        re.escape(args.origin) + "/api/internal/.*",
        re.escape(args.origin) + "/api/v1/auth/.*",
        re.escape(args.origin) + "/api/v1/me/sessions(?:/.*)?",
        re.escape(args.origin) + "/api/v1/media/.*",
        re.escape(args.origin) + "/api/v1/integrations/.*",
        re.escape(args.origin) + "/_next/.*",
    ]
    jobs = [
        {
            "type": "activeScan-config",
            "parameters": {
                "maxRuleDurationInMins": min(5, args.active_scan_minutes),
                "maxScanDurationInMins": args.active_scan_minutes,
                "maxAlertsPerRule": 10,
                "defaultPolicy": "Q Academy QA CICD",
                "handleAntiCSRFTokens": True,
                "injectPluginIdInHeader": True,
                "threadPerHost": 1,
            },
            "inputVectors": {
                "urlQueryStringAndDataDrivenNodes": {"enabled": True, "addParam": False, "odata": False},
                "postData": {
                    "enabled": True,
                    "multiPartFormData": False,
                    "xml": True,
                    "json": {"enabled": True, "scanNullValues": False},
                    "googleWebToolkit": False,
                    "directWebRemoting": False,
                },
                "urlPath": False,
                "httpHeaders": {"enabled": False, "allRequests": False},
                "cookieData": {"enabled": False, "encodeCookieValues": False},
                "scripts": False,
            },
            "excludePaths": scan_exclusions,
        },
        {
            "type": "activeScan-policy",
            "parameters": {"name": "Q Academy QA CICD"},
            "policyDefinition": {
                "defaultStrength": "Low",
                "defaultThreshold": "Off",
                "alertTags": {
                    "include": ["POLICY_QA_CICD"],
                    "exclude": ["TEST_TIMING", "OUT_OF_BAND"],
                    "strength": "Low",
                    "threshold": "Medium",
                },
                "rules": [],
            },
        },
    ]
    for role in ("owner", "member"):
        jobs.append(
            {
                "type": "requestor",
                "parameters": {"user": f"{role}-user"},
                "requests": [
                    {
                        "url": args.origin + "/api/v1/me",
                        "name": f"verify {role} login",
                        "method": "GET",
                        "headers": ["Accept: application/json"],
                        "responseCode": 200,
                    }
                ],
            }
        )
        jobs.append(
            {
                "type": "openapi",
                "parameters": {
                    "apiFile": str(OPENAPI_FILE),
                    "context": f"{role}-context",
                    "user": f"{role}-user",
                    "targetUrl": args.origin,
                },
            }
        )
        jobs.append(
            {
                "type": "spider",
                "parameters": {
                    "context": f"{role}-context",
                    "user": f"{role}-user",
                    "url": args.origin + ("/admin" if role == "owner" else "/academy"),
                    "maxDuration": args.spider_minutes,
                    "maxDepth": 5,
                    "maxChildren": 50,
                    "acceptCookies": True,
                    "handleParameters": "ignore_value",
                    "logoutAvoidance": True,
                    "parseComments": False,
                    "processForm": False,
                    "postForm": False,
                    "threadCount": 1,
                },
                "tests": monitor_tests(job_request_budget),
            }
        )
        jobs.append(
            {
                "type": "spiderAjax",
                "parameters": {
                    "context": f"{role}-context",
                    "user": f"{role}-user",
                    "url": args.origin + ("/admin" if role == "owner" else "/academy"),
                    "maxDuration": args.browser_spider_minutes,
                    "maxCrawlDepth": 5,
                    "numberOfBrowsers": 1,
                    "runOnlyIfModern": False,
                    "inScopeOnly": True,
                    "enableExtensions": False,
                    "browserId": "firefox-headless",
                    "clickDefaultElems": True,
                    "clickElemsOnce": True,
                    "eventWait": 500,
                    "maxCrawlStates": 100,
                    "randomInputs": False,
                    "reloadWait": 500,
                    "scopeCheck": "Strict",
                    "logoutAvoidance": True,
                },
                "tests": monitor_tests(job_request_budget),
            }
        )
        jobs.append(
            {
                "type": "activeScan",
                "parameters": {
                    "context": f"{role}-context",
                    "user": f"{role}-user",
                    "url": args.origin,
                    "policy": "Q Academy QA CICD",
                    "maxRuleDurationInMins": min(5, args.active_scan_minutes),
                    "maxScanDurationInMins": args.active_scan_minutes,
                    "delayInMs": 25,
                    "handleAntiCSRFTokens": True,
                    "injectPluginIdInHeader": True,
                    "scanHeadersAllRequests": False,
                    "threadPerHost": 1,
                    "maxAlertsPerRule": 10,
                },
                "tests": monitor_tests(job_request_budget),
            }
        )
    jobs.append({"type": "passiveScan-wait", "parameters": {"maxDuration": 5}})
    for role in ("owner", "member"):
        jobs.append(
            {
                "type": "requestor",
                "parameters": {"user": f"{role}-user"},
                "requests": [
                    {
                        "url": args.origin + "/api/v1/auth/logout",
                        "name": f"verify {role} logout",
                        "method": "POST",
                        "headers": [f"Origin: {args.origin}", "Content-Type: application/json"],
                        "data": "{}",
                        "responseCode": 200,
                    }
                ],
                "alwaysRun": True,
            }
        )
    jobs.extend(
        [
            {
                "type": "requestor",
                "requests": [
                    {
                        "url": args.origin + "/api/v1/me",
                        "name": "verify anonymous after logout",
                        "method": "GET",
                        "headers": ["Accept: application/json"],
                        "responseCode": 401,
                    }
                ],
                "alwaysRun": True,
            },
            {
                "type": "report",
                "parameters": {
                    "template": "traditional-json-plus",
                    "reportDir": "/tmp",
                    "reportFile": "raw-zap-report.json",
                    "reportTitle": "Q Academy authenticated active DAST",
                    "displayReport": False,
                },
                "risks": ["high", "medium", "low", "info"],
                "confidences": ["high", "medium", "low"],
                "sites": [args.origin],
                "alwaysRun": True,
            },
            {
                "type": "exitStatus",
                "parameters": {"errorLevel": "Medium", "warnLevel": "Low", "okExitValue": 0, "warnExitValue": 2, "errorExitValue": 1},
                "alwaysRun": True,
            },
        ]
    )
    return {
        "env": {
            "contexts": [
                auth_context(args.origin, args.project, "owner", owner),
                auth_context(args.origin, args.project, "member", member),
            ],
            "parameters": {"failOnError": True, "failOnWarning": True, "progressToStdout": False},
        },
        "jobs": jobs,
    }


def find_statistic(value, wanted):
    found = []
    if isinstance(value, dict):
        for key, nested in value.items():
            if key == wanted and isinstance(nested, (int, float, str)):
                found.append(nested)
        if value.get("key") == wanted or value.get("name") == wanted or value.get("statistic") == wanted:
            for key in ("value", "count", "counter"):
                if key in value:
                    found.append(value[key])
        for nested in value.values():
            found.extend(find_statistic(nested, wanted))
    elif isinstance(value, list):
        for nested in value:
            found.extend(find_statistic(nested, wanted))
    integers = []
    for item in found:
        try:
            integers.append(int(item))
        except (TypeError, ValueError):
            continue
    return max(integers) if integers else None


def sanitize_alerts(report):
    safe = []
    sites = report.get("site", []) if isinstance(report, dict) else []
    if isinstance(sites, dict):
        sites = [sites]
    for site in sites if isinstance(sites, list) else []:
        alerts = site.get("alerts", []) if isinstance(site, dict) else []
        if isinstance(alerts, dict):
            alerts = [alerts]
        for alert in alerts if isinstance(alerts, list) else []:
            if not isinstance(alert, dict):
                continue
            instances = alert.get("instances", [])
            count = len(instances) if isinstance(instances, list) else 1
            risk_code = str(alert.get("riskcode", ""))
            safe.append(
                {
                    "pluginId": str(alert.get("pluginid", ""))[:20],
                    "alertRef": str(alert.get("alertRef", ""))[:80],
                    "name": str(alert.get("alert", alert.get("name", "")))[:200],
                    "risk": RISK_NAMES.get(risk_code, str(alert.get("riskdesc", "Unknown")).split(" ", 1)[0])[:20],
                    "confidence": str(alert.get("confidence", alert.get("confidencedesc", "Unknown"))).split(" ", 1)[0][:20],
                    "cweId": str(alert.get("cweid", ""))[:20],
                    "wascId": str(alert.get("wascid", ""))[:20],
                    "count": max(1, count),
                }
            )
    safe.sort(key=lambda alert: (alert["risk"], alert["pluginId"], alert["name"]))
    return safe


def logs_contain_secret(secrets):
    log_paths = [
        path
        for path in ZAP_HOME.rglob("*")
        if path.is_file() and ("log" in path.name.lower() or path.suffix.lower() in {".out", ".err"})
    ]
    for log_path in log_paths:
        try:
            contents = log_path.read_bytes()
        except OSError:
            return True
        if any(secret.encode("utf-8") in contents for secret in secrets):
            return True
    return False


def write_safe_report(payload, secrets):
    serialized = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    if any(secret in serialized for secret in secrets):
        payload = {
            "schemaVersion": 1,
            "contractValid": False,
            "reasonCode": "secret_redaction_contract_failed",
        }
        serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    temporary = SAFE_REPORT_FILE.with_suffix(".tmp")
    temporary.write_text(serialized + "\n", encoding="ascii")
    os.chmod(temporary, 0o600)
    os.replace(temporary, SAFE_REPORT_FILE)


def main():
    os.umask(0o077)
    args = parse_args()
    secrets = []
    payload = {"schemaVersion": 1, "contractValid": False, "reasonCode": "scanner_contract_failed"}
    exit_code = 1
    try:
        owner = read_credentials(OWNER_FILE, args.project)
        member = read_credentials(MEMBER_FILE, args.project)
        if owner["email"].casefold() == member["email"].casefold():
            raise ContractError("role_credentials_must_be_distinct")
        secrets = [owner["email"], owner["password"], member["email"], member["password"]]
        operation_count = fetch_openapi(args.origin, args.max_requests)
        plan = build_plan(args, owner, member, operation_count)
        PLAN_FILE.write_text(json.dumps(plan, separators=(",", ":")), encoding="utf-8")
        os.chmod(PLAN_FILE, 0o600)
        ZAP_HOME.mkdir(mode=0o700)
        with open(os.devnull, "wb") as sink:
            result = subprocess.run(
                [
                    "/zap/zap.sh",
                    "-cmd",
                    "-silent",
                    "-nostdout",
                    "-dir",
                    str(ZAP_HOME),
                    "-autorun",
                    str(PLAN_FILE),
                ],
                stdin=subprocess.DEVNULL,
                stdout=sink,
                stderr=sink,
                check=False,
            )
        if logs_contain_secret(secrets):
            raise ContractError("secret_detected_in_zap_log")
        try:
            raw_report = json.loads(RAW_REPORT_FILE.read_bytes())
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise ContractError("raw_report_missing_or_invalid") from error
        requests_succeeded = find_statistic(raw_report, "stats.network.send.success")
        if requests_succeeded is None:
            raise ContractError("request_counter_missing")
        requests_failed = find_statistic(raw_report, "stats.network.send.failure") or 0
        requests_attempted = requests_succeeded + requests_failed
        alerts = sanitize_alerts(raw_report)
        risk_counts = {risk: 0 for risk in ("High", "Medium", "Low", "Informational", "Unknown")}
        for alert in alerts:
            risk = alert["risk"] if alert["risk"] in risk_counts else "Unknown"
            risk_counts[risk] += alert["count"]
        contract_valid = requests_attempted <= args.max_requests and result.returncode in (0, 1, 2)
        payload = {
            "schemaVersion": 1,
            "contractValid": contract_valid,
            "reasonCode": "completed" if contract_valid else "request_bound_or_zap_contract_failed",
            "zapExitCode": result.returncode,
            "requestsSucceeded": requests_succeeded,
            "requestsFailed": requests_failed,
            "requestsAttempted": requests_attempted,
            "maxRequests": args.max_requests,
            "openApiOperationCount": operation_count,
            "riskCounts": risk_counts,
            "alerts": alerts,
        }
        blocking_findings = risk_counts["High"] + risk_counts["Medium"] + risk_counts["Low"] + risk_counts["Unknown"]
        exit_code = 0 if contract_valid and result.returncode == 0 and blocking_findings == 0 else 1
    except ContractError as error:
        payload = {"schemaVersion": 1, "contractValid": False, "reasonCode": str(error)}
    except Exception:
        payload = {"schemaVersion": 1, "contractValid": False, "reasonCode": "unexpected_scanner_failure"}
    finally:
        write_safe_report(payload, secrets)
        for path in (PLAN_FILE, OPENAPI_FILE, RAW_REPORT_FILE):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                exit_code = 1
    return exit_code


if __name__ == "__main__":
    sys.exit(main())

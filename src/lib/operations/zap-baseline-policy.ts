const EXPECTED_ZAP_VERSION = "2.17.0";
const EXPECTED_ORIGIN = "http://academy.ci.q-academy.de:3000";
const EXPECTED_LOGIN_URI = `${EXPECTED_ORIGIN}/login`;
const NONCE_SOURCE_PATTERN = /'nonce-[A-Za-z0-9_-]{32,128}'/g;
const EXPECTED_WILDCARD_DETAIL =
  "The following directives either allow wildcard sources (or ancestors), are not defined, or are overly broadly defined:\n" +
  "img-src, connect-src, frame-src, media-src";
const EXPECTED_SERVER_ACTION_FORM =
  '<form class="space-y-4" action="" encType="multipart/form-data" method="POST">';
const ANTI_CSRF_DETAIL_PREFIX =
  "No known Anti-CSRF token [anticsrf, CSRFToken, __RequestVerificationToken, csrfmiddlewaretoken, authenticity_token, OWASP_CSRFTOKEN, anoncsrf, csrf_token, _csrf, _csrfSecret, __csrf_magic, CSRF, _token, _csrf_token, _csrfToken] was found in the following HTML form: [Form 1: ";
const EXPECTED_EXCEPTION_ALERT_REFS = [
  "10055-4",
  "10055-6",
  "10202",
] as const;

type JsonRecord = Record<string, unknown>;

export class ZapBaselinePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZapBaselinePolicyError";
  }
}

export type ZapBaselinePolicySummary = {
  alertCount: number;
  instanceCount: number;
  informationalAlertCount: number;
  acceptedExceptionAlertCount: number;
  acceptedExceptionInstanceCount: number;
};

function fail(message: string): never {
  throw new ZapBaselinePolicyError(message);
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function string(value: unknown, label: string) {
  if (typeof value !== "string") fail(`${label} must be a string.`);
  return value;
}

function array(value: unknown, label: string) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  return value;
}

function exact(value: unknown, expected: string, label: string) {
  if (string(value, label) !== expected) {
    fail(`${label} does not match the reviewed baseline contract.`);
  }
}

function normalizedPolicy(value: unknown, label: string) {
  const policy = string(value, label);
  const nonces = policy.match(NONCE_SOURCE_PATTERN) ?? [];
  if (nonces.length !== 1) {
    fail(`${label} must contain exactly one canonical CSP nonce source.`);
  }
  return policy.replace(NONCE_SOURCE_PATTERN, "'nonce-{reviewed}'");
}

// Keep this independent from the application CSP builder. An intentional policy
// change must update this reviewed contract separately or the DAST gate fails.
const EXPECTED_DOCUMENT_POLICY =
  "default-src 'self'; script-src 'self' 'nonce-{reviewed}' 'strict-dynamic'; " +
  "script-src-attr 'none'; style-src 'self' 'unsafe-inline'; " +
  "style-src-attr 'unsafe-inline'; img-src 'self' blob: data: https:; " +
  "media-src 'self' blob: https:; font-src 'self' data:; " +
  "connect-src 'self' https: wss:; frame-src 'self' https:; " +
  "worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; " +
  "base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

function instanceUrl(instance: JsonRecord, label: string) {
  const raw = string(instance.uri, `${label}.uri`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(`${label}.uri must be a valid URL.`);
  }
  if (url.origin !== EXPECTED_ORIGIN || url.username || url.password) {
    fail(`${label}.uri is outside the disposable ZAP origin.`);
  }
  return url;
}

function alertInstances(alert: JsonRecord, label: string) {
  const values = array(alert.instances, `${label}.instances`);
  if (values.length === 0 || values.length > 500) {
    fail(`${label}.instances must contain between one and five hundred entries.`);
  }
  return values.map((value, index) => {
    const instance = record(value, `${label}.instances[${index}]`);
    instanceUrl(instance, `${label}.instances[${index}]`);
    string(instance.method, `${label}.instances[${index}].method`);
    return instance;
  });
}

function validateReportedCount(
  alert: JsonRecord,
  instances: JsonRecord[],
  label: string,
) {
  const count = string(alert.count, `${label}.count`);
  if (!/^(?:0|[1-9]\d*)$/.test(count) || Number(count) !== instances.length) {
    fail(`${label}.count does not match its instances.`);
  }
}

function validateEmptyRequestMetadata(instance: JsonRecord, label: string) {
  exact(instance.param, "", `${label}.param`);
  exact(instance.attack, "", `${label}.attack`);
}

function validateCanonicalCspRoutes(
  instances: JsonRecord[],
  label: string,
) {
  const observations = instances.map((instance, index) => {
    const instanceLabel = `${label}.instances[${index}]`;
    const rawUri = string(instance.uri, `${instanceLabel}.uri`);
    const url = instanceUrl(instance, instanceLabel);
    if (
      url.search ||
      url.hash ||
      rawUri !== `${EXPECTED_ORIGIN}${url.pathname}`
    ) {
      fail(`${instanceLabel}.uri must be an exact canonical raw route.`);
    }
    const method = string(instance.method, `${instanceLabel}.method`);
    return { method, signature: `${method} ${rawUri}` };
  });

  return {
    all: observations.map(({ signature }) => signature).sort().join("\n"),
    post: observations
      .filter(({ method }) => method === "POST")
      .map(({ signature }) => signature)
      .sort()
      .join("\n"),
  };
}

function belongsToRuleFamily(
  pluginId: string,
  alertRef: string,
  family: string,
) {
  return pluginId === family || alertRef === family || alertRef.startsWith(`${family}-`);
}

function validateCspException(
  alert: JsonRecord,
  alertRef: "10055-4" | "10055-6",
  instances: JsonRecord[],
  label: string,
) {
  exact(alert.pluginid, "10055", `${label}.pluginid`);
  exact(alert.riskcode, "2", `${label}.riskcode`);
  exact(alert.confidence, "3", `${label}.confidence`);
  exact(
    alert.alert,
    alertRef === "10055-4"
      ? "CSP: Wildcard Directive"
      : "CSP: style-src unsafe-inline",
    `${label}.alert`,
  );
  const routeSignatures = validateCanonicalCspRoutes(instances, label);

  for (const [index, instance] of instances.entries()) {
    const instanceLabel = `${label}.instances[${index}]`;
    const method = string(instance.method, `${instanceLabel}.method`);
    const uri = string(instance.uri, `${instanceLabel}.uri`);
    if (
      method !== "GET" &&
      !(method === "POST" && uri === EXPECTED_LOGIN_URI)
    ) {
      fail(`${instanceLabel}.method and URI are not a reviewed CSP observation.`);
    }
    exact(instance.param, "content-security-policy", `${instanceLabel}.param`);
    exact(instance.attack, "", `${instanceLabel}.attack`);
    exact(
      instance.otherinfo,
      alertRef === "10055-4"
        ? EXPECTED_WILDCARD_DETAIL
        : "style-src includes unsafe-inline.",
      `${instanceLabel}.otherinfo`,
    );
    if (
      normalizedPolicy(
        instance.evidence,
        `${instanceLabel}.evidence`,
      ) !== EXPECTED_DOCUMENT_POLICY
    ) {
      fail(`${instanceLabel}.evidence is not the reviewed CSP.`);
    }
  }

  return routeSignatures;
}

function validateServerActionCsrfException(
  alert: JsonRecord,
  instances: JsonRecord[],
  label: string,
) {
  exact(alert.pluginid, "10202", `${label}.pluginid`);
  exact(alert.alertRef, "10202", `${label}.alertRef`);
  exact(alert.alert, "Absence of Anti-CSRF Tokens", `${label}.alert`);
  exact(alert.riskcode, "2", `${label}.riskcode`);
  exact(alert.confidence, "1", `${label}.confidence`);
  if (instances.length !== 2) {
    fail(`${label} must contain exactly the reviewed GET and POST login instances.`);
  }

  const methods = instances
    .map((instance) => string(instance.method, `${label}.instance.method`))
    .sort();
  if (methods[0] !== "GET" || methods[1] !== "POST") {
    fail(`${label} must contain one GET and one POST login instance.`);
  }

  for (const [index, instance] of instances.entries()) {
    const instanceLabel = `${label}.instances[${index}]`;
    instanceUrl(instance, instanceLabel);
    exact(instance.uri, EXPECTED_LOGIN_URI, `${instanceLabel}.uri`);
    validateEmptyRequestMetadata(instance, instanceLabel);
    exact(instance.evidence, EXPECTED_SERVER_ACTION_FORM, `${instanceLabel}.evidence`);
    const otherInfo = string(instance.otherinfo, `${instanceLabel}.otherinfo`);
    if (!otherInfo.startsWith(ANTI_CSRF_DETAIL_PREFIX) || !otherInfo.endsWith(" ].")) {
      fail(`${instanceLabel}.otherinfo is not the reviewed login form contract.`);
    }
    const fieldList = otherInfo.slice(
      ANTI_CSRF_DETAIL_PREFIX.length,
      -" ].".length,
    );
    const actionMatch = fieldList.match(
      /^"\$ACTION_(\d+):0" "\$ACTION_\1:1" "\$ACTION_KEY" "\$ACTION_REF_\1" "email" "password"$/,
    );
    if (!actionMatch) {
      fail(`${instanceLabel}.otherinfo contains an unreviewed form field.`);
    }
  }

  return `POST ${EXPECTED_LOGIN_URI}`;
}

export function validateZapBaselineReport(
  value: unknown,
): ZapBaselinePolicySummary {
  const report = record(value, "report");
  exact(report["@programName"], "ZAP", "report.@programName");
  exact(report["@version"], EXPECTED_ZAP_VERSION, "report.@version");

  const siteValues = Array.isArray(report.site) ? report.site : [report.site];
  if (siteValues.length !== 1) {
    fail("report.site must contain exactly one disposable origin.");
  }
  const site = record(siteValues[0], "report.site");
  exact(site["@name"], EXPECTED_ORIGIN, "report.site.@name");
  exact(site["@host"], "academy.ci.q-academy.de", "report.site.@host");
  exact(site["@port"], "3000", "report.site.@port");
  exact(site["@ssl"], "false", "report.site.@ssl");

  const alerts = array(site.alerts, "report.site.alerts");
  let instanceCount = 0;
  let informationalAlertCount = 0;
  let acceptedExceptionAlertCount = 0;
  let acceptedExceptionInstanceCount = 0;
  let cspRouteSignature: string | null = null;
  let cspPostRouteSignature: string | null = null;
  let serverActionPostRouteSignature: string | null = null;
  const seenAlertRefs = new Set<string>();

  for (const [index, rawAlert] of alerts.entries()) {
    const label = `report.site.alerts[${index}]`;
    const alert = record(rawAlert, label);
    const alertRef = string(alert.alertRef, `${label}.alertRef`);
    if (seenAlertRefs.has(alertRef)) {
      fail(`${label}.alertRef duplicates an earlier alert.`);
    }
    seenAlertRefs.add(alertRef);
    const riskCode = string(alert.riskcode, `${label}.riskcode`);
    if (!/^[0-3]$/.test(riskCode)) {
      fail(`${label}.riskcode is invalid.`);
    }
    const pluginId = string(alert.pluginid, `${label}.pluginid`);
    string(alert.alert, `${label}.alert`);
    const instances = alertInstances(alert, label);
    validateReportedCount(alert, instances, label);
    instanceCount += instances.length;

    if (belongsToRuleFamily(pluginId, alertRef, "10055")) {
      if (alertRef !== "10055-4" && alertRef !== "10055-6") {
        fail(`Unexpected CSP ZAP alert reference: ${alertRef}.`);
      }
      const routeSignatures = validateCspException(
        alert,
        alertRef,
        instances,
        label,
      );
      if (cspRouteSignature === null) {
        cspRouteSignature = routeSignatures.all;
        cspPostRouteSignature = routeSignatures.post;
      } else if (routeSignatures.all !== cspRouteSignature) {
        fail("The reviewed CSP alerts must cover the same route multiset.");
      }
    } else if (belongsToRuleFamily(pluginId, alertRef, "10202")) {
      if (alertRef !== "10202") {
        fail(`Unexpected anti-CSRF ZAP alert reference: ${alertRef}.`);
      }
      serverActionPostRouteSignature = validateServerActionCsrfException(
        alert,
        instances,
        label,
      );
    } else if (riskCode === "0") {
      informationalAlertCount += 1;
      continue;
    } else {
      fail(`Unexpected non-informational ZAP alert reference: ${alertRef}.`);
    }
    acceptedExceptionAlertCount += 1;
    acceptedExceptionInstanceCount += instances.length;
  }

  for (const expectedAlertRef of EXPECTED_EXCEPTION_ALERT_REFS) {
    if (!seenAlertRefs.has(expectedAlertRef)) {
      fail(`The reviewed ZAP alert reference is missing: ${expectedAlertRef}.`);
    }
  }

  if (
    cspPostRouteSignature !== "" &&
    cspPostRouteSignature !== serverActionPostRouteSignature
  ) {
    fail("CSP POST observations must match the reviewed Server Action form.");
  }

  return {
    alertCount: alerts.length,
    instanceCount,
    informationalAlertCount,
    acceptedExceptionAlertCount,
    acceptedExceptionInstanceCount,
  };
}

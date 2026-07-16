import assert from "node:assert/strict";
import test from "node:test";

import { buildDocumentContentSecurityPolicy } from "@/lib/content-security-policy";
import {
  validateZapBaselineReport,
  ZapBaselinePolicyError,
} from "@/lib/operations/zap-baseline-policy";

const origin = "http://academy.ci.q-academy.de:3000";

type TestInstance = {
  uri: string;
  method: string;
  param: string;
  attack: string;
  evidence: string;
  otherinfo: string;
};

type TestAlert = {
  pluginid: string;
  alertRef: string;
  alert: string;
  riskcode: string;
  confidence: string;
  instances: TestInstance[];
  count: string;
};

type TestReport = {
  "@programName": string;
  "@version": string;
  "@generated": string;
  created: string;
  site: Array<{
    "@name": string;
    "@host": string;
    "@port": string;
    "@ssl": string;
    alerts: TestAlert[];
  }>;
};

function documentPolicy(nonceCharacter: string) {
  return buildDocumentContentSecurityPolicy({
    nonce: nonceCharacter.repeat(32),
    development: false,
    upgradeInsecureRequests: false,
  });
}

function cspAlert(
  alertRef: "10055-4" | "10055-6",
): TestAlert {
  const paths = [
    "/%2Fimages%2Fcourses%2Fworkflows.webp&w=384&q=75",
    "/%2Fimages%2Fcourses%2Fworkflows.webp&w=750&q=75",
    "/login",
    "/login",
    "/password/forgot",
  ];
  return {
    pluginid: "10055",
    alertRef,
    alert:
      alertRef === "10055-4"
        ? "CSP: Wildcard Directive"
        : "CSP: style-src unsafe-inline",
    riskcode: "2",
    confidence: "3",
    instances: paths.map((path, index) => ({
      uri: `${origin}${path}`,
      method: "GET",
      param: "content-security-policy",
      attack: "",
      evidence: documentPolicy(String(index + 1)),
      otherinfo:
        alertRef === "10055-4"
          ? "The following directives either allow wildcard sources (or ancestors), are not defined, or are overly broadly defined:\nimg-src, connect-src, frame-src, media-src"
          : "style-src includes unsafe-inline.",
    })),
    count: String(paths.length),
  };
}

function setCspPaths(alert: TestAlert, paths: string[]) {
  const sourceInstances = structuredClone(alert.instances);
  alert.instances = paths.map((path, index) => ({
    ...sourceInstances[index % sourceInstances.length]!,
    uri: `${origin}${path}`,
  }));
  alert.count = String(alert.instances.length);
}

function csrfAlert(): TestAlert {
  const evidence =
    '<form class="space-y-4" action="" encType="multipart/form-data" method="POST">';
  const otherinfo =
    "No known Anti-CSRF token [anticsrf, CSRFToken, __RequestVerificationToken, csrfmiddlewaretoken, authenticity_token, OWASP_CSRFTOKEN, anoncsrf, csrf_token, _csrf, _csrfSecret, __csrf_magic, CSRF, _token, _csrf_token, _csrfToken] was found in the " +
    'following HTML form: [Form 1: "$ACTION_1:0" "$ACTION_1:1" ' +
    '"$ACTION_KEY" "$ACTION_REF_1" "email" "password" ].';

  return {
    pluginid: "10202",
    alertRef: "10202",
    alert: "Absence of Anti-CSRF Tokens",
    riskcode: "2",
    confidence: "1",
    instances: ["GET", "POST"].map((method) => ({
      uri: `${origin}/login`,
      method,
      param: "",
      attack: "",
      evidence,
      otherinfo,
    })),
    count: "2",
  };
}

function informationalAlert(): TestAlert {
  return {
    pluginid: "10111",
    alertRef: "10111",
    alert: "Modern Web Application",
    riskcode: "0",
    confidence: "3",
    instances: [
      {
        uri: `${origin}/login`,
        method: "POST",
        param: "",
        attack: "",
        evidence: "",
        otherinfo: "",
      },
    ],
    count: "1",
  };
}

function reviewedReport(): TestReport {
  return {
    "@programName": "ZAP",
    "@version": "2.17.0",
    "@generated": "Wed, 15 Jul 2026 07:56:09",
    created: "2026-07-15T07:56:09.747076155Z",
    site: [
      {
        "@name": origin,
        "@host": "academy.ci.q-academy.de",
        "@port": "3000",
        "@ssl": "false",
        alerts: [
          csrfAlert(),
          cspAlert("10055-4"),
          cspAlert("10055-6"),
          informationalAlert(),
        ],
      },
    ],
  };
}

function cloneReport() {
  return structuredClone(reviewedReport());
}

function assertPolicyRejects(report: unknown) {
  assert.throws(
    () => validateZapBaselineReport(report),
    (error: unknown) => error instanceof ZapBaselinePolicyError,
  );
}

test("accepts the reviewed ZAP 2.17.0 report contract", () => {
  assert.deepEqual(validateZapBaselineReport(reviewedReport()), {
    alertCount: 4,
    instanceCount: 13,
    informationalAlertCount: 1,
    acceptedExceptionAlertCount: 3,
    acceptedExceptionInstanceCount: 12,
  });
});

test("accepts reversed GET and POST login instance order", () => {
  const report = cloneReport();
  report.site[0]!.alerts[0]!.instances.reverse();

  assert.doesNotThrow(() => validateZapBaselineReport(report));
});

test("accepts the reported CSP route multiset in any instance order", () => {
  const report = cloneReport();
  for (const [index, alert] of report.site[0]!.alerts
    .filter((candidate) => candidate.alertRef.startsWith("10055-"))
    .entries()) {
    if (index === 0) alert.instances.reverse();
  }

  assert.deepEqual(validateZapBaselineReport(report), {
    alertCount: 4,
    instanceCount: 13,
    informationalAlertCount: 1,
    acceptedExceptionAlertCount: 3,
    acceptedExceptionInstanceCount: 12,
  });
});

test("accepts arbitrary canonical same-origin CSP samples without pinning spider order", () => {
  const report = cloneReport();
  const paths = [
    "/",
    "/admin",
    "/%2Fimages%2Fcourses%2Fother.webp&w=1920&q=76",
    "/login",
    "/robots.txt",
  ];
  for (const alert of report.site[0]!.alerts.filter((candidate) =>
    candidate.alertRef.startsWith("10055-"),
  )) {
    setCspPaths(alert, paths);
  }

  assert.doesNotThrow(() => validateZapBaselineReport(report));
});

test("rejects an unexpected ZAP version or disposable site identity", async (t) => {
  await t.test("wrong ZAP version", () => {
    const report = cloneReport();
    report["@version"] = "2.17.1";
    assertPolicyRejects(report);
  });

  await t.test("wrong site name", () => {
    const report = cloneReport();
    report.site[0]!["@name"] = "http://academy.ci.q-academy.de:3001";
    assertPolicyRejects(report);
  });

  await t.test("wrong site host", () => {
    const report = cloneReport();
    report.site[0]!["@host"] = "attacker.example";
    assertPolicyRejects(report);
  });
});

test("rejects missing or malformed report structure", async (t) => {
  const malformedReports: Array<[string, unknown]> = [
    ["null report", null],
    ["array report", []],
    ["missing version and site", {}],
    ["missing site", { ...cloneReport(), site: undefined }],
    ["empty site list", { ...cloneReport(), site: [] }],
    [
      "multiple sites",
      (() => {
        const report = cloneReport();
        report.site.push(structuredClone(report.site[0]!));
        return report;
      })(),
    ],
    [
      "non-array alerts",
      {
        ...cloneReport(),
        site: [{ ...cloneReport().site[0]!, alerts: {} }],
      },
    ],
    [
      "empty instances",
      (() => {
        const report = cloneReport();
        report.site[0]!.alerts[0]!.instances = [];
        return report;
      })(),
    ],
    [
      "malformed instance URI",
      (() => {
        const report = cloneReport();
        report.site[0]!.alerts[0]!.instances[0]!.uri = "not a URL";
        return report;
      })(),
    ],
    [
      "mismatched reported alert count",
      (() => {
        const report = cloneReport();
        report.site[0]!.alerts[0]!.count = "99";
        return report;
      })(),
    ],
  ];

  for (const [name, report] of malformedReports) {
    await t.test(name, () => assertPolicyRejects(report));
  }
});

test("rejects unknown and duplicated alert references", async (t) => {
  await t.test("unknown non-informational alert", () => {
    const report = cloneReport();
    report.site[0]!.alerts[1]!.alertRef = "99999";
    assertPolicyRejects(report);
  });

  await t.test("duplicated reviewed alert", () => {
    const report = cloneReport();
    report.site[0]!.alerts.push(
      structuredClone(report.site[0]!.alerts[1]!),
    );
    assertPolicyRejects(report);
  });

  await t.test("missing reviewed alert", () => {
    const report = cloneReport();
    report.site[0]!.alerts = report.site[0]!.alerts.filter(
      (alert) => alert.alertRef !== "10055-6",
    );
    assertPolicyRejects(report);
  });
});

test("rejects unreviewed CSP sub-alerts 10055-5 and 10055-10", async (t) => {
  for (const alertRef of ["10055-5", "10055-10"]) {
    await t.test(alertRef, () => {
      const report = cloneReport();
      report.site[0]!.alerts[1]!.alertRef = alertRef;
      assertPolicyRejects(report);
    });
  }

  await t.test("risk-code demotion cannot bypass the CSP family review", () => {
    const report = cloneReport();
    report.site[0]!.alerts[1]!.alertRef = "10055-5";
    report.site[0]!.alerts[1]!.riskcode = "0";
    assertPolicyRejects(report);
  });
});

test("rejects CSP evidence that differs from the central production policy", () => {
  const report = cloneReport();
  const instance = report.site[0]!.alerts[1]!.instances[0]!;
  instance.evidence = instance.evidence.replace(
    "object-src 'none'",
    "object-src 'self'",
  );
  assertPolicyRejects(report);
});

test("rejects foreign origins, noncanonical raw routes, and methods", async (t) => {
  await t.test("foreign origin", () => {
    const report = cloneReport();
    report.site[0]!.alerts[1]!.instances[0]!.uri =
      "http://attacker.example:3000/";
    assertPolicyRejects(report);
  });

  await t.test("raw path normalization alias", () => {
    const report = cloneReport();
    report.site[0]!.alerts[1]!.instances[0]!.uri =
      `${origin}/admin/../`;
    assertPolicyRejects(report);
  });

  await t.test("host casing alias", () => {
    const report = cloneReport();
    report.site[0]!.alerts[1]!.instances[0]!.uri =
      "http://ACADEMY.CI.Q-ACADEMY.DE:3000/login";
    assertPolicyRejects(report);
  });

  await t.test("query variant", () => {
    const report = cloneReport();
    report.site[0]!.alerts[1]!.instances[0]!.uri =
      `${origin}/login?next=/`;
    assertPolicyRejects(report);
  });

  await t.test("fragment variant", () => {
    const report = cloneReport();
    report.site[0]!.alerts[1]!.instances[0]!.uri = `${origin}/login#form`;
    assertPolicyRejects(report);
  });

  await t.test("unreviewed CSP method", () => {
    const report = cloneReport();
    report.site[0]!.alerts[1]!.instances[0]!.method = "POST";
    assertPolicyRejects(report);
  });
});

test("rejects different route multisets between the two CSP alerts", () => {
  const report = cloneReport();
  setCspPaths(report.site[0]!.alerts[1]!, [
    "/%2Fimages%2Fcourses%2Fworkflows.webp&w=384&q=75",
    "/%2Fimages%2Fcourses%2Fworkflows.webp&w=750&q=75",
    "/login",
    "/login",
    "/different",
  ]);
  assertPolicyRejects(report);
});

test("rejects an extra login form field or a foreign CSRF path", async (t) => {
  await t.test("extra form field", () => {
    const report = cloneReport();
    const instance = report.site[0]!.alerts[0]!.instances[0]!;
    instance.otherinfo = instance.otherinfo.replace(
      '"password" ].',
      '"password" "role" ].',
    );
    assertPolicyRejects(report);
  });

  await t.test("foreign form path", () => {
    const report = cloneReport();
    report.site[0]!.alerts[0]!.instances[0]!.uri = `${origin}/register`;
    assertPolicyRejects(report);
  });

  for (const [name, uri] of [
    ["normalized path alias", `${origin}/admin/../login`],
    ["host casing alias", "http://ACADEMY.CI.Q-ACADEMY.DE:3000/login"],
    ["query variant", `${origin}/login?next=/`],
    ["fragment variant", `${origin}/login#form`],
  ] as const) {
    await t.test(name, () => {
      const report = cloneReport();
      report.site[0]!.alerts[0]!.instances[0]!.uri = uri;
      assertPolicyRejects(report);
    });
  }
});

test("rejects a report containing only informational alerts as incomplete coverage", () => {
  const report = reviewedReport();
  report.site[0]!.alerts = [informationalAlert()];
  assertPolicyRejects(report);
});

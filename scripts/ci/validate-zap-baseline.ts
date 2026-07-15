import { readFile, stat } from "node:fs/promises";

import {
  validateZapBaselineReport,
  ZapBaselinePolicyError,
} from "../../src/lib/operations/zap-baseline-policy";

const MAX_REPORT_BYTES = 2 * 1024 * 1024;

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath || process.argv.length !== 3) {
    throw new ZapBaselinePolicyError(
      "Usage: validate-zap-baseline.ts <zap-report.json>",
    );
  }

  const metadata = await stat(reportPath);
  if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_REPORT_BYTES) {
    throw new ZapBaselinePolicyError(
      "The ZAP JSON report is missing, empty, or exceeds two MiB.",
    );
  }

  let report: unknown;
  try {
    report = JSON.parse(await readFile(reportPath, "utf8"));
  } catch {
    throw new ZapBaselinePolicyError("The ZAP JSON report is not valid JSON.");
  }

  const summary = validateZapBaselineReport(report);
  console.log(
    `ZAP policy validation passed: ${summary.alertCount} alerts, ` +
      `${summary.acceptedExceptionAlertCount} narrowly reviewed exceptions, ` +
      `${summary.informationalAlertCount} informational alerts.`,
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof ZapBaselinePolicyError
      ? error.message
      : "The ZAP report validator failed unexpectedly.";
  console.error(`ZAP policy validation failed: ${message}`);
  process.exitCode = 1;
});

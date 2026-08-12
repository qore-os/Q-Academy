import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { loadAiApiKey } from "../src/lib/ai/api-key-credential-core";

import {
  createLocalVerificationEvidence,
  createLocalVerificationPlan,
  parseLocalVerificationArguments,
  type ExternalVerificationGate,
  type LocalVerificationStepEvidence,
  type VerificationStep,
} from "../src/lib/operations/local-verification";
import { loadProjectEnvironment } from "./load-environment";

type NpmInvocation = {
  args: string[];
};

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the selected external gate.`);
  return value;
}

function externalInvocations(
  operation: ExternalVerificationGate,
): NpmInvocation[] {
  if (operation === "dependency-audit") {
    return [{ args: ["audit", "--omit=dev", "--audit-level=moderate"] }];
  }
  if (operation === "connector-release") {
    const prefix = ["--prefix", "integrations/automation-connectors/zapier"];
    return [
      { args: [...prefix, "test"] },
      { args: [...prefix, "run", "typecheck"] },
      { args: [...prefix, "run", "validate"] },
      { args: [...prefix, "run", "build"] },
      { args: [...prefix, "audit", "--omit=dev", "--audit-level=moderate"] },
    ];
  }
  if (operation === "ai-provider") {
    if (!loadAiApiKey()) {
      throw new Error("An AI provider credential is required for this gate.");
    }
    return [{ args: ["run", "ai:course-provider:preflight"] }];
  }
  if (operation === "s3-provider") {
    const bucket = requiredEnvironment("MEDIA_S3_BUCKET");
    return [
      {
        args: [
          "run",
          "media:s3:preflight",
          "--",
          "--confirm-bucket",
          bucket,
          "--json",
        ],
      },
    ];
  }
  if (operation === "s3-app-principal") {
    const bucket = requiredEnvironment("MEDIA_S3_BUCKET");
    return [
      {
        args: [
          "run",
          "media:s3:app-principal-preflight",
          "--",
          "--confirm-bucket",
          bucket,
          "--json",
        ],
      },
    ];
  }
  if (operation === "clamav") {
    const host = requiredEnvironment("MEDIA_CLAMAV_HOST");
    return [
      {
        args: [
          "run",
          "media:clamav:preflight",
          "--",
          "--confirm-host",
          host,
          "--json",
        ],
      },
    ];
  }
  if (operation === "media-processing") {
    const bucket = requiredEnvironment("MEDIA_S3_BUCKET");
    return [
      {
        args: [
          "run",
          "media:processing:preflight",
          "--",
          "--confirm-bucket",
          bucket,
        ],
      },
    ];
  }
  return [{ args: ["run", "mobile:preflight"] }];
}

function npmCliEntrypoint() {
  const configured = process.env.npm_execpath?.trim();
  if (!configured) {
    throw new Error("verify:local must be started through npm run.");
  }
  const resolved = realpathSync(configured);
  const normalized = resolved.replaceAll("\\", "/").toLowerCase();
  const stats = lstatSync(resolved);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    !normalized.endsWith("/node_modules/npm/bin/npm-cli.js")
  ) {
    throw new Error("npm_execpath is not a supported npm CLI entrypoint.");
  }
  return resolved;
}

function runNpm(invocation: NpmInvocation) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [npmCliEntrypoint(), ...invocation.args],
      {
        cwd: process.cwd(),
        env: { ...process.env },
        shell: false,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Verification command stopped by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

async function runStep(step: VerificationStep) {
  const invocations = step.npmScript
    ? [{ args: ["run", step.npmScript] }]
    : externalInvocations(step.operation as ExternalVerificationGate);
  for (const invocation of invocations) {
    const exitCode = await runNpm(invocation);
    if (exitCode !== 0) return exitCode;
  }
  return 0;
}

function writeReport(file: string | undefined, report: unknown) {
  if (!file) return;
  writeFileSync(path.resolve(file), `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

async function main() {
  const options = parseLocalVerificationArguments(process.argv.slice(2));
  if (options.reportPath && existsSync(path.resolve(options.reportPath))) {
    throw new Error("--report must name a new evidence file.");
  }
  const plan = createLocalVerificationPlan(options);
  if (options.externalGates.length) loadProjectEnvironment();
  const startedAt = new Date();
  const evidence: LocalVerificationStepEvidence[] = plan.map((step) => ({
    id: step.id,
    status: options.dryRun ? "planned" : "not_run",
    durationMs: null,
    exitCode: null,
  }));

  if (!options.dryRun) {
    for (let index = 0; index < plan.length; index += 1) {
      const step = plan[index] as VerificationStep;
      const result = evidence[index] as LocalVerificationStepEvidence;
      process.stdout.write(`[verify] ${step.id}\n`);
      const started = performance.now();
      try {
        const exitCode = await runStep(step);
        result.durationMs = Math.round(performance.now() - started);
        result.exitCode = exitCode;
        result.status = exitCode === 0 ? "passed" : "failed";
        if (exitCode !== 0) {
          result.failureCode = "command_failed";
          break;
        }
      } catch (error) {
        result.durationMs = Math.round(performance.now() - started);
        result.status = "failed";
        result.failureCode = "configuration_error";
        process.stderr.write(
          `[verify] ${step.id}: ${error instanceof Error ? error.message : "configuration error"}\n`,
        );
        break;
      }
    }
  }

  const report = createLocalVerificationEvidence({
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    options,
    steps: evidence,
  });
  writeReport(options.reportPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.evaluation.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Local verification failed."}\n`,
  );
  process.exitCode = 1;
});

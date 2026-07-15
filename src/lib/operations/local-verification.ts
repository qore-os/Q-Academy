export const EXTERNAL_VERIFICATION_GATES = [
  "dependency-audit",
  "connector-release",
  "ai-provider",
  "s3-provider",
  "s3-app-principal",
  "clamav",
  "media-processing",
  "mobile",
] as const;

export type ExternalVerificationGate =
  (typeof EXTERNAL_VERIFICATION_GATES)[number];

export type VerificationStep = {
  id: string;
  npmScript?: string;
  operation?: ExternalVerificationGate;
};

export type LocalVerificationOptions = {
  long: boolean;
  accessibility: boolean;
  dryRun: boolean;
  reportPath?: string;
  externalGates: ExternalVerificationGate[];
};

export type LocalVerificationStepEvidence = {
  id: string;
  status: "passed" | "failed" | "not_run" | "planned";
  durationMs: number | null;
  exitCode: number | null;
  failureCode?: "configuration_error" | "command_failed";
};

const coreSteps: readonly VerificationStep[] = [
  { id: "secret-scan", npmScript: "security:scan-secrets" },
  { id: "third-party-notices", npmScript: "notices:check" },
  { id: "database-schema-contract", npmScript: "db:check" },
  { id: "openapi-contract", npmScript: "api:check-contract" },
  { id: "connector-contract", npmScript: "connectors:check" },
  { id: "unit-tests", npmScript: "test:unit" },
  { id: "typecheck", npmScript: "typecheck" },
  { id: "lint", npmScript: "lint" },
];

const longSteps: readonly VerificationStep[] = [
  { id: "migration-tests", npmScript: "db:test-migrations" },
  { id: "integration-tests", npmScript: "test:integration" },
  { id: "backup-restore-drill", npmScript: "test:backup-restore-drill:required" },
  { id: "accessibility", npmScript: "test:accessibility" },
  { id: "e2e", npmScript: "test:e2e" },
  { id: "cross-browser-e2e", npmScript: "test:e2e:cross-browser" },
  { id: "production-build", npmScript: "build" },
];

const valueOptions = new Set([
  "--long",
  "--accessibility",
  "--dry-run",
  "--report",
  "--external-gate",
  "--ack-external",
]);

function booleanValue(raw: string, name: string) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

export function parseLocalVerificationArguments(
  args: readonly string[],
): LocalVerificationOptions {
  const values = new Map<string, string>();
  const externalGates: ExternalVerificationGate[] = [];
  const repeatable = new Set(["--external-gate"]);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!name?.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${name ?? "missing"}.`);
    }
    if (!valueOptions.has(name)) {
      throw new Error(`Unknown local verification option: ${name}.`);
    }
    if (!repeatable.has(name) && values.has(name)) {
      throw new Error(`${name} may only be provided once.`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }
    if (name === "--external-gate") {
      if (!(EXTERNAL_VERIFICATION_GATES as readonly string[]).includes(value)) {
        throw new Error(
          `--external-gate must be one of ${EXTERNAL_VERIFICATION_GATES.join(", ")}.`,
        );
      }
      externalGates.push(value as ExternalVerificationGate);
    }
    values.set(name, value);
  }
  const uniqueExternalGates = [...new Set(externalGates)];
  if (
    uniqueExternalGates.length &&
    values.get("--ack-external") !== "EXTERNAL_GATES"
  ) {
    throw new Error(
      "External gates require --ack-external EXTERNAL_GATES.",
    );
  }
  if (!uniqueExternalGates.length && values.has("--ack-external")) {
    throw new Error("--ack-external is only valid with --external-gate.");
  }
  return {
    long: booleanValue(values.get("--long") ?? "false", "--long"),
    accessibility: booleanValue(
      values.get("--accessibility") ?? "false",
      "--accessibility",
    ),
    dryRun: booleanValue(values.get("--dry-run") ?? "false", "--dry-run"),
    reportPath: values.get("--report"),
    externalGates: uniqueExternalGates,
  };
}

export function createLocalVerificationPlan(
  options: LocalVerificationOptions,
) {
  const steps = [...coreSteps];
  if (options.accessibility && !options.long) {
    steps.push({ id: "accessibility", npmScript: "test:accessibility" });
  }
  if (options.long) steps.push(...longSteps);
  for (const operation of options.externalGates) {
    steps.push({ id: `external:${operation}`, operation });
  }
  return steps;
}

export function createLocalVerificationEvidence(input: {
  startedAt: string;
  endedAt: string;
  options: Pick<
    LocalVerificationOptions,
    "long" | "accessibility" | "dryRun" | "externalGates"
  >;
  steps: readonly LocalVerificationStepEvidence[];
}) {
  const passed =
    input.options.dryRun ||
    input.steps.every((step) => step.status === "passed");
  return {
    schemaVersion: 1,
    kind: "q-academy-local-verification-evidence",
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    options: {
      long: input.options.long,
      accessibility: input.options.accessibility,
      dryRun: input.options.dryRun,
      externalGates: input.options.externalGates,
    },
    steps: input.steps,
    evaluation: {
      passed,
      failedStep:
        input.steps.find((step) => step.status === "failed")?.id ?? null,
    },
  };
}

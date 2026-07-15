const HTTP_SLO_VALUE_OPTIONS = new Set([
  "--origin",
  "--confirm-origin",
  "--duration-seconds",
  "--concurrency",
  "--timeout-ms",
  "--max-p95-ms",
  "--max-error-rate",
  "--min-requests",
  "--path",
  "--api-probe",
]);

export function validateHttpSloCliArguments(args: readonly string[]) {
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!name?.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${name ?? "missing"}.`);
    }
    if (!HTTP_SLO_VALUE_OPTIONS.has(name)) {
      throw new Error(`Unknown HTTP SLO option: ${name}.`);
    }
    if (name !== "--path" && seen.has(name)) {
      throw new Error(`${name} may only be provided once.`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }
    seen.add(name);
  }
}

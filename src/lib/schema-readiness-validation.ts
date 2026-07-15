export function evaluateMigrationReadiness(
  expectedHashes: Iterable<string>,
  appliedHashes: Iterable<string>,
) {
  const expected = new Set(expectedHashes);
  const applied = new Set(appliedHashes);
  const missing = [...expected].filter((hash) => !applied.has(hash));
  return {
    current: missing.length === 0,
    expectedMigrations: expected.size,
    appliedMigrations: applied.size,
    missingMigrations: missing.length,
  };
}

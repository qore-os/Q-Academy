export type ExpectedMigrationHistoryEntry = Readonly<{
  tag: string;
  hash: string;
  createdAt: number;
}>;

export type AppliedMigrationHistoryEntry = Readonly<{
  hash: string;
  createdAt: string | number | bigint | null;
}>;

function migrationTimestamp(
  value: AppliedMigrationHistoryEntry["createdAt"],
) {
  const parsed =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed)
    ? parsed
    : null;
}

function incompatibleMigrationHistory(detail: string): never {
  throw new Error(
    `Migration history is incompatible: ${detail} ` +
      "Do not edit drizzle.__drizzle_migrations. Restore the published " +
      "migration bytes and add a new forward migration; rebuild only a " +
      "disposable local database.",
  );
}

export function assertCompatibleMigrationHistory(
  expectedEntries: readonly ExpectedMigrationHistoryEntry[],
  appliedEntries: readonly AppliedMigrationHistoryEntry[],
) {
  const expectedByTimestamp = new Map<
    number,
    ExpectedMigrationHistoryEntry
  >();
  let previousExpectedTimestamp = -1;
  for (const entry of expectedEntries) {
    if (
      !Number.isSafeInteger(entry.createdAt) ||
      entry.createdAt <= previousExpectedTimestamp
    ) {
      incompatibleMigrationHistory(
        `release journal is not strictly ordered at ${entry.tag}.`,
      );
    }
    if (expectedByTimestamp.has(entry.createdAt)) {
      incompatibleMigrationHistory(
        `release journal repeats timestamp ${entry.createdAt}.`,
      );
    }
    expectedByTimestamp.set(entry.createdAt, entry);
    previousExpectedTimestamp = entry.createdAt;
  }

  const appliedByTimestamp = new Map<
    number,
    AppliedMigrationHistoryEntry
  >();
  for (const entry of appliedEntries) {
    const createdAt = migrationTimestamp(entry.createdAt);
    if (createdAt === null) {
      incompatibleMigrationHistory(
        `database contains an invalid migration timestamp ${String(entry.createdAt)}.`,
      );
    }
    if (appliedByTimestamp.has(createdAt)) {
      incompatibleMigrationHistory(
        `database repeats migration timestamp ${createdAt}.`,
      );
    }
    appliedByTimestamp.set(createdAt, entry);
  }

  if (!appliedByTimestamp.size) return;

  const maxExpectedTimestamp = expectedEntries.at(-1)?.createdAt ?? -1;
  const maxAppliedTimestamp = Math.max(...appliedByTimestamp.keys());

  for (const [createdAt, applied] of appliedByTimestamp) {
    if (createdAt > maxExpectedTimestamp) continue;
    const expected = expectedByTimestamp.get(createdAt);
    if (!expected) {
      incompatibleMigrationHistory(
        `database migration at ${createdAt} is not in the release journal.`,
      );
    }
    if (applied.hash !== expected.hash) {
      incompatibleMigrationHistory(
        `${expected.tag} (${createdAt}) expects SHA-256 ${expected.hash}, ` +
          `but the database records ${applied.hash}.`,
      );
    }
  }

  for (const expected of expectedEntries) {
    if (expected.createdAt > maxAppliedTimestamp) break;
    if (!appliedByTimestamp.has(expected.createdAt)) {
      incompatibleMigrationHistory(
        `database is missing ${expected.tag} (${expected.createdAt}) below its ` +
          "latest applied migration.",
      );
    }
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

import {
  isStratoPrivacyExportKey,
  parseStratoPrivacySweepCursor,
  runStratoPrivacyExportSweep,
  stratoRetentionMaxTraversalAge,
  stratoPrivacyRetentionCutoff,
  stratoPrivacySweepScopeFingerprint,
  type StratoPrivacySweepAdapter,
  type StratoPrivacySweepScope,
} from "../src/lib/privacy/strato-retention-sweeper";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const OLD = new Date("2026-07-07T12:00:00.000Z");
const TENANT_A = "tenants/11111111-1111-4111-8111-111111111111/";
const TENANT_B = "tenants/22222222-2222-4222-8222-222222222222/";
const EXPORT_A =
  `${TENANT_A}privacy-exports/33333333-3333-4333-8333-333333333333/` +
  "44444444-4444-4444-8444-444444444444.enc";
const EXPORT_B =
  `${TENANT_A}privacy-exports/33333333-3333-4333-8333-333333333333/` +
  "55555555-5555-4555-8555-555555555555.enc";
const EXPORT_C =
  `${TENANT_B}privacy-exports/66666666-6666-4666-8666-666666666666/` +
  "77777777-7777-4777-8777-777777777777.enc";
const SCOPE: StratoPrivacySweepScope = {
  endpoint: "https://s3.hidrive.strato.com",
  region: "eu-central-1",
  bucket: "q-academy",
  compatibilityMode: "strato-hidrive",
};
const SCOPE_FINGERPRINT = stratoPrivacySweepScopeFingerprint(SCOPE);

function missingObject() {
  return Object.assign(new Error("not found"), {
    $metadata: { httpStatusCode: 404 },
  });
}

function runSweep(
  adapter: StratoPrivacySweepAdapter,
  overrides: Partial<Parameters<typeof runStratoPrivacyExportSweep>[0]> = {},
) {
  return runStratoPrivacyExportSweep({
    adapter,
    bucket: "q-academy",
    scope: SCOPE,
    now: NOW,
    maxDeletes: 500,
    timeBudgetMs: 1_000,
    maxCycleAgeMs: 40 * 60_000,
    dryRun: false,
    monotonicNow: () => 0,
    ...overrides,
  });
}

test("STRATO privacy retention accepts only the exact tenant export key schema", () => {
  const key =
    "tenants/11111111-1111-4111-8111-111111111111/privacy-exports/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.enc";
  assert.equal(isStratoPrivacyExportKey(key), true);
  assert.equal(isStratoPrivacyExportKey(`${key}.tmp`), false);
  assert.equal(
    isStratoPrivacyExportKey(
      "tenants/11111111-1111-4111-8111-111111111111/assets/33333333-3333-4333-8333-333333333333.enc",
    ),
    false,
  );
});

test("STRATO privacy retention keeps a one-hour margin inside the eight-day bound", () => {
  assert.equal(
    stratoPrivacyRetentionCutoff(NOW).toISOString(),
    "2026-07-07T13:00:00.000Z",
  );
  assert.throws(() => stratoPrivacyRetentionCutoff(new Date("invalid")));
  assert.equal(stratoRetentionMaxTraversalAge(15 * 60_000), 20 * 60_000);
  assert.throws(() => stratoRetentionMaxTraversalAge(55 * 60_000));
});

test("STRATO retention cursor is strict and cannot move backwards", () => {
  assert.deepEqual(
    parseStratoPrivacySweepCursor({
      version: 2,
      scopeFingerprint: SCOPE_FINGERPRINT,
      cycleStartedAt: NOW.toISOString(),
      activeTenantPrefix: TENANT_A,
      exportStartAfter: EXPORT_A,
    }, SCOPE),
    {
      version: 2,
      scopeFingerprint: SCOPE_FINGERPRINT,
      cycleStartedAt: NOW.toISOString(),
      activeTenantPrefix: TENANT_A,
      exportStartAfter: EXPORT_A,
    },
  );
  assert.throws(
    () =>
      parseStratoPrivacySweepCursor({
        version: 2,
        scopeFingerprint: SCOPE_FINGERPRINT,
        cycleStartedAt: NOW.toISOString(),
        tenantStartAfter: TENANT_B,
        activeTenantPrefix: TENANT_A,
      }, SCOPE),
    /does not move forward/,
  );
  assert.throws(
    () =>
      parseStratoPrivacySweepCursor({
        version: 2,
        scopeFingerprint: SCOPE_FINGERPRINT,
        cycleStartedAt: NOW.toISOString(),
        activeTenantPrefix: TENANT_A,
        exportStartAfter: EXPORT_C,
      }, SCOPE),
    /export cursor is invalid/,
  );
  assert.throws(
    () =>
      parseStratoPrivacySweepCursor({
        version: 2,
        scopeFingerprint: SCOPE_FINGERPRINT,
        cycleStartedAt: NOW.toISOString(),
        unexpected: true,
      }, SCOPE),
    /invalid shape/,
  );
});

test("STRATO retention cursor is cryptographically bound to its storage scope", () => {
  const cursor = {
    version: 2,
    scopeFingerprint: SCOPE_FINGERPRINT,
    cycleStartedAt: NOW.toISOString(),
  } as const;
  assert.match(SCOPE_FINGERPRINT, /^[a-f0-9]{64}$/);
  for (const changedScope of [
    { ...SCOPE, endpoint: "https://objects.example.invalid" },
    { ...SCOPE, region: "eu-west-1" },
    { ...SCOPE, bucket: "q-academy-next" },
  ]) {
    assert.notEqual(
      stratoPrivacySweepScopeFingerprint(changedScope),
      SCOPE_FINGERPRINT,
    );
    assert.throws(
      () => parseStratoPrivacySweepCursor(cursor, changedScope),
      /does not match the configured storage scope/,
    );
  }
  assert.throws(
    () =>
      parseStratoPrivacySweepCursor(cursor, {
        ...SCOPE,
        compatibilityMode: "versioned",
      }),
    /compatibility scope is invalid/,
  );
  assert.throws(
    () =>
      parseStratoPrivacySweepCursor(
        { ...cursor, scopeFingerprint: "0".repeat(64) },
        SCOPE,
      ),
    /does not match the configured storage scope/,
  );
});

test("STRATO retention fails closed when a matching key has no valid LastModified", async () => {
  for (const lastModified of [undefined, new Date("invalid"), "2026-07-01"] as const) {
    const adapter: StratoPrivacySweepAdapter = {
      async send(command) {
        if (!(command instanceof ListObjectsV2Command)) {
          assert.fail("The invalid object must not be mutated.");
        }
        if (command.input.Delimiter) {
          return { CommonPrefixes: [{ Prefix: TENANT_A }] };
        }
        return { Contents: [{ Key: EXPORT_A, LastModified: lastModified }] };
      },
    };
    await assert.rejects(
      runSweep(adapter),
      /omitted a valid LastModified value/,
    );
  }
});

test("STRATO retention enforces the deadline inside an object page", async () => {
  let clock = 0;
  const commands: string[] = [];
  const adapter: StratoPrivacySweepAdapter = {
    async send(command) {
      commands.push(command.constructor.name);
      assert.ok(command instanceof ListObjectsV2Command);
      if (command.input.Delimiter) {
        return { CommonPrefixes: [{ Prefix: TENANT_A }] };
      }
      clock = 1_000;
      return { Contents: [{ Key: EXPORT_A, LastModified: OLD }] };
    },
  };
  const result = await runSweep(adapter, { monotonicNow: () => clock });
  assert.equal(result.budgetExhausted, true);
  assert.equal(result.cycleCompleted, false);
  assert.deepEqual(commands, ["ListObjectsV2Command", "ListObjectsV2Command"]);
  assert.ok(result.cursor);
  assert.equal(result.cursor.activeTenantPrefix, TENANT_A);
});

test("STRATO retention rechecks the deadline immediately before delete", async () => {
  let clock = 0;
  const commands: string[] = [];
  const object = { Key: EXPORT_A } as {
    Key: string;
    LastModified?: Date;
  };
  Object.defineProperty(object, "LastModified", {
    enumerable: true,
    get() {
      clock = 1_000;
      return OLD;
    },
  });
  const adapter: StratoPrivacySweepAdapter = {
    async send(command) {
      commands.push(command.constructor.name);
      assert.ok(command instanceof ListObjectsV2Command);
      return command.input.Delimiter
        ? { CommonPrefixes: [{ Prefix: TENANT_A }] }
        : { Contents: [object] };
    },
  };
  const result = await runSweep(adapter, { monotonicNow: () => clock });
  assert.equal(result.budgetExhausted, true);
  assert.equal(result.deleted, 0);
  assert.deepEqual(commands, ["ListObjectsV2Command", "ListObjectsV2Command"]);
});

test("STRATO retention fails closed if the deadline expires before delete verification", async () => {
  let clock = 0;
  const commands: string[] = [];
  const adapter: StratoPrivacySweepAdapter = {
    async send(command) {
      commands.push(command.constructor.name);
      if (command instanceof ListObjectsV2Command) {
        return command.input.Delimiter
          ? { CommonPrefixes: [{ Prefix: TENANT_A }] }
          : { Contents: [{ Key: EXPORT_A, LastModified: OLD }] };
      }
      if (command instanceof DeleteObjectCommand) {
        clock = 1_000;
        return {};
      }
      assert.fail("HEAD must not start after the total deadline.");
    },
  };
  await assert.rejects(
    runSweep(adapter, { monotonicNow: () => clock }),
    /deadline expired before deletion verification/,
  );
  assert.deepEqual(commands, [
    "ListObjectsV2Command",
    "ListObjectsV2Command",
    "DeleteObjectCommand",
  ]);
});

test("STRATO retention resumes lexicographically across process runs", async () => {
  const firstCommands: Array<
    ListObjectsV2Command | DeleteObjectCommand | HeadObjectCommand
  > = [];
  const firstAdapter: StratoPrivacySweepAdapter = {
    async send(command) {
      firstCommands.push(command);
      if (command instanceof HeadObjectCommand) throw missingObject();
      if (command instanceof DeleteObjectCommand) return {};
      if (command.input.Prefix === `${TENANT_A}privacy-exports/`) {
        assert.equal(command.input.StartAfter, EXPORT_A);
        return { Contents: [{ Key: EXPORT_B, LastModified: OLD }] };
      }
      if (command.input.Delimiter) {
        assert.equal(command.input.StartAfter, TENANT_A);
        return { CommonPrefixes: [{ Prefix: TENANT_B }] };
      }
      assert.equal(command.input.Prefix, `${TENANT_B}privacy-exports/`);
      return { Contents: [{ Key: EXPORT_C, LastModified: OLD }] };
    },
  };
  const first = await runSweep(firstAdapter, {
    cursor: {
      version: 2,
      scopeFingerprint: SCOPE_FINGERPRINT,
      cycleStartedAt: NOW.toISOString(),
      activeTenantPrefix: TENANT_A,
      exportStartAfter: EXPORT_A,
    },
    maxDeletes: 1,
  });
  assert.equal(first.deleteLimitReached, true);
  assert.deepEqual(first.cursor, {
    version: 2,
    scopeFingerprint: SCOPE_FINGERPRINT,
    cycleStartedAt: NOW.toISOString(),
    tenantStartAfter: TENANT_A,
    activeTenantPrefix: TENANT_B,
  });
  assert.equal(
    firstCommands.filter((command) => command instanceof DeleteObjectCommand)
      .length,
    1,
  );

  const secondCommands: Array<
    ListObjectsV2Command | DeleteObjectCommand | HeadObjectCommand
  > = [];
  const secondAdapter: StratoPrivacySweepAdapter = {
    async send(command) {
      secondCommands.push(command);
      if (command instanceof HeadObjectCommand) throw missingObject();
      if (command instanceof DeleteObjectCommand) return {};
      if (command.input.Prefix === `${TENANT_B}privacy-exports/`) {
        assert.equal(command.input.StartAfter, undefined);
        return { Contents: [{ Key: EXPORT_C, LastModified: OLD }] };
      }
      assert.equal(command.input.Delimiter, "/");
      assert.equal(command.input.StartAfter, TENANT_B);
      return { CommonPrefixes: [] };
    },
  };
  const second = await runSweep(secondAdapter, {
    cursor: first.cursor,
    maxDeletes: 1,
  });
  assert.equal(second.cycleCompleted, true);
  assert.equal(second.cursor, undefined);
  assert.ok(
    secondCommands[0] instanceof ListObjectsV2Command &&
      secondCommands[0].input.Prefix === `${TENANT_B}privacy-exports/`,
  );
});

test("STRATO retention persists export progress at the per-run page limit", async () => {
  const exportKey = (index: number) =>
    `${TENANT_A}privacy-exports/33333333-3333-4333-8333-333333333333/` +
    `44444444-4444-4444-8444-${index.toString(16).padStart(12, "0")}.enc`;
  let page = 0;
  const adapter: StratoPrivacySweepAdapter = {
    async send(command) {
      assert.ok(command instanceof ListObjectsV2Command);
      if (command.input.Delimiter) {
        return { CommonPrefixes: [{ Prefix: TENANT_A }] };
      }
      page += 1;
      return {
        Contents: [{ Key: exportKey(page), LastModified: NOW }],
        IsTruncated: true,
        NextContinuationToken: `export-page-${page}`,
      };
    },
  };

  const partial = await runSweep(adapter);
  assert.equal(page, 128);
  assert.equal(partial.pageLimitReached, true);
  assert.equal(partial.cycleCompleted, false);
  assert.equal(partial.cursor?.activeTenantPrefix, TENANT_A);
  assert.equal(partial.cursor?.exportStartAfter, exportKey(128));

  const resumeAdapter: StratoPrivacySweepAdapter = {
    async send(command) {
      assert.ok(command instanceof ListObjectsV2Command);
      if (command.input.Delimiter) {
        assert.equal(command.input.StartAfter, TENANT_A);
        return { CommonPrefixes: [] };
      }
      assert.equal(command.input.StartAfter, exportKey(128));
      return {
        Contents: [{ Key: exportKey(129), LastModified: NOW }],
        IsTruncated: false,
      };
    },
  };
  const completed = await runSweep(resumeAdapter, { cursor: partial.cursor });
  assert.equal(completed.cycleCompleted, true);
  assert.equal(completed.cursor, undefined);
});

test("STRATO retention persists tenant progress at the per-run page limit", async () => {
  const tenantPrefix = (index: number) =>
    `tenants/aaaaaaaa-aaaa-4aaa-8aaa-${index
      .toString(16)
      .padStart(12, "0")}/`;
  let page = 0;
  const adapter: StratoPrivacySweepAdapter = {
    async send(command) {
      assert.ok(command instanceof ListObjectsV2Command);
      if (!command.input.Delimiter) return { Contents: [] };
      page += 1;
      return {
        CommonPrefixes: [{ Prefix: tenantPrefix(page) }],
        IsTruncated: true,
        NextContinuationToken: `tenant-page-${page}`,
      };
    },
  };

  const partial = await runSweep(adapter);
  assert.equal(page, 128);
  assert.equal(partial.pageLimitReached, true);
  assert.equal(partial.cycleCompleted, false);
  assert.equal(partial.cursor?.tenantStartAfter, tenantPrefix(128));
  assert.equal(partial.cursor?.activeTenantPrefix, undefined);

  const resumeAdapter: StratoPrivacySweepAdapter = {
    async send(command) {
      assert.ok(command instanceof ListObjectsV2Command);
      if (!command.input.Delimiter) return { Contents: [] };
      assert.equal(command.input.StartAfter, tenantPrefix(128));
      return { CommonPrefixes: [{ Prefix: tenantPrefix(129) }] };
    },
  };
  const completed = await runSweep(resumeAdapter, { cursor: partial.cursor });
  assert.equal(completed.cycleCompleted, true);
  assert.equal(completed.cursor, undefined);
});

test("STRATO retention permanently fails an over-age traversal before S3 I/O", async () => {
  let sends = 0;
  const adapter: StratoPrivacySweepAdapter = {
    async send() {
      sends += 1;
      return {};
    },
  };
  await assert.rejects(
    runSweep(adapter, {
      cursor: {
        version: 2,
        scopeFingerprint: SCOPE_FINGERPRINT,
        cycleStartedAt: new Date(NOW.getTime() - 40 * 60_000).toISOString(),
      },
    }),
    /fail-closed SLA deadline/,
  );
  assert.equal(sends, 0);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  configuredAppVersion,
  formatServerErrorForLog,
  logServerError,
  redactServerErrorMessage,
} from "../src/lib/server-error-logging";

const fixedTime = new Date("2026-07-12T10:20:30.000Z");

function withEnvironment(
  values: Record<string, string | undefined>,
  callback: () => void,
) {
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("formats a bounded structured event without arbitrary error metadata", () => {
  withEnvironment(
    {
      Q_ACADEMY_APP_VERSION: "1.7.3",
      Q_ACADEMY_RUNTIME_ROLE: "app",
    },
    () => {
      const error = Object.assign(new Error("Database connection failed"), {
        name: "PostgresError",
        code: "23505",
        stack: "private stack",
        query: "select * from users",
        tenantId: "018f47a2-7b9d-7a31-8f65-a91a92d81234",
        arbitrary: { private: true },
      });
      const event = formatServerErrorForLog(
        error,
        {
          action: "member.csv_import",
          requestId: "018f47a2-7b9d-7a31-8f65-a91a92d81234",
        },
        "production",
        fixedTime,
      );

      assert.deepEqual(event, {
        timestamp: "2026-07-12T10:20:30.000Z",
        level: "error",
        event: "server.error",
        appVersion: "1.7.3",
        environment: "production",
        runtimeRole: "app",
        requestId: "018f47a2-7b9d-7a31-8f65-a91a92d81234",
        action: "member.csv_import",
        errorClass: "PostgresError",
        errorCode: "23505",
        errorMessage: "Database connection failed",
      });
      const serialized = JSON.stringify(event);
      for (const forbidden of [
        "private stack",
        "select * from users",
        '"tenantId"',
        '"arbitrary"',
      ]) {
        assert.equal(serialized.includes(forbidden), false, forbidden);
      }
    },
  );
});

test("accepts immutable source-bound release tags as application versions", () => {
  const releaseTag = `git-${"a".repeat(64)}`;
  withEnvironment({ Q_ACADEMY_APP_VERSION: releaseTag }, () => {
    assert.equal(configuredAppVersion(), releaseTag);
  });
});

test("redacts secrets, emails, JWTs, URLs, UUIDs, identities, and stack lines", () => {
  const secret = "qak_live_secret-token";
  const jwt =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9.VeryPrivateSignature123";
  const uuid = "018f47a2-7b9d-7a31-8f65-a91a92d81234";
  const message = redactServerErrorMessage(
    `Failed alice@example.test at https://private.test/users/${uuid}?token=${secret}; Bearer ${jwt}; tenantId=${uuid}; userId=42\n    at private (${"C:\\private\\server.ts:12"})`,
  );

  assert.match(message, /Failed/);
  for (const forbidden of [
    secret,
    jwt,
    uuid,
    "alice@example.test",
    "https://private.test",
    "C:\\private",
    "at private",
    "userId=42",
  ]) {
    assert.equal(message.includes(forbidden), false, forbidden);
  }
  assert.match(message, /\[redacted-(?:email|url|id|secret|value)\]/);

  const standalone = redactServerErrorMessage(
    "postgresql://db-user:db-password@private-host/database qak_live_abc123 user=42 dev@localhost",
  );
  for (const forbidden of [
    "postgresql://",
    "db-password",
    "qak_live_abc123",
    "user=42",
    "dev@localhost",
  ]) {
    assert.equal(standalone.includes(forbidden), false, forbidden);
  }
});

test("truncates sanitized messages and never returns control characters", () => {
  const result = redactServerErrorMessage(`Failure\u0000 ${"safe ".repeat(100)}`);
  assert.equal(result.length <= 256, true);
  assert.equal(result.endsWith("..."), true);
  assert.equal(/[\u0000-\u001f\u007f]/.test(result), false);
});

test("handles Error and non-Error throws without invoking arbitrary coercion", () => {
  const standard = formatServerErrorForLog(
    Object.assign(new TypeError("Invalid input"), { code: "ERR_INVALID_ARG" }),
    {},
    "test",
    fixedTime,
  );
  assert.equal(standard.errorClass, "TypeError");
  assert.equal(standard.errorCode, "ERR_INVALID_ARG");
  assert.equal(standard.errorMessage, "Invalid input");

  let coerced = false;
  const nonError = {
    name: "PrivateCustomerError",
    message: "token=very-private-value",
    toString() {
      coerced = true;
      return "must not run";
    },
  };
  const event = formatServerErrorForLog(
    nonError,
    {},
    "test",
    fixedTime,
  );
  assert.equal(event.errorClass, "UnknownError");
  assert.equal(event.errorMessage.includes("very-private-value"), false);
  assert.equal(coerced, false);
});

test("drops unsafe context and environment values but allows bounded request IDs", () => {
  withEnvironment(
    {
      Q_ACADEMY_APP_VERSION: "https://secret.example/version",
      Q_ACADEMY_RUNTIME_ROLE: "tenant-018f47a2",
    },
    () => {
      const event = formatServerErrorForLog(
        new Error("failure"),
        {
          action: "unsafe action/alice@example.test",
          requestId: "req-local_123",
        },
        "preview-with-tenant",
        fixedTime,
      );
      assert.equal(event.action, undefined);
      assert.equal(event.requestId, "req-local_123");
      assert.equal(event.environment, "unknown");
      assert.equal(event.runtimeRole, "unknown");
      assert.equal(event.appVersion, "0.1.0");

      const unsafeId = formatServerErrorForLog(
        new Error("failure"),
        { requestId: "token-secret-value" },
        "test",
        fixedTime,
      );
      assert.equal(unsafeId.requestId, undefined);
    },
  );
});

test("writes exactly one JSON object to stderr", () => {
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...values: unknown[]) => {
    calls.push(values);
  };
  try {
    logServerError(new Error("safe failure"), { action: "unit.test" });
  } finally {
    console.error = original;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1);
  assert.equal(typeof calls[0][0], "string");
  const parsed = JSON.parse(calls[0][0] as string) as Record<string, unknown>;
  assert.equal(parsed.event, "server.error");
  assert.equal(parsed.level, "error");
  assert.equal(parsed.action, "unit.test");
  assert.equal("stack" in parsed, false);
  assert.doesNotThrow(() => new Date(parsed.timestamp as string).toISOString());
});

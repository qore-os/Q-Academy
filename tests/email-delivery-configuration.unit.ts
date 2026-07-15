import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function readConfiguration(
  environment: NodeJS.ProcessEnv,
  assertion: string,
) {
  return spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      [
        "const { getEmailDeliveryConfiguration } =",
        "  await import('./src/lib/server-environment.ts');",
        assertion,
      ].join("\n"),
    ],
    {
      cwd: process.cwd(),
      env: environment,
      encoding: "utf8",
      windowsHide: true,
    },
  );
}

test("explicitly disabled email delivery resolves to no provider configuration", () => {
  const result = readConfiguration(
    {
      ...process.env,
      NODE_ENV: "development",
      EMAIL_DELIVERY_REQUIRED: "false",
      EMAIL_DELIVERY_WEBHOOK_URL: "https://mailer.example.test/deliver",
      EMAIL_DELIVERY_WEBHOOK_SECRET: "x".repeat(32),
    },
    [
      "if (getEmailDeliveryConfiguration() !== null) {",
      "  throw new Error('Disabled delivery exposed provider configuration.');",
      "}",
    ].join("\n"),
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("enabled email delivery resolves its configured provider", () => {
  const result = readConfiguration(
    {
      ...process.env,
      NODE_ENV: "development",
      EMAIL_DELIVERY_REQUIRED: "true",
      EMAIL_DELIVERY_WEBHOOK_URL: "https://mailer.example.test/deliver",
      EMAIL_DELIVERY_WEBHOOK_SECRET: "y".repeat(32),
    },
    [
      "const configuration = getEmailDeliveryConfiguration();",
      "if (configuration?.url !== 'https://mailer.example.test/deliver') {",
      "  throw new Error('Enabled delivery did not expose its provider URL.');",
      "}",
    ].join("\n"),
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

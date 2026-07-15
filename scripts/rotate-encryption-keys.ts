import postgres, { type Sql } from "postgres";
import {
  compactValueUsesActiveKey,
  createEncryptionKeyring,
  decryptCompactValueWithKeyring,
  decryptPayloadWithKeyring,
  encryptedPayloadUsesActiveKey,
  encryptCompactValueWithKeyring,
  encryptPayloadWithKeyring,
  parsePreviousEncryptionKeys,
  type EncryptionKeyring,
} from "../src/lib/encryption-keyring";

const HELP = `Q-Academy Encryption-Key-Rotation

Usage:
  npm run encryption:rotate -- --check [--batch-size 100]
  npm run encryption:rotate -- --execute [--batch-size 100]

Required environment:
  DATABASE_URL
  DATA_ENCRYPTION_KEY_ID
  DATA_ENCRYPTION_KEY
  WEBHOOK_ENCRYPTION_KEY_ID
  WEBHOOK_ENCRYPTION_KEY

Optional JSON key maps:
  DATA_ENCRYPTION_PREVIOUS_KEYS
  WEBHOOK_ENCRYPTION_PREVIOUS_KEYS

--check decrypts every stored value and reports how many records still use an
old or legacy key. --execute rewrites those records in bounded transactions and
then performs the same full verification, including tenant/user-bound TOTP
secrets. No plaintext or key material is
written to stdout.`;

type Options = {
  mode: "check" | "execute";
  batchSize: number;
};

type RotationStats = {
  emailDeliveries: number;
  idempotencyResponses: number;
  oidcClientSecrets: number;
  mfaTotpSecrets: number;
  webhookSecrets: number;
};

type EmailRow = { id: string; payload: unknown };
type IdempotencyRow = {
  id: string;
  organization_id: string;
  api_key_id: string;
  key: string;
  method: string;
  path: string;
  request_hash: string;
  response_body: unknown;
};
type WebhookRow = { id: string; signing_secret_encrypted: string };
type OidcConfigurationRow = {
  organization_id: string;
  client_secret_encrypted: unknown;
};
type MfaConfigurationRow = {
  organization_id: string;
  user_id: string;
  secret_encrypted: unknown;
};

function oidcClientSecretAssociatedData(organizationId: string) {
  return `q-academy:oidc-client-secret:v1\n${organizationId}`;
}

function mfaSecretAssociatedData(organizationId: string, userId: string) {
  return `mfa-totp:${organizationId}:${userId}:v1`;
}

function parseOptions(argv: string[]): Options | null {
  if (argv.includes("--help")) return null;
  const check = argv.includes("--check");
  const execute = argv.includes("--execute");
  if (check === execute) {
    throw new Error("Exactly one of --check or --execute is required.");
  }

  let batchSize = 100;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check" || argument === "--execute") continue;
    if (argument === "--batch-size") {
      const raw = argv[index + 1];
      if (!raw || !/^\d+$/.test(raw)) {
        throw new Error("--batch-size requires a whole number.");
      }
      batchSize = Number(raw);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (batchSize < 1 || batchSize > 1_000) {
    throw new Error("--batch-size must be between 1 and 1000.");
  }
  return { mode: execute ? "execute" : "check", batchSize };
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredSecret(name: string) {
  const value = requiredEnvironment(name);
  if (value.length < 32) {
    throw new Error(`${name} must contain at least 32 characters.`);
  }
  return value;
}

function keyring(prefix: "DATA" | "WEBHOOK") {
  return createEncryptionKeyring({
    activeKeyId: requiredEnvironment(`${prefix}_ENCRYPTION_KEY_ID`),
    activeSecret: requiredSecret(`${prefix}_ENCRYPTION_KEY`),
    previousKeys: parsePreviousEncryptionKeys(
      process.env[`${prefix}_ENCRYPTION_PREVIOUS_KEYS`],
      `${prefix}_ENCRYPTION_PREVIOUS_KEYS`,
    ),
  });
}

function idempotencyAssociatedData(row: IdempotencyRow) {
  return [
    "q-academy:api-idempotency:v1",
    row.organization_id,
    row.api_key_id,
    row.key,
    row.method,
    row.path,
    row.request_hash,
  ].join("\n");
}

async function rotateEmailDeliveries(
  sql: Sql,
  ring: EncryptionKeyring,
  batchSize: number,
) {
  let rotated = 0;
  while (true) {
    const count = await sql.begin(async (transaction) => {
      const rows = await transaction<EmailRow[]>`
        select id, payload
        from email_deliveries
        where coalesce(payload ->> 'v', '') <> '2'
           or coalesce(payload ->> 'kid', '') <> ${ring.activeKeyId}
        order by id
        for update skip locked
        limit ${batchSize}
      `;
      for (const row of rows) {
        const plaintext = decryptPayloadWithKeyring(
          row.payload,
          `email-delivery:${row.id}`,
          ring,
        );
        const encrypted = encryptPayloadWithKeyring(
          plaintext,
          `email-delivery:${row.id}`,
          ring,
        );
        await transaction`
          update email_deliveries
          set payload = ${transaction.json(encrypted)}
          where id = ${row.id}
        `;
      }
      return rows.length;
    });
    rotated += count;
    if (count < batchSize) return rotated;
  }
}

async function rotateIdempotencyResponses(
  sql: Sql,
  ring: EncryptionKeyring,
  batchSize: number,
) {
  let rotated = 0;
  while (true) {
    const count = await sql.begin(async (transaction) => {
      const rows = await transaction<IdempotencyRow[]>`
        select id, organization_id, api_key_id, key, method, path,
               request_hash, response_body
        from api_idempotency_keys
        where response_body is not null
          and (
            coalesce(response_body ->> 'v', '') <> '2'
            or coalesce(response_body ->> 'kid', '') <> ${ring.activeKeyId}
          )
        order by id
        for update skip locked
        limit ${batchSize}
      `;
      for (const row of rows) {
        const associatedData = idempotencyAssociatedData(row);
        const plaintext = decryptPayloadWithKeyring(
          row.response_body,
          associatedData,
          ring,
        );
        const encrypted = encryptPayloadWithKeyring(
          plaintext,
          associatedData,
          ring,
        );
        await transaction`
          update api_idempotency_keys
          set response_body = ${transaction.json(encrypted)}
          where id = ${row.id}
        `;
      }
      return rows.length;
    });
    rotated += count;
    if (count < batchSize) return rotated;
  }
}

async function rotateWebhookSecrets(
  sql: Sql,
  ring: EncryptionKeyring,
  batchSize: number,
) {
  let rotated = 0;
  while (true) {
    const count = await sql.begin(async (transaction) => {
      const rows = await transaction<WebhookRow[]>`
        select id, signing_secret_encrypted
        from webhooks
        where split_part(signing_secret_encrypted, '.', 1) <> 'v2'
           or split_part(signing_secret_encrypted, '.', 2) <> ${ring.activeKeyId}
        order by id
        for update skip locked
        limit ${batchSize}
      `;
      for (const row of rows) {
        const plaintext = decryptCompactValueWithKeyring(
          row.signing_secret_encrypted,
          ring,
        );
        await transaction`
          update webhooks
          set signing_secret_encrypted = ${encryptCompactValueWithKeyring(plaintext, ring)},
              updated_at = now()
          where id = ${row.id}
        `;
      }
      return rows.length;
    });
    rotated += count;
    if (count < batchSize) return rotated;
  }
}

async function rotateOidcClientSecrets(
  sql: Sql,
  ring: EncryptionKeyring,
  batchSize: number,
) {
  let rotated = 0;
  while (true) {
    const count = await sql.begin(async (transaction) => {
      const rows = await transaction<OidcConfigurationRow[]>`
        select organization_id, client_secret_encrypted
        from oidc_configurations
        where client_secret_encrypted is not null
          and (
            coalesce(client_secret_encrypted ->> 'v', '') <> '2'
            or coalesce(client_secret_encrypted ->> 'kid', '') <> ${ring.activeKeyId}
          )
        order by organization_id
        for update skip locked
        limit ${batchSize}
      `;
      for (const row of rows) {
        const associatedData = oidcClientSecretAssociatedData(
          row.organization_id,
        );
        const plaintext = decryptPayloadWithKeyring(
          row.client_secret_encrypted,
          associatedData,
          ring,
        );
        const encrypted = encryptPayloadWithKeyring(
          plaintext,
          associatedData,
          ring,
        );
        await transaction`
          update oidc_configurations
          set client_secret_encrypted = ${transaction.json(encrypted)}
          where organization_id = ${row.organization_id}
        `;
      }
      return rows.length;
    });
    rotated += count;
    if (count < batchSize) return rotated;
  }
}

async function rotateMfaTotpSecrets(
  sql: Sql,
  ring: EncryptionKeyring,
  batchSize: number,
) {
  let rotated = 0;
  while (true) {
    const count = await sql.begin(async (transaction) => {
      const rows = await transaction<MfaConfigurationRow[]>`
        select organization_id, user_id, secret_encrypted
        from user_mfa_configurations
        where coalesce(secret_encrypted ->> 'v', '') <> '2'
           or coalesce(secret_encrypted ->> 'kid', '') <> ${ring.activeKeyId}
        order by organization_id, user_id
        for update skip locked
        limit ${batchSize}
      `;
      for (const row of rows) {
        const associatedData = mfaSecretAssociatedData(
          row.organization_id,
          row.user_id,
        );
        const plaintext = decryptPayloadWithKeyring(
          row.secret_encrypted,
          associatedData,
          ring,
        );
        const encrypted = encryptPayloadWithKeyring(
          plaintext,
          associatedData,
          ring,
        );
        await transaction`
          update user_mfa_configurations
          set secret_encrypted = ${transaction.json(encrypted)},
              updated_at = now()
          where organization_id = ${row.organization_id}
            and user_id = ${row.user_id}
        `;
      }
      return rows.length;
    });
    rotated += count;
    if (count < batchSize) return rotated;
  }
}

async function verifyEmailDeliveries(sql: Sql, ring: EncryptionKeyring) {
  let cursor = "00000000-0000-0000-0000-000000000000";
  let remaining = 0;
  while (true) {
    const rows = await sql<EmailRow[]>`
      select id, payload
      from email_deliveries
      where id > ${cursor}
      order by id
      limit 500
    `;
    for (const row of rows) {
      decryptPayloadWithKeyring(row.payload, `email-delivery:${row.id}`, ring);
      if (!encryptedPayloadUsesActiveKey(row.payload, ring)) remaining += 1;
    }
    if (rows.length < 500) return remaining;
    cursor = rows.at(-1)!.id;
  }
}

async function verifyIdempotencyResponses(sql: Sql, ring: EncryptionKeyring) {
  let cursor = "00000000-0000-0000-0000-000000000000";
  let remaining = 0;
  while (true) {
    const rows = await sql<IdempotencyRow[]>`
      select id, organization_id, api_key_id, key, method, path,
             request_hash, response_body
      from api_idempotency_keys
      where response_body is not null and id > ${cursor}
      order by id
      limit 500
    `;
    for (const row of rows) {
      decryptPayloadWithKeyring(
        row.response_body,
        idempotencyAssociatedData(row),
        ring,
      );
      if (!encryptedPayloadUsesActiveKey(row.response_body, ring)) remaining += 1;
    }
    if (rows.length < 500) return remaining;
    cursor = rows.at(-1)!.id;
  }
}

async function verifyWebhookSecrets(sql: Sql, ring: EncryptionKeyring) {
  let cursor = "00000000-0000-0000-0000-000000000000";
  let remaining = 0;
  while (true) {
    const rows = await sql<WebhookRow[]>`
      select id, signing_secret_encrypted
      from webhooks
      where id > ${cursor}
      order by id
      limit 500
    `;
    for (const row of rows) {
      decryptCompactValueWithKeyring(row.signing_secret_encrypted, ring);
      if (!compactValueUsesActiveKey(row.signing_secret_encrypted, ring)) {
        remaining += 1;
      }
    }
    if (rows.length < 500) return remaining;
    cursor = rows.at(-1)!.id;
  }
}

async function verifyOidcClientSecrets(sql: Sql, ring: EncryptionKeyring) {
  let cursor = "00000000-0000-0000-0000-000000000000";
  let remaining = 0;
  while (true) {
    const rows = await sql<OidcConfigurationRow[]>`
      select organization_id, client_secret_encrypted
      from oidc_configurations
      where client_secret_encrypted is not null
        and organization_id > ${cursor}
      order by organization_id
      limit 500
    `;
    for (const row of rows) {
      decryptPayloadWithKeyring(
        row.client_secret_encrypted,
        oidcClientSecretAssociatedData(row.organization_id),
        ring,
      );
      if (!encryptedPayloadUsesActiveKey(row.client_secret_encrypted, ring)) {
        remaining += 1;
      }
    }
    if (rows.length < 500) return remaining;
    cursor = rows.at(-1)!.organization_id;
  }
}

async function verifyMfaTotpSecrets(sql: Sql, ring: EncryptionKeyring) {
  let cursorOrganization = "00000000-0000-0000-0000-000000000000";
  let cursorUser = "00000000-0000-0000-0000-000000000000";
  let remaining = 0;
  while (true) {
    const rows = await sql<MfaConfigurationRow[]>`
      select organization_id, user_id, secret_encrypted
      from user_mfa_configurations
      where (organization_id, user_id) > (${cursorOrganization}::uuid, ${cursorUser}::uuid)
      order by organization_id, user_id
      limit 500
    `;
    for (const row of rows) {
      decryptPayloadWithKeyring(
        row.secret_encrypted,
        mfaSecretAssociatedData(row.organization_id, row.user_id),
        ring,
      );
      if (!encryptedPayloadUsesActiveKey(row.secret_encrypted, ring)) remaining += 1;
    }
    if (rows.length < 500) return remaining;
    cursorOrganization = rows.at(-1)!.organization_id;
    cursorUser = rows.at(-1)!.user_id;
  }
}

async function verifyAll(
  sql: Sql,
  dataKeyring: EncryptionKeyring,
  webhookKeyring: EncryptionKeyring,
): Promise<RotationStats> {
  const [
    emailDeliveries,
    idempotencyResponses,
    oidcClientSecrets,
    mfaTotpSecrets,
    webhookSecrets,
  ] =
    await Promise.all([
      verifyEmailDeliveries(sql, dataKeyring),
      verifyIdempotencyResponses(sql, dataKeyring),
      verifyOidcClientSecrets(sql, dataKeyring),
      verifyMfaTotpSecrets(sql, dataKeyring),
      verifyWebhookSecrets(sql, webhookKeyring),
    ]);
  return {
    emailDeliveries,
    idempotencyResponses,
    oidcClientSecrets,
    mfaTotpSecrets,
    webhookSecrets,
  };
}

async function main() {
  let options: Options | null;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(HELP);
    process.exitCode = 1;
    return;
  }
  if (!options) {
    console.log(HELP);
    return;
  }

  const databaseUrl = requiredEnvironment("DATABASE_URL");
  const dataKeyring = keyring("DATA");
  const webhookKeyring = keyring("WEBHOOK");
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 10,
  });

  let locked = false;
  try {
    const [lock] = await sql<{ acquired: boolean }[]>`
      select pg_try_advisory_lock(
        hashtext('q-academy'),
        hashtext('encryption-key-rotation')
      ) as acquired
    `;
    locked = lock?.acquired === true;
    if (!locked) {
      throw new Error("Another encryption-key rotation is already running.");
    }

    let rotated: RotationStats = {
      emailDeliveries: 0,
      idempotencyResponses: 0,
      oidcClientSecrets: 0,
      mfaTotpSecrets: 0,
      webhookSecrets: 0,
    };
    if (options.mode === "execute") {
      rotated = {
        emailDeliveries: await rotateEmailDeliveries(
          sql,
          dataKeyring,
          options.batchSize,
        ),
        idempotencyResponses: await rotateIdempotencyResponses(
          sql,
          dataKeyring,
          options.batchSize,
        ),
        oidcClientSecrets: await rotateOidcClientSecrets(
          sql,
          dataKeyring,
          options.batchSize,
        ),
        mfaTotpSecrets: await rotateMfaTotpSecrets(
          sql,
          dataKeyring,
          options.batchSize,
        ),
        webhookSecrets: await rotateWebhookSecrets(
          sql,
          webhookKeyring,
          options.batchSize,
        ),
      };
    }

    const remaining = await verifyAll(sql, dataKeyring, webhookKeyring);
    console.log(
      JSON.stringify({
        mode: options.mode,
        activeKeyIds: {
          data: dataKeyring.activeKeyId,
          webhook: webhookKeyring.activeKeyId,
        },
        rotated,
        remaining,
        verified: true,
      }),
    );
    if (
      options.mode === "execute" &&
      Object.values(remaining).some((count) => count > 0)
    ) {
      throw new Error("Rotation completed with non-active encrypted values remaining.");
    }
  } finally {
    if (locked) {
      await sql`
        select pg_advisory_unlock(
          hashtext('q-academy'),
          hashtext('encryption-key-rotation')
        )
      `.catch(() => undefined);
    }
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(
    `Encryption-key rotation failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});

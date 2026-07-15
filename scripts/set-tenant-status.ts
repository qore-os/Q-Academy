import postgres from "postgres";

const TENANT_STATUSES = ["active", "suspended", "offboarding"] as const;
type TenantStatus = (typeof TENANT_STATUSES)[number];

const HELP = `Q-Academy Tenant-Status setzen

Erforderlich:
  --slug <slug>          Exakter Organisations-Slug
  --status <status>      active, suspended oder offboarding
  --confirm <slug>       Muss exakt dem Organisations-Slug entsprechen

Optional:
  --json                 Maschinenlesbare Ausgabe

DATABASE_URL muss explizit in der Umgebung gesetzt sein.`;

const valueFlags = new Set(["slug", "status", "confirm"]);

class TenantStatusCliError extends Error {}

function parseArguments(argv: string[]) {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "--json") {
      const key = argument.slice(2);
      if (Object.hasOwn(parsed, key)) {
        throw new TenantStatusCliError(`${argument} darf nur einmal angegeben werden.`);
      }
      parsed[key] = true;
      continue;
    }
    if (!argument?.startsWith("--")) {
      throw new TenantStatusCliError("Unerwartetes CLI-Argument.");
    }
    const key = argument.slice(2);
    if (!valueFlags.has(key)) {
      throw new TenantStatusCliError(`Unbekannte CLI-Option: --${key}`);
    }
    if (Object.hasOwn(parsed, key)) {
      throw new TenantStatusCliError(`Option darf nur einmal angegeben werden: --${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new TenantStatusCliError(`Wert fuer --${key} fehlt.`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function requiredString(
  parsed: Record<string, string | boolean>,
  key: string,
) {
  const value = parsed[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new TenantStatusCliError(`--${key} ist erforderlich.`);
  }
  return value.trim();
}

function validatedInput(parsed: Record<string, string | boolean>) {
  const slug = requiredString(parsed, "slug");
  if (
    slug.length > 100 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(slug)
  ) {
    throw new TenantStatusCliError("Der Organisations-Slug ist ungueltig.");
  }
  const rawStatus = requiredString(parsed, "status");
  if (!TENANT_STATUSES.some((status) => status === rawStatus)) {
    throw new TenantStatusCliError(
      "--status muss active, suspended oder offboarding sein.",
    );
  }
  const confirmation = requiredString(parsed, "confirm");
  if (confirmation !== slug) {
    throw new TenantStatusCliError(
      "--confirm muss exakt dem angegebenen Organisations-Slug entsprechen.",
    );
  }
  return {
    slug,
    status: rawStatus as TenantStatus,
    json: parsed.json === true,
  };
}

function explicitDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new TenantStatusCliError(
      "DATABASE_URL muss explizit gesetzt sein.",
    );
  }
  try {
    const parsed = new URL(value);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
      throw new Error();
    }
    if (!parsed.pathname.replace(/^\//, "")) throw new Error();
  } catch {
    throw new TenantStatusCliError("DATABASE_URL ist ungueltig.");
  }
  return value;
}

async function setTenantStatus() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    console.log(HELP);
    return;
  }
  const input = validatedInput(parsed);
  const client = postgres(explicitDatabaseUrl(), {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });

  try {
    const result = await client.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`tenant-status:${input.slug}`}))`;
      const [organization] = await tx<
        Array<{ id: string; slug: string; status: TenantStatus }>
      >`
        select id, slug, status
        from organizations
        where slug = ${input.slug}
        for update
      `;
      if (!organization) {
        throw new TenantStatusCliError(
          `Organisation '${input.slug}' wurde nicht gefunden.`,
        );
      }

      const now = new Date();
      let revokedSessions: Array<{ id: string }> = [];
      let revokedApiKeys: Array<{ id: string }> = [];
      if (input.status !== "active") {
        revokedSessions = await tx<Array<{ id: string }>>`
          update user_sessions
          set revoked_at = ${now}
          where organization_id = ${organization.id}
            and revoked_at is null
            and expires_at > ${now}
          returning id
        `;
        revokedApiKeys = await tx<Array<{ id: string }>>`
          update api_keys
          set status = 'revoked', revoked_at = coalesce(revoked_at, ${now})
          where organization_id = ${organization.id}
            and status = 'active'
          returning id
        `;
      }

      const statusChanged = organization.status !== input.status;
      if (statusChanged) {
        await tx`
          update organizations
          set status = ${input.status}, updated_at = ${now}
          where id = ${organization.id}
        `;
      }
      const changed =
        statusChanged ||
        revokedSessions.length > 0 ||
        revokedApiKeys.length > 0;
      if (changed) {
        await tx`
          insert into activity_events (
            organization_id, user_id, type, entity_type, entity_id, metadata,
            created_at
          ) values (
            ${organization.id}, null, 'tenant.status_changed', 'organization',
            ${organization.id},
            ${tx.json({
              source: "internal_cli",
              previousStatus: organization.status,
              status: input.status,
              revokedSessions: revokedSessions.length,
              revokedApiKeys: revokedApiKeys.length,
            })},
            ${now}
          )
        `;
      }

      return {
        organizationId: organization.id,
        slug: organization.slug,
        previousStatus: organization.status,
        status: input.status,
        changed,
        revokedSessions: revokedSessions.length,
        revokedApiKeys: revokedApiKeys.length,
      };
    });

    if (input.json) {
      console.log(JSON.stringify(result));
      return;
    }
    console.log(`Organisation: ${result.slug} (${result.organizationId})`);
    console.log(`Status: ${result.previousStatus} -> ${result.status}`);
    console.log(`Geaendert: ${result.changed ? "ja" : "nein"}`);
    console.log(`Widerrufene Sessions: ${result.revokedSessions}`);
    console.log(`Widerrufene API-Keys: ${result.revokedApiKeys}`);
  } finally {
    await client.end();
  }
}

try {
  await setTenantStatus();
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Unbekannter Fehler.";
  console.error(`Tenant-Status konnte nicht gesetzt werden:\n${message}`);
  process.exitCode = 1;
}

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import postgres from "postgres";
import { z } from "zod";

import { loadProjectEnvironment } from "./load-environment";

loadProjectEnvironment();

const HELP = `Q-Academy Tenant-Vertrag

Erforderlich:
  --slug <slug>                    Tenant-Slug
  --plan <code>                    Interner Plancode
  --status <status>                trial, active, past_due, suspended oder cancelled
  --seat-limit <zahl|unlimited>    Maximale aktive/eingeladene Konten
  --course-limit <zahl|unlimited>  Maximale nicht archivierte Kurse
  --storage-limit <zahl|unlimited> Speicherlimit in Bytes
  --ai-credits <zahl|unlimited>    Monatliche KI-Credits
  --expected-revision <zahl>       0 beim Anlegen, danach aktuelle Revision
  --confirm <slug>                 Exakte Bestaetigung des Tenant-Slugs

Optional:
  --features <a,b,c>               Entitlements, leer fuer keine
  --external-reference <text>      Vertrags-/Billing-Referenz
  --starts-at <ISO-Zeitpunkt>      Standard: jetzt
  --ends-at <ISO-Zeitpunkt|none>   Vertragsende oder kein Ende
  --json                           Maschinenlesbare Ausgabe
  --help                           Hilfe anzeigen`;

const valueFlags = new Set([
  "slug",
  "plan",
  "status",
  "seat-limit",
  "course-limit",
  "storage-limit",
  "ai-credits",
  "expected-revision",
  "confirm",
  "features",
  "external-reference",
  "starts-at",
  "ends-at",
]);
const booleanFlags = new Set(["help", "json"]);

export function parseTenantContractArguments(argv: string[]) {
  const values: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith("--")) {
      throw new Error(`Unerwartetes Argument: ${argument ?? ""}`);
    }
    const key = argument.slice(2);
    if (!valueFlags.has(key) && !booleanFlags.has(key)) {
      throw new Error(`Unbekannte Option: --${key}`);
    }
    if (Object.hasOwn(values, key)) {
      throw new Error(`Option darf nur einmal angegeben werden: --${key}`);
    }
    if (booleanFlags.has(key)) {
      values[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Wert fuer --${key} fehlt.`);
    }
    values[key] = value;
    index += 1;
  }
  return values;
}

const positiveLimit = z.union([
  z.literal("unlimited").transform(() => null),
  z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
]);
const aiLimit = z.union([
  z.literal("unlimited").transform(() => null),
  z.coerce.number().int().min(0).max(1_000_000_000),
]);
const storageLimit = z.union([
  z.literal("unlimited").transform(() => null),
  z.coerce.number().int().min(1_048_576).max(Number.MAX_SAFE_INTEGER),
]);
const timestampValue = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const entitlement = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9_.-]+$/);

export function tenantContractInput(raw: Record<string, string | boolean>) {
  const features =
    typeof raw.features === "string" && raw.features.trim()
      ? raw.features.split(",").map((value) => value.trim())
      : [];
  return z
    .object({
      slug: z.string().min(2).max(100).regex(/^[a-z0-9][a-z0-9-]+$/),
      planCode: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9_-]+$/),
      status: z.enum(["trial", "active", "past_due", "suspended", "cancelled"]),
      seatLimit: positiveLimit,
      courseLimit: positiveLimit,
      storageLimitBytes: storageLimit,
      aiMonthlyCredits: aiLimit,
      expectedRevision: z.coerce.number().int().min(0),
      confirmation: z.string(),
      featureEntitlements: z.array(entitlement).max(64),
      externalReference: z.string().trim().max(255).nullable(),
      startsAt: timestampValue.optional().default(() => new Date()),
      endsAt: z.union([timestampValue, z.literal("none").transform(() => null)]),
      json: z.boolean().default(false),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.confirmation !== value.slug) {
        context.addIssue({
          code: "custom",
          path: ["confirmation"],
          message: "--confirm muss exakt dem Tenant-Slug entsprechen.",
        });
      }
      if (new Set(value.featureEntitlements).size !== value.featureEntitlements.length) {
        context.addIssue({
          code: "custom",
          path: ["featureEntitlements"],
          message: "Entitlements duerfen nicht doppelt vorkommen.",
        });
      }
      if (value.endsAt && value.endsAt <= value.startsAt) {
        context.addIssue({
          code: "custom",
          path: ["endsAt"],
          message: "Das Vertragsende muss nach dem Vertragsbeginn liegen.",
        });
      }
    })
    .parse({
      slug: raw.slug,
      planCode: raw.plan,
      status: raw.status,
      seatLimit: raw["seat-limit"],
      courseLimit: raw["course-limit"],
      storageLimitBytes: raw["storage-limit"],
      aiMonthlyCredits: raw["ai-credits"],
      expectedRevision: raw["expected-revision"],
      confirmation: raw.confirm,
      featureEntitlements: features,
      externalReference:
        typeof raw["external-reference"] === "string"
          ? raw["external-reference"].trim() || null
          : null,
      startsAt: raw["starts-at"],
      endsAt: raw["ends-at"] ?? "none",
      json: raw.json === true,
    });
}

function requireDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL muss gesetzt sein.");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL muss eine PostgreSQL-URL sein.");
  }
  return value;
}

async function main() {
  const raw = parseTenantContractArguments(process.argv.slice(2));
  if (raw.help === true) {
    console.log(HELP);
    return;
  }
  const input = tenantContractInput(raw);
  const sql = postgres(requireDatabaseUrl(), { max: 1, prepare: false });
  try {
    const result = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`tenant-contract:${input.slug}`}, 0))`;
      const [organization] = await tx<
        Array<{ id: string; name: string; current_revision: number | null }>
      >`
        select organization.id, organization.name, contract.revision as current_revision
        from organizations organization
        left join organization_contracts contract
          on contract.organization_id = organization.id
        where organization.slug = ${input.slug}
        for update of organization
      `;
      if (!organization) throw new Error("Tenant wurde nicht gefunden.");
      const currentRevision = organization.current_revision ?? 0;
      if (currentRevision !== input.expectedRevision) {
        throw new Error(
          `Revision-Konflikt: erwartet ${input.expectedRevision}, aktuell ${currentRevision}.`,
        );
      }
      await tx`select pg_advisory_xact_lock(hashtextextended(${`organization-seat-limit:${organization.id}`}, 0))`;
      await tx`select pg_advisory_xact_lock(hashtextextended(${`organization-course-limit:${organization.id}`}, 0))`;
      await tx`select pg_advisory_xact_lock(hashtextextended(${`organization-storage-limit:${organization.id}`}, 0))`;
      const [usage] = await tx<
        Array<{ seats: number; courses: number; storage_bytes: number }>
      >`
        select
          (select count(*)::int from users where organization_id = ${organization.id} and status in ('active', 'invited')) as seats,
          (select count(*)::int from courses where organization_id = ${organization.id} and status <> 'archived') as courses,
          (
            coalesce((select sum(quota_bytes) from media_assets where organization_id = ${organization.id} and deleted_at is null), 0) +
            coalesce((select sum(size_bytes) from media_asset_derivatives where organization_id = ${organization.id}), 0)
          )::bigint as storage_bytes
      `;
      if (input.seatLimit !== null && usage.seats > input.seatLimit) {
        throw new Error(
          `Seat-Limit ${input.seatLimit} liegt unter der aktuellen Nutzung ${usage.seats}.`,
        );
      }
      if (input.courseLimit !== null && usage.courses > input.courseLimit) {
        throw new Error(
          `Kurslimit ${input.courseLimit} liegt unter der aktuellen Nutzung ${usage.courses}.`,
        );
      }
      if (
        input.storageLimitBytes !== null &&
        Number(usage.storage_bytes) > input.storageLimitBytes
      ) {
        throw new Error(
          `Speicherlimit ${input.storageLimitBytes} liegt unter der aktuellen Nutzung ${usage.storage_bytes}.`,
        );
      }
      const nextRevision = currentRevision + 1;
      const [contract] = await tx<
        Array<{
          organization_id: string;
          plan_code: string;
          status: string;
          revision: number;
        }>
      >`
        insert into organization_contracts (
          organization_id, plan_code, status, seat_limit, course_limit,
          storage_limit_bytes, ai_monthly_credits, feature_entitlements,
          external_reference, starts_at, ends_at, revision, updated_at
        ) values (
          ${organization.id}, ${input.planCode}, ${input.status},
          ${input.seatLimit}, ${input.courseLimit}, ${input.storageLimitBytes},
          ${input.aiMonthlyCredits}, ${input.featureEntitlements},
          ${input.externalReference}, ${input.startsAt}, ${input.endsAt},
          ${nextRevision}, now()
        )
        on conflict (organization_id) do update set
          plan_code = excluded.plan_code,
          status = excluded.status,
          seat_limit = excluded.seat_limit,
          course_limit = excluded.course_limit,
          storage_limit_bytes = excluded.storage_limit_bytes,
          ai_monthly_credits = excluded.ai_monthly_credits,
          feature_entitlements = excluded.feature_entitlements,
          external_reference = excluded.external_reference,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          revision = excluded.revision,
          updated_at = excluded.updated_at
        returning organization_id, plan_code, status, revision
      `;
      await tx`
        insert into activity_events (
          organization_id, user_id, type, entity_type, entity_id, metadata
        ) values (
          ${organization.id}, null, 'organization.contract_updated',
          'organization', ${organization.id},
          ${tx.json({
            planCode: input.planCode,
            status: input.status,
            revision: nextRevision,
            source: "operations_cli",
          })}
        )
      `;
      return { organization: organization.name, ...contract };
    });
    if (input.json) console.log(JSON.stringify(result));
    else {
      console.log(
        `${result.organization}: ${result.plan_code}/${result.status}, Revision ${result.revision}.`,
      );
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unbekannter Fehler.");
    process.exitCode = 1;
  });
}

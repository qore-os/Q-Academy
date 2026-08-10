import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { hash } from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import {
  activityEvents,
  aiAgents,
  aiAgentVersions,
  communityAreas,
  communityProfileSettings,
  communityPublicProfileFields,
  dataProfileDefinitions,
  emailDeliveries,
  invitations,
  organizations,
  memberDataProfiles,
  platformSettings,
  users,
} from "@/db/schema";
import * as schema from "@/db/schema";
import {
  createEncryptionKeyring,
  encryptPayloadWithKeyring,
} from "@/lib/encryption-keyring";
import { assertS3BrowserUploadOriginAllowed } from "@/lib/media/s3-browser-upload-origins";

const HELP = `Q-Academy Tenant-Provisionierung

Erforderlich:
  --name <name>                  Organisationsname
  --slug <slug>                  Eindeutiger Tenant-Slug
  --owner-email <email>          E-Mail des ersten Owners
  --owner-first-name <name>      Vorname des ersten Owners
  --owner-last-name <name>       Nachname des ersten Owners

Optional:
  --description <text>           Organisationsbeschreibung
  --platform-name <name>         Sichtbarer Plattformname (Standard: --name)
  --primary-color <#rrggbb>      Primaerfarbe (Standard: #17324d)
  --accent-color <#rrggbb>       Akzentfarbe (Standard: #2bb7a9)
  --logo-mark <text>             Kurzes Logo-Zeichen (Standard: erster Buchstabe)
  --logo-url <https-url>         Extern gehostetes Logo
  --favicon-url <https-url>      Extern gehostetes Favicon
  --font-family <name>           geist, system, arial oder georgia
  --corner-radius <px>           0, 4 oder 8
  --login-hostname <hostname>    Veraltet; Custom Domains werden nach Provisionierung per DNS-Claim aktiviert
  --app-url <origin>             Basis fuer den Einladungslink
  --json                         Maschinenlesbare Ausgabe
  --help                         Diese Hilfe anzeigen

DATABASE_URL, DATA_ENCRYPTION_KEY und DATA_ENCRYPTION_KEY_ID muessen explizit
in der Umgebung gesetzt sein. Die Einladungs-URL enthaelt das nur einmal
ausgegebene Token und muss wie ein Geheimnis behandelt werden.`;

const valueFlags = new Set([
  "name",
  "slug",
  "owner-email",
  "owner-first-name",
  "owner-last-name",
  "description",
  "platform-name",
  "primary-color",
  "accent-color",
  "logo-mark",
  "logo-url",
  "favicon-url",
  "font-family",
  "corner-radius",
  "login-hostname",
  "app-url",
]);
const booleanFlags = new Set(["help", "json"]);

type RawArguments = Record<string, string | boolean>;

class ProvisioningConflictError extends Error {}

function parseArguments(argv: string[]): RawArguments {
  const parsed: RawArguments = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith("--")) {
      throw new Error(`Unerwartetes Argument: ${argument ?? ""}`);
    }
    const key = argument.slice(2);
    if (!valueFlags.has(key) && !booleanFlags.has(key)) {
      throw new Error(`Unbekannte Option: --${key}`);
    }
    if (Object.hasOwn(parsed, key)) {
      throw new Error(`Option darf nur einmal angegeben werden: --${key}`);
    }
    if (booleanFlags.has(key)) {
      parsed[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Wert fuer --${key} fehlt.`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function isHttpAssetUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function isHostname(value: string) {
  if (value.length > 253 || value.includes(":") || value.includes("/")) {
    return false;
  }
  if (value === "localhost") return true;
  return value.split(".").every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
  );
}

const nullableAssetUrl = z
  .string()
  .trim()
  .max(2_000)
  .refine(isHttpAssetUrl, "Asset-URLs muessen HTTP(S) ohne Zugangsdaten verwenden.")
  .optional();

const provisioningSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(100)
      .regex(
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/,
        "Slug darf nur Kleinbuchstaben, Zahlen und einzelne Bindestriche enthalten.",
      ),
    ownerEmail: z.string().trim().toLowerCase().email().max(255),
    ownerFirstName: z.string().trim().min(2).max(100),
    ownerLastName: z.string().trim().min(2).max(100),
    description: z.string().trim().max(5_000).optional(),
    platformName: z.string().trim().min(2).max(120).optional(),
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#17324d"),
    accentColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#2bb7a9"),
    logoMark: z.string().trim().min(1).max(12).optional(),
    logoUrl: nullableAssetUrl,
    faviconUrl: nullableAssetUrl,
    fontFamily: z
      .enum(["geist", "system", "arial", "georgia"])
      .default("geist"),
    cornerRadius: z.union([z.literal(0), z.literal(4), z.literal(8)]).default(8),
    loginHostname: z
      .string()
      .trim()
      .toLowerCase()
      .transform((value) => value.replace(/\.$/, ""))
      .refine(isHostname, "Login-Hostname ist ungueltig.")
      .optional(),
    appUrl: z.string().trim().optional(),
    json: z.boolean().default(false),
  })
  .strict();

function parseProvisioningInput(raw: RawArguments) {
  return provisioningSchema.parse({
    name: raw.name,
    slug: raw.slug,
    ownerEmail: raw["owner-email"],
    ownerFirstName: raw["owner-first-name"],
    ownerLastName: raw["owner-last-name"],
    description: raw.description,
    platformName: raw["platform-name"],
    primaryColor: raw["primary-color"],
    accentColor: raw["accent-color"],
    logoMark: raw["logo-mark"],
    logoUrl: raw["logo-url"],
    faviconUrl: raw["favicon-url"],
    fontFamily: raw["font-family"],
    cornerRadius:
      raw["corner-radius"] === undefined
        ? undefined
        : Number(raw["corner-radius"]),
    loginHostname: raw["login-hostname"],
    appUrl: raw["app-url"],
    json: raw.json === true,
  });
}

function requireDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error(
      "DATABASE_URL muss fuer die Tenant-Provisionierung explizit gesetzt sein.",
    );
  }
  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL muss eine PostgreSQL-URL sein.");
  }
  return value;
}

function requireDataEncryptionKeyring() {
  const value = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!value || value.length < 32) {
    throw new Error(
      "DATA_ENCRYPTION_KEY mit mindestens 32 Zeichen wird fuer die Einladungs-Outbox benoetigt.",
    );
  }
  const activeKeyId = process.env.DATA_ENCRYPTION_KEY_ID?.trim();
  if (!activeKeyId) {
    throw new Error(
      "DATA_ENCRYPTION_KEY_ID wird fuer die Einladungs-Outbox benoetigt.",
    );
  }
  return createEncryptionKeyring({
    activeKeyId,
    activeSecret: value,
  });
}

function invitationOrigin(input: {
  appUrl?: string;
}) {
  const candidate =
    input.appUrl ??
    process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!candidate) {
    throw new Error(
      "--app-url oder NEXT_PUBLIC_APP_URL wird fuer den Einladungslink benoetigt.",
    );
  }
  const url = new URL(candidate);
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("Die App-URL muss HTTPS verwenden (ausser localhost).");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Die App-URL darf keine Zugangsdaten, Query oder Fragment enthalten.");
  }
  if (url.pathname !== "/") {
    throw new Error("Die App-URL muss eine Origin ohne Pfad sein.");
  }
  return url.origin;
}

function assertTenantUploadOrigin(slug: string, fallbackOrigin: string) {
  if (process.env.NODE_ENV !== "production") return;
  const tenantBaseDomain = process.env.TENANT_BASE_DOMAIN
    ?.trim()
    .toLowerCase()
    .replace(/\.$/, "");
  const origin = tenantBaseDomain
    ? `https://${slug}.${tenantBaseDomain}`
    : fallbackOrigin;
  assertS3BrowserUploadOriginAllowed(process.env, origin);
}

function opaqueTokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? databaseCode(error.cause) : undefined;
}

function formatError(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "Eingabe"}: ${issue.message}`)
      .join("\n");
  }
  if (error instanceof Error) return error.message;
  return "Unbekannter Fehler.";
}

async function provisionTenant() {
  const raw = parseArguments(process.argv.slice(2));
  if (raw.help === true) {
    console.log(HELP);
    return;
  }

  const input = parseProvisioningInput(raw);
  if (input.loginHostname) {
    throw new Error(
      "--login-hostname darf keinen ungeprueften Host aktivieren. Tenant zuerst mit --app-url provisionieren und die Domain danach als Owner per DNS-Claim verifizieren.",
    );
  }
  const databaseUrl = requireDatabaseUrl();
  const dataEncryptionKeyring = requireDataEncryptionKeyring();
  const origin = invitationOrigin(input);
  assertTenantUploadOrigin(input.slug, origin);
  const logoMark =
    input.logoMark ?? Array.from(input.name.trim())[0]?.toUpperCase() ?? "A";
  const platformName = input.platformName ?? input.name;
  const invitationToken = `invite_${randomBytes(32).toString("base64url")}`;
  const invitationUrl = `${origin}/invitations/${encodeURIComponent(invitationToken)}`;
  const emailDeliveryId = randomUUID();
  const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
  const passwordHash = await hash(
    randomBytes(48).toString("base64url"),
    12,
  );
  const client = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 20,
    prepare: false,
  });
  const db = drizzle(client, { schema });

  try {
    const created = await db.transaction(
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('tenant-provisioning'))`,
        );
        const [slugConflict] = await tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.slug, input.slug))
          .limit(1);
        if (slugConflict) {
          throw new ProvisioningConflictError(
            `Tenant-Slug '${input.slug}' existiert bereits; es wurden keine Daten geaendert und kein neues Token ausgegeben.`,
          );
        }

        const [organization] = await tx
          .insert(organizations)
          .values({
            name: input.name,
            slug: input.slug,
            description:
              input.description ?? `Lernplattform fuer ${input.name}.`,
            primaryColor: input.primaryColor,
            accentColor: input.accentColor,
            logoMark,
          })
          .returning({ id: organizations.id, slug: organizations.slug });
        if (!organization) throw new Error("Organisation konnte nicht angelegt werden.");

        const [defaultArea] = await tx
          .insert(communityAreas)
          .values({
            organizationId: organization.id,
            title: "Allgemein",
            slug: "allgemein",
            description: "Allgemeine Community-Bereiche",
            sortOrder: 0,
          })
          .returning({ id: communityAreas.id });
        if (!defaultArea) {
          throw new Error("Default-Community-Area konnte nicht angelegt werden.");
        }
        await tx.insert(communityProfileSettings).values({
          organizationId: organization.id,
          completionGateEnabled: false,
          revision: 1,
        });
        await tx.insert(communityPublicProfileFields).values([
          {
            organizationId: organization.id,
            standardField: "avatar",
            sortOrder: 0,
          },
          {
            organizationId: organization.id,
            standardField: "job_title",
            sortOrder: 1,
          },
          {
            organizationId: organization.id,
            standardField: "community_points",
            sortOrder: 2,
          },
          {
            organizationId: organization.id,
            standardField: "badges",
            sortOrder: 3,
          },
        ]);
        const [defaultProfileDefinition] = await tx
          .insert(dataProfileDefinitions)
          .values({
            organizationId: organization.id,
            key: "default",
            name: "Standardprofil",
            allowMemberCreation: false,
            active: true,
            sortOrder: 0,
          })
          .returning({ id: dataProfileDefinitions.id });
        if (!defaultProfileDefinition) {
          throw new Error("Default-Datenprofildefinition konnte nicht angelegt werden.");
        }

        const [owner] = await tx
          .insert(users)
          .values({
            organizationId: organization.id,
            email: input.ownerEmail,
            passwordHash,
            firstName: input.ownerFirstName,
            lastName: input.ownerLastName,
            role: "owner",
            status: "invited",
          })
          .returning({ id: users.id, email: users.email });
        if (!owner) throw new Error("Owner konnte nicht angelegt werden.");
        await tx.insert(memberDataProfiles).values({
          organizationId: organization.id,
          userId: owner.id,
          definitionId: defaultProfileDefinition.id,
          name: `Community Standard ${owner.id}`,
          isDefault: true,
          active: true,
        });

        const [invitation] = await tx
          .insert(invitations)
          .values({
            organizationId: organization.id,
            userId: owner.id,
            email: owner.email,
            tokenHash: opaqueTokenHash(invitationToken),
            expiresAt: invitationExpiresAt,
            createdById: null,
          })
          .returning({ id: invitations.id, expiresAt: invitations.expiresAt });
        if (!invitation) throw new Error("Einladung konnte nicht angelegt werden.");

        await tx.insert(emailDeliveries).values({
          id: emailDeliveryId,
          organizationId: organization.id,
          userId: owner.id,
          event: "invitation.created",
          recipientEmail: owner.email,
          payload: encryptPayloadWithKeyring(
            JSON.stringify({ link: invitationUrl }),
            `email-delivery:${emailDeliveryId}`,
            dataEncryptionKeyring,
          ),
        });

        await tx.insert(platformSettings).values([
          {
            organizationId: organization.id,
            key: "design",
            value: {
              platformName,
              primaryColor: input.primaryColor,
              accentColor: input.accentColor,
              logoUrl: input.logoUrl ?? null,
              faviconUrl: input.faviconUrl ?? null,
              fontFamily: input.fontFamily,
              cornerRadius: input.cornerRadius,
              loginHostname: null,
              defaultTheme: "light",
            },
          },
          {
            organizationId: organization.id,
            key: "learning",
            value: {
              certificates: true,
              streaks: true,
              communityPoints: true,
              defaultLanguage: "de",
            },
          },
        ]);

        const agentId = randomUUID();
        const publishedVersionId = randomUUID();
        const draftVersionId = randomUUID();
        const agentDefinition = {
          name: "Q-Coach",
          description:
            "Beantwortet Lernfragen auf Basis freigeschalteter Kursinhalte.",
          systemPrompt:
            "Antworte auf Deutsch, knapp und handlungsorientiert. Nutze nur freigeschaltete Lerninhalte, stelle bei Unklarheit Rueckfragen und erfinde keine Quellen oder Zugriffe.",
          color: input.accentColor,
          icon: "sparkles",
        };
        const [agent] = await tx
          .insert(aiAgents)
          .values({
            id: agentId,
            organizationId: organization.id,
            ...agentDefinition,
            active: false,
            draftVersionId: publishedVersionId,
            publishedVersionId: null,
          })
          .returning({ id: aiAgents.id });
        if (!agent) throw new Error("Default-KI-Agent konnte nicht angelegt werden.");
        const versionBase = {
          organizationId: organization.id,
          agentId,
          type: "learning_coach" as const,
          ...agentDefinition,
          knowledgeMode: "all_accessible_courses" as const,
          accessMode: "open" as const,
          createdById: owner.id,
        };
        await tx.insert(aiAgentVersions).values({
          ...versionBase,
          id: publishedVersionId,
          version: 1,
          state: "draft",
        });
        const publishedAt = new Date();
        await tx
          .update(aiAgentVersions)
          .set({ state: "published", publishedAt, updatedAt: publishedAt })
          .where(eq(aiAgentVersions.id, publishedVersionId));
        await tx.insert(aiAgentVersions).values({
          ...versionBase,
          id: draftVersionId,
          version: 2,
          state: "draft",
        });
        await tx
          .update(aiAgents)
          .set({
            active: true,
            draftVersionId,
            publishedVersionId,
          })
          .where(eq(aiAgents.id, agentId));

        await tx.insert(activityEvents).values({
          organizationId: organization.id,
          userId: owner.id,
          type: "tenant.provisioned",
          entityType: "organization",
          entityId: organization.id,
          metadata: { source: "internal_cli", ownerStatus: "invited" },
        });

        return {
          organizationId: organization.id,
          organizationSlug: organization.slug,
          ownerId: owner.id,
          ownerEmail: owner.email,
          invitationId: invitation.id,
          invitationExpiresAt: invitation.expiresAt.toISOString(),
          emailDeliveryId,
          agentId: agent.id,
        };
      },
      { isolationLevel: "serializable", accessMode: "read write" },
    );

    if (input.json) {
      console.log(JSON.stringify({ ...created, invitationUrl }));
    } else {
      console.log("Tenant erfolgreich provisioniert.");
      console.log(`Organisation: ${created.organizationSlug} (${created.organizationId})`);
      console.log(`Owner: ${created.ownerEmail} (${created.ownerId})`);
      console.log(`Einladung gueltig bis: ${created.invitationExpiresAt}`);
      console.log(`Mail-Outbox: ${created.emailDeliveryId} (pending)`);
      console.log(`Einladungs-URL (einmalige Ausgabe): ${invitationUrl}`);
      console.log("Die Einladungs-URL jetzt sicher uebergeben; sie kann nicht wiederhergestellt werden.");
    }
  } catch (error) {
    const code = databaseCode(error);
    if (code === "23505") {
      throw new ProvisioningConflictError(
        "Eindeutiger Tenant-Wert wurde parallel bereits belegt; die Transaktion wurde vollstaendig zurueckgerollt.",
      );
    }
    if (code === "40001") {
      throw new Error(
        "Paralleler Provisionierungskonflikt; die Transaktion wurde zurueckgerollt und kann sicher wiederholt werden.",
      );
    }
    throw error;
  } finally {
    await client.end();
  }
}

try {
  await provisionTenant();
} catch (error) {
  console.error(`Tenant-Provisionierung fehlgeschlagen:\n${formatError(error)}`);
  process.exitCode = 1;
}

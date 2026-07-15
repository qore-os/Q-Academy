import { and, count, desc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import {
  ApiConsole,
  type ApiEndpointParameter,
  type ApiEndpointRecord,
  type ApiHttpMethod,
  type ApiKeyRecord,
  type ApiRequestLogRecord,
  type ApiScopeDefinition,
  type ApiWebhookRecord,
} from "@/components/admin/api-console";
import type { WebhookDeliverySummary } from "@/lib/api/webhook-delivery-model";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db";
import {
  apiAuditLogs,
  apiKeys,
  organizations,
  users,
  webhookDeliveries,
  webhooks,
} from "@/db/schema";
import { requireTeamPermission } from "@/lib/auth";
import { openApiDocument } from "@/lib/api/openapi";
import {
  API_SCOPES,
  isOwnerBoundApiScope,
  WEBHOOK_EVENTS,
} from "@/lib/api/scopes";
import {
  getApiConsoleCopy,
  getApiEndpointGroupLabel,
  getApiScopePresentation,
  type ApiConsoleCopy,
} from "@/lib/i18n/api-console";
import type { AppLocale } from "@/lib/i18n/model";
import { resolveUserLocale } from "@/lib/i18n/server";
import { getPublicAppUrl } from "@/lib/server-environment";
import { getPublicOidcLoginConfiguration } from "@/lib/oidc-configuration";
import { listWebhookDeliveries } from "@/lib/api/webhook-delivery-operations";
import { userHasTeamPermission } from "@/lib/team-permissions";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireTeamPermission("api.view");
  const locale = await resolveUserLocale(user);
  return { title: getApiConsoleCopy(locale).page.metadataTitle };
}

type UnknownRecord = Record<string, unknown>;

const HTTP_METHODS = new Set<ApiHttpMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

const TAG_SCOPE_BASE: Record<string, string> = {
  Organization: "organization",
  Courses: "courses",
  Modules: "modules",
  Lessons: "modules",
  "Content blocks": "modules",
  Members: "members",
  Enrollments: "members",
  Groups: "groups",
  Bundles: "bundles",
  Submissions: "submissions",
  Community: "community",
  Events: "events",
  Hubs: "hubs",
  "AI agents": "agents",
  Analytics: "analytics",
  Commerce: "commerce",
  Automations: "automations",
  Support: "commerce",
  Webhooks: "webhooks",
  "API keys": "api_keys",
  "Audit log": "audit",
  Privacy: "privacy",
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toHttpMethod(value: string): ApiHttpMethod | null {
  const method = value.toUpperCase() as ApiHttpMethod;
  return HTTP_METHODS.has(method) ? method : null;
}

function resolveComponentReference(
  value: unknown,
  document: UnknownRecord,
  component: "parameters" | "responses" | "schemas",
): UnknownRecord | null {
  if (!isRecord(value)) return null;
  const reference = readString(value.$ref);
  if (!reference) return value;
  const prefix = `#/components/${component}/`;
  if (!reference.startsWith(prefix)) return value;
  const components: UnknownRecord = isRecord(document.components) ? document.components : {};
  const collection: UnknownRecord = isRecord(components[component]) ? components[component] : {};
  const resolved = collection[reference.slice(prefix.length)];
  return isRecord(resolved) ? resolved : value;
}

function schemaType(schemaValue: unknown, document: UnknownRecord): string {
  const schema = resolveComponentReference(schemaValue, document, "schemas");
  if (!schema) return "unknown";
  const reference = readString(schema.$ref);
  if (reference) return reference.split("/").at(-1) ?? "object";
  if (typeof schema.type === "string") return schema.format ? `${schema.type}<${String(schema.format)}>` : schema.type;
  if (Array.isArray(schema.type)) return schema.type.filter((item): item is string => typeof item === "string").join(" | ");
  if (Array.isArray(schema.oneOf)) return schema.oneOf.map((item) => schemaType(item, document)).join(" | ");
  if (Array.isArray(schema.allOf)) return schema.allOf.map((item) => schemaType(item, document)).join(" & ");
  return isRecord(schema.properties) ? "object" : "unknown";
}

function schemaExample(schemaValue: unknown, document: UnknownRecord, depth = 0): unknown {
  if (depth > 4) return null;
  if (!isRecord(schemaValue)) return null;

  const directReference = readString(schemaValue.$ref);
  if (directReference) {
    const resolved = resolveComponentReference(schemaValue, document, "schemas");
    if (resolved === schemaValue) return null;
    return schemaExample(resolved, document, depth + 1);
  }
  if (schemaValue.example !== undefined) return schemaValue.example;
  if (Array.isArray(schemaValue.examples) && schemaValue.examples.length) return schemaValue.examples[0];
  if (schemaValue.default !== undefined) return schemaValue.default;
  if (Array.isArray(schemaValue.enum) && schemaValue.enum.length) return schemaValue.enum[0];
  if (Array.isArray(schemaValue.oneOf)) {
    const option = schemaValue.oneOf.find((item) => !isRecord(item) || item.type !== "null") ?? schemaValue.oneOf[0];
    return schemaExample(option, document, depth + 1);
  }
  if (Array.isArray(schemaValue.allOf)) {
    return schemaValue.allOf.reduce<UnknownRecord>((result, part) => {
      const example = schemaExample(part, document, depth + 1);
      return isRecord(example) ? { ...result, ...example } : result;
    }, {});
  }

  if (schemaValue.type === "array") return [];
  if (schemaValue.type === "boolean") return true;
  if (schemaValue.type === "integer" || schemaValue.type === "number") return schemaValue.minimum ?? 1;
  if (schemaValue.type === "string") {
    if (schemaValue.format === "uuid") return "00000000-0000-4000-8000-000000000001";
    if (schemaValue.format === "date-time") return "2026-07-10T10:00:00.000Z";
    if (schemaValue.format === "email") return "name@example.com";
    if (schemaValue.format === "uri") return "https://example.com/resource";
    return "string";
  }

  const properties = isRecord(schemaValue.properties) ? schemaValue.properties : null;
  if (properties) {
    const required = new Set(readStringArray(schemaValue.required));
    const entries = Object.entries(properties)
      .sort(([left], [right]) => Number(required.has(right)) - Number(required.has(left)))
      .slice(0, 8);
    return Object.fromEntries(entries.map(([name, schema]) => [name, schemaExample(schema, document, depth + 1)]));
  }
  return {};
}

function requestBodyDetails(
  value: unknown,
  document: UnknownRecord,
  copy: ApiConsoleCopy,
) {
  if (!isRecord(value)) return null;
  const content = isRecord(value.content) ? value.content : {};
  const json = isRecord(content["application/json"]) ? content["application/json"] : null;
  if (!json) return null;
  const schema = json.schema;
  const example = json.example ?? schemaExample(schema, document);
  return {
    parameter: {
      name: "body",
      location: "body" as const,
      type: schemaType(schema, document),
      required: value.required === true,
      description:
        readString(value.description) ?? copy.endpoints.requestBodyFallback,
    },
    example: example === null || example === undefined ? undefined : JSON.stringify(example, null, 2),
  };
}

function mapParameter(
  value: unknown,
  document: UnknownRecord,
  copy: ApiConsoleCopy,
): ApiEndpointParameter | null {
  const parameter = resolveComponentReference(value, document, "parameters");
  if (!parameter) return null;
  const name = readString(parameter.name);
  const location = readString(parameter.in);
  if (!name || !location || !["path", "query", "header"].includes(location)) return null;
  const schema = parameter.schema;
  const schemaRecord = isRecord(schema) ? schema : {};
  const example = parameter.example ?? schemaRecord.example ?? schemaRecord.default;
  return {
    name,
    location: location as ApiEndpointParameter["location"],
    type: schemaType(schema, document),
    required: parameter.required === true,
    description:
      readString(parameter.description) ?? copy.endpoints.parameterFallback,
    example: example === undefined ? undefined : String(example),
  };
}

function inferScopes(tags: string[], method: ApiHttpMethod): string[] {
  const base = tags.map((tag) => TAG_SCOPE_BASE[tag]).find(Boolean);
  if (!base) return [];
  if (base === "organization") return ["organization:read"];
  if (base === "audit") return ["audit:read"];
  const suffix = method === "GET" || method === "HEAD" || method === "OPTIONS" ? "read" : "write";
  const scope = `${base}:${suffix}`;
  return API_SCOPES.includes(scope as (typeof API_SCOPES)[number]) ? [scope] : [];
}

function mapEndpointCatalog(
  documentValue: unknown,
  locale: AppLocale,
): ApiEndpointRecord[] {
  if (!isRecord(documentValue)) return [];
  const paths = isRecord(documentValue.paths) ? documentValue.paths : {};
  const copy = getApiConsoleCopy(locale);

  return Object.entries(paths).flatMap(([path, pathValue]) => {
    if (!isRecord(pathValue)) return [];
    return Object.entries(pathValue).flatMap(([verb, operationValue]) => {
      const method = toHttpMethod(verb);
      if (!method || !isRecord(operationValue)) return [];
      const tags = readStringArray(operationValue.tags);
      const title = readString(operationValue.summary) ?? readString(operationValue.operationId) ?? `${method} ${path}`;
      const body = requestBodyDetails(
        operationValue.requestBody,
        documentValue,
        copy,
      );
      const parameters = Array.isArray(operationValue.parameters)
        ? operationValue.parameters
            .map((parameter) => mapParameter(parameter, documentValue, copy))
            .filter((parameter): parameter is ApiEndpointParameter => parameter !== null)
        : [];
      if (body) parameters.push(body.parameter);
      const responseMap = isRecord(operationValue.responses) ? operationValue.responses : {};
      const responseItems = Object.entries(responseMap).flatMap(([status, response]) => {
        const numericStatus = Number(status);
        const resolvedResponse = resolveComponentReference(response, documentValue, "responses");
        if (!Number.isInteger(numericStatus) || !resolvedResponse) return [];
        return [{
          status: numericStatus,
          description:
            readString(resolvedResponse.description) ??
            copy.endpoints.responseFallback,
        }];
      });

      return [{
        id: readString(operationValue.operationId) ?? `${method.toLowerCase()}:${path}`,
        method,
        path,
        title,
        description:
          readString(operationValue.description) ??
          copy.endpoints.contractFallback(title),
        group: getApiEndpointGroupLabel(
          locale,
          tags.map((tag) => TAG_SCOPE_BASE[tag]).find(Boolean),
          tags[0] ?? "API",
        ),
        scopes:
          readStringArray(operationValue["x-required-scopes"]).length > 0
            ? readStringArray(operationValue["x-required-scopes"])
            : inferScopes(tags, method),
        stability: operationValue.deprecated === true ? "deprecated" as const : "stable" as const,
        version: isRecord(documentValue.info) ? readString(documentValue.info.version) : undefined,
        requiresAuthentication: !(Array.isArray(operationValue.security) && operationValue.security.length === 0),
        parameters,
        responses: responseItems,
        requestBodyExample: body?.example,
      }];
    });
  });
}

function readMetadataString(metadata: Record<string, unknown>, key: string) {
  return typeof metadata[key] === "string" ? metadata[key] : undefined;
}

export default async function ApiAdminPage() {
  const user = await requireTeamPermission("api.view");
  const organizationId = user.organizationId;
  const canManagePrivacyScopes = user.role === "owner";
  const [loginConfiguration, canManage, locale] = await Promise.all([
    getPublicOidcLoginConfiguration(organizationId),
    userHasTeamPermission(user, "api.manage"),
    resolveUserLocale(user),
  ]);
  const copy = getApiConsoleCopy(locale);

  const [organizationRows, keyRows, webhookRows, deliveryRows, deliveryStats, failedDeliveryRows, auditRows, keyRequestCounts] =
    await Promise.all([
      db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1),
      db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          prefix: apiKeys.prefix,
          scopes: apiKeys.scopes,
          status: apiKeys.status,
          createdAt: apiKeys.createdAt,
          lastUsedAt: apiKeys.lastUsedAt,
          expiresAt: apiKeys.expiresAt,
          expired: sql<boolean>`${apiKeys.expiresAt} is not null and ${apiKeys.expiresAt} <= now()`.mapWith(Boolean),
          creatorFirstName: users.firstName,
          creatorLastName: users.lastName,
        })
        .from(apiKeys)
        .leftJoin(
          users,
          and(eq(users.id, apiKeys.createdById), eq(users.organizationId, organizationId)),
        )
        .where(eq(apiKeys.organizationId, organizationId))
        .orderBy(desc(apiKeys.createdAt)),
      db
        .select()
        .from(webhooks)
        .where(eq(webhooks.organizationId, organizationId))
        .orderBy(desc(webhooks.createdAt)),
      db
        .selectDistinctOn([webhookDeliveries.webhookId], {
          id: webhookDeliveries.id,
          webhookId: webhookDeliveries.webhookId,
          status: webhookDeliveries.status,
          responseStatus: webhookDeliveries.responseStatus,
          createdAt: webhookDeliveries.createdAt,
        })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.organizationId, organizationId))
        .orderBy(webhookDeliveries.webhookId, desc(webhookDeliveries.createdAt)),
      db
        .select({
          webhookId: webhookDeliveries.webhookId,
          total: count(webhookDeliveries.id),
          delivered: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'delivered')`.mapWith(Number),
        })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.organizationId, organizationId))
        .groupBy(webhookDeliveries.webhookId),
      listWebhookDeliveries({
        organizationId,
        status: "failed",
        limit: 50,
      }) satisfies Promise<WebhookDeliverySummary[]>,
      db
        .select({
          id: apiAuditLogs.id,
          timestamp: apiAuditLogs.createdAt,
          method: apiAuditLogs.method,
          path: apiAuditLogs.path,
          status: apiAuditLogs.responseStatus,
          durationMs: apiAuditLogs.durationMs,
          requestId: apiAuditLogs.requestId,
          ipAddress: apiAuditLogs.ipAddress,
          metadata: apiAuditLogs.metadata,
          apiKeyName: apiKeys.name,
        })
        .from(apiAuditLogs)
        .leftJoin(
          apiKeys,
          and(eq(apiKeys.id, apiAuditLogs.apiKeyId), eq(apiKeys.organizationId, organizationId)),
        )
        .where(eq(apiAuditLogs.organizationId, organizationId))
        .orderBy(desc(apiAuditLogs.createdAt))
        .limit(250),
      db
        .select({ apiKeyId: apiAuditLogs.apiKeyId, value: count(apiAuditLogs.id) })
        .from(apiAuditLogs)
        .where(eq(apiAuditLogs.organizationId, organizationId))
        .groupBy(apiAuditLogs.apiKeyId),
    ]);

  const requestCountByKey = new Map(
    keyRequestCounts.flatMap((row) => row.apiKeyId ? [[row.apiKeyId, row.value] as const] : []),
  );
  const latestDeliveryByWebhook = new Map<string, (typeof deliveryRows)[number]>();
  for (const delivery of deliveryRows) {
    if (!latestDeliveryByWebhook.has(delivery.webhookId)) latestDeliveryByWebhook.set(delivery.webhookId, delivery);
  }
  const deliveryStatsByWebhook = new Map(deliveryStats.map((row) => [row.webhookId, row]));

  const keyRecords: ApiKeyRecord[] = keyRows
    .filter(
      (row) =>
        canManagePrivacyScopes || !row.scopes.some(isOwnerBoundApiScope),
    )
    .map((row) => {
    const ownerName = [row.creatorFirstName, row.creatorLastName].filter(Boolean).join(" ") || undefined;
    return {
      id: row.id,
      name: row.name,
      maskedValue: `${row.prefix}_********`,
      status: row.status === "revoked" ? "revoked" : row.expired ? "expired" : "active",
      scopes: row.scopes,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      ownerName,
      environment: row.prefix.includes("live") ? "production" : "sandbox",
      requestCount: requestCountByKey.get(row.id) ?? 0,
    };
    });

  const webhookRecords: ApiWebhookRecord[] = webhookRows.map((row) => {
    const latest = latestDeliveryByWebhook.get(row.id);
    const stats = deliveryStatsByWebhook.get(row.id);
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      events: row.events,
      status: !row.active ? "paused" : latest?.status === "failed" ? "failing" : "active",
      createdAt: row.createdAt.toISOString(),
      lastDeliveryAt: latest?.createdAt.toISOString() ?? row.lastDeliveryAt?.toISOString() ?? null,
      lastDeliveryStatus: latest?.responseStatus ?? null,
      successRate: stats?.total ? (stats.delivered / stats.total) * 100 : null,
    };
  });

  const requestRecords: ApiRequestLogRecord[] = auditRows.flatMap((row) => {
    const method = toHttpMethod(row.method);
    if (!method) return [];
    return [{
      id: row.id,
      timestamp: row.timestamp.toISOString(),
      method,
      path: row.path,
      status: row.status,
      durationMs: row.durationMs,
      requestId: row.requestId,
      apiKeyName: row.apiKeyName ?? readMetadataString(row.metadata, "apiKeyName"),
      ipAddress: row.ipAddress ?? undefined,
    }];
  });

  const scopeRecords: ApiScopeDefinition[] = [
    {
      id: "*",
      ...getApiScopePresentation(locale, "*"),
    },
    ...API_SCOPES.filter(
      (scope) => canManagePrivacyScopes || !isOwnerBoundApiScope(scope),
    ).map((scope) => ({
      id: scope,
      ...getApiScopePresentation(locale, scope),
    })),
  ];
  const endpoints = mapEndpointCatalog(openApiDocument, locale).filter(
    (endpoint) =>
      canManagePrivacyScopes ||
      !endpoint.scopes.some(isOwnerBoundApiScope),
  );
  const applicationUrl = getPublicAppUrl();

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1600px] space-y-6">
      <PageHeader
        eyebrow={copy.page.eyebrow}
        title={copy.page.title}
        description={copy.page.description}
      />
      <ApiConsole
        locale={locale}
        workspaceName={organizationRows[0]?.name ?? "Q-Academy"}
        baseUrl={`${applicationUrl}/api/v1`}
        environment={process.env.NODE_ENV === "production" ? "production" : "development"}
        apiVersion={openApiDocument.info.version}
        apiKeys={keyRecords}
        scopes={scopeRecords}
        endpoints={endpoints}
        webhooks={webhookRecords}
        failedWebhookDeliveries={failedDeliveryRows}
        requestLogs={requestRecords}
        webhookEvents={WEBHOOK_EVENTS}
        canManage={canManage}
        canManagePrivacyScopes={canManagePrivacyScopes}
        ownerStepUpMode={
          loginConfiguration.passwordLoginEnabled ? "password" : "oidc"
        }
        links={{ documentation: "/api/v1/openapi" }}
      />
    </div>
  );
}

import { z } from "zod";

import {
  orbitBootstrapSchema,
  orbitBillingFinalizeSchema,
  orbitBillingUpdateSchema,
  orbitClaimRedeemSchema,
  orbitDelegationSchema,
  orbitInstanceUpdateSchema,
  orbitMembershipSchema,
  orbitPermissionSetSchema,
  orbitTransferExecutionSchema,
  orbitTransferSchema,
} from "@/lib/orbit/schemas";

function jsonSchema(schema: z.ZodType) {
  const generated = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete generated.$schema;
  return generated;
}

const problem = {
  description: "Problem Details response.",
  content: {
    "application/problem+json": {
      schema: { $ref: "#/components/schemas/Problem" },
    },
  },
};

const success = (description: string, status = "200") => ({
  [status]: {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/DataEnvelope" },
      },
    },
  },
  "401": problem,
  "403": problem,
  "409": problem,
  "422": problem,
});

const body = (schema: string) => ({
  required: true,
  content: {
    "application/json": {
      schema: { $ref: `#/components/schemas/${schema}` },
    },
  },
});

const workspaceId = {
  name: "workspaceId",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};
const organizationId = {
  name: "organizationId",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};

export const orbitOpenApiDocument = {
  openapi: "3.1.0",
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  info: {
    title: "Q-Academy Orbit Control Plane API",
    version: "1.0.0",
    description:
      "Browser-session API for cross-tenant organizations, instances, delegated partners, entitlements, and isolated content transfers.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "Orbit Workspaces" },
    { name: "Orbit Access" },
    { name: "Orbit Instances" },
    { name: "Orbit Billing" },
    { name: "Orbit Transfers" },
  ],
  security: [{ CookieSession: [] }],
  paths: {
    "/api/orbit/workspaces": {
      get: {
        tags: ["Orbit Workspaces"],
        summary: "List Orbit organizations for the linked account",
        operationId: "listOrbitWorkspaces",
        responses: success("Orbit organizations."),
      },
      post: {
        tags: ["Orbit Workspaces"],
        summary: "Bootstrap an Orbit organization from a tenant owner",
        operationId: "bootstrapOrbitWorkspace",
        requestBody: body("OrbitBootstrap"),
        responses: success("Orbit organization created.", "201"),
      },
    },
    "/api/orbit/workspaces/{workspaceId}": {
      get: {
        tags: ["Orbit Workspaces"],
        summary: "Read an authorized Orbit organization overview",
        operationId: "getOrbitWorkspace",
        parameters: [workspaceId],
        responses: success("Orbit organization overview."),
      },
    },
    "/api/orbit/workspaces/{workspaceId}/permission-sets": {
      post: {
        tags: ["Orbit Access"],
        summary: "Create an organization permission set",
        operationId: "createOrbitPermissionSet",
        parameters: [workspaceId],
        requestBody: body("OrbitPermissionSet"),
        responses: success("Permission set created.", "201"),
      },
    },
    "/api/orbit/workspaces/{workspaceId}/memberships": {
      put: {
        tags: ["Orbit Access"],
        summary: "Create or update an organization membership",
        operationId: "upsertOrbitMembership",
        parameters: [workspaceId],
        requestBody: body("OrbitMembership"),
        responses: success("Membership saved."),
      },
    },
    "/api/orbit/workspaces/{workspaceId}/instances/{organizationId}": {
      patch: {
        tags: ["Orbit Instances"],
        summary: "Update customer limits and entitlements",
        operationId: "updateOrbitInstance",
        parameters: [workspaceId, organizationId],
        requestBody: body("OrbitInstanceUpdate"),
        responses: success("Instance updated."),
      },
    },
    "/api/orbit/workspaces/{workspaceId}/instance-claims": {
      post: {
        tags: ["Orbit Instances"],
        summary: "Issue a single-use customer-slot claim code",
        operationId: "createOrbitInstanceClaim",
        parameters: [workspaceId],
        requestBody: body("EmptyObject"),
        responses: success("Single-use claim created.", "201"),
      },
    },
    "/api/orbit/workspaces/{workspaceId}/billing": {
      get: {
        tags: ["Orbit Billing"],
        summary: "Read pricing, current projection, and finalized statements",
        operationId: "getOrbitBilling",
        parameters: [workspaceId],
        responses: success("Orbit billing overview."),
      },
      patch: {
        tags: ["Orbit Billing"],
        summary: "Update revision-controlled workspace pricing",
        operationId: "updateOrbitBilling",
        parameters: [workspaceId],
        requestBody: body("OrbitBillingUpdate"),
        responses: success("Orbit billing configuration updated."),
      },
    },
    "/api/orbit/workspaces/{workspaceId}/billing/statements/finalize": {
      post: {
        tags: ["Orbit Billing"],
        summary: "Idempotently reconcile every due billing period",
        operationId: "finalizeOrbitBillingStatement",
        parameters: [workspaceId],
        requestBody: body("OrbitBillingFinalize"),
        responses: {
          ...success("Existing statement replayed."),
          ...success("Billing statement finalized.", "201"),
        },
      },
    },
    "/api/orbit/instance-claims/redeem": {
      post: {
        tags: ["Orbit Instances"],
        summary: "Claim the current owner tenant as an Orbit instance",
        operationId: "redeemOrbitInstanceClaim",
        requestBody: body("OrbitClaimRedeem"),
        responses: success("Instance linked.", "201"),
      },
    },
    "/api/orbit/workspaces/{workspaceId}/delegations": {
      post: {
        tags: ["Orbit Access"],
        summary: "Create or update a tenant-scoped partner delegation",
        operationId: "upsertOrbitDelegation",
        parameters: [workspaceId],
        requestBody: body("OrbitDelegation"),
        responses: success("Delegation saved.", "201"),
      },
    },
    "/api/orbit/workspaces/{workspaceId}/delegations/{delegationId}": {
      delete: {
        tags: ["Orbit Access"],
        summary: "Revoke a partner delegation",
        operationId: "revokeOrbitDelegation",
        parameters: [
          workspaceId,
          {
            name: "delegationId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: success("Delegation revoked."),
      },
    },
    "/api/orbit/workspaces/{workspaceId}/transfers/preflight": {
      post: {
        tags: ["Orbit Transfers"],
        summary: "Validate a cross-tenant course copy",
        operationId: "preflightOrbitTransfer",
        parameters: [workspaceId],
        requestBody: body("OrbitTransfer"),
        responses: success("Transfer preflight."),
      },
    },
    "/api/orbit/workspaces/{workspaceId}/transfers": {
      post: {
        tags: ["Orbit Transfers"],
        summary: "Execute an idempotent isolated course copy",
        operationId: "createOrbitTransfer",
        parameters: [
          workspaceId,
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string", minLength: 8, maxLength: 180 },
          },
        ],
        requestBody: body("OrbitTransferExecution"),
        responses: {
          ...success("Transfer replay."),
          ...success("Transfer created.", "201"),
          "428": problem,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      CookieSession: {
        type: "apiKey",
        in: "cookie",
        name: "q_academy_session",
        description: "Persisted revocable tenant browser session.",
      },
    },
    schemas: {
      OrbitBootstrap: jsonSchema(orbitBootstrapSchema),
      OrbitBillingUpdate: jsonSchema(orbitBillingUpdateSchema),
      OrbitBillingFinalize: jsonSchema(orbitBillingFinalizeSchema),
      OrbitPermissionSet: jsonSchema(orbitPermissionSetSchema),
      OrbitMembership: jsonSchema(orbitMembershipSchema),
      OrbitInstanceUpdate: jsonSchema(orbitInstanceUpdateSchema),
      OrbitDelegation: jsonSchema(orbitDelegationSchema),
      OrbitClaimRedeem: jsonSchema(orbitClaimRedeemSchema),
      OrbitTransfer: jsonSchema(orbitTransferSchema),
      OrbitTransferExecution: jsonSchema(orbitTransferExecutionSchema),
      EmptyObject: { type: "object", additionalProperties: false },
      DataEnvelope: {
        type: "object",
        required: ["data", "meta"],
        properties: {
          data: {},
          meta: {
            type: "object",
            required: ["requestId", "timestamp"],
            properties: {
              requestId: { type: "string", format: "uuid" },
              timestamp: { type: "string", format: "date-time" },
            },
          },
        },
      },
      Problem: {
        type: "object",
        required: ["type", "title", "status", "detail", "code", "requestId"],
        properties: {
          type: { type: "string", format: "uri" },
          title: { type: "string" },
          status: { type: "integer" },
          detail: { type: "string" },
          code: { type: "string" },
          requestId: { type: "string", format: "uuid" },
        },
      },
    },
  },
} as const;

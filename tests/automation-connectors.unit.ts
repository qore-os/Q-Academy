import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { z } from "zod";

import zapierApp from "../integrations/automation-connectors/zapier/src/index";
import { automationMemberUpsertSchema } from "../src/lib/commerce/model";
import { openApiDocument } from "../src/lib/api/openapi";
import {
  AUTOMATION_CONNECTOR_CONTRACT_VERSION,
  AUTOMATION_CONNECTOR_REQUIRED_SCOPES,
} from "../src/lib/automation-connector";

const root = path.resolve(import.meta.dirname, "..");
const connectorsRoot = path.join(root, "integrations", "automation-connectors");

function jsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

const requestSchema = z.object({
  method: z.literal("GET"),
  path: z.string().startsWith("/api/v1/"),
  query: z.record(z.string(), z.string()),
});

const actionSchema = z.object({
  method: z.literal("POST"),
  path: z.literal("/api/v1/automation/members/upsert"),
  idempotencyHeader: z.literal("Idempotency-Key"),
  successStatuses: z.array(z.union([z.literal(200), z.literal(201)])).min(1),
  fixedInputs: z.record(z.string(), z.unknown()),
  inputs: z.record(z.string(), z.object({
    type: z.enum(["email", "string", "uuid", "boolean"]),
    required: z.boolean(),
    default: z.unknown().optional(),
    nullable: z.boolean().optional(),
    minLength: z.number().int().positive().optional(),
    maxLength: z.number().int().positive().optional(),
  })),
  outputs: z.array(z.string()).length(7),
});

const contractSchema = z.object({
  contractVersion: z.string(),
  apiVersion: z.literal("v1"),
  authentication: z.object({
    type: z.literal("bearer-api-key"),
    baseUrlPolicy: z.literal("credential-free-https-origin"),
    requiredScopes: z.array(z.string()).length(2),
  }),
  connectionTest: requestSchema.extend({ outputField: z.literal("connected") }),
  bundleOptions: requestSchema.extend({
    valueField: z.literal("id"),
    labelField: z.literal("name"),
  }),
  actions: z.object({
    upsertMember: actionSchema,
    revokeBundleAccess: actionSchema,
  }),
});

const codeFilesSchema = z.record(z.string(), z.string().nullable());
const makeComponentSchema = z.object({ codeFiles: codeFilesSchema }).passthrough();
const makeManifestSchema = z.object({
  fileVersion: z.literal(1),
  generalCodeFiles: codeFilesSchema,
  components: z.object({
    connection: z.record(z.string(), makeComponentSchema),
    module: z.record(z.string(), makeComponentSchema),
    rpc: z.record(z.string(), makeComponentSchema),
    endpoint: z.record(z.string(), makeComponentSchema),
    function: z.record(z.string(), makeComponentSchema),
    webhook: z.record(z.string(), makeComponentSchema),
  }),
  origins: z.array(z.unknown()).length(0),
});

function operationForApiPath(apiPath: string, method: "get" | "post") {
  const relativePath = apiPath.replace(/^\/api\/v1/, "");
  return openApiDocument.paths[relativePath]?.[method];
}

function outputRequiredFields() {
  const schema = openApiDocument.components.schemas.AutomationMemberUpsertResult as {
    required: string[];
  };
  return schema.required;
}

function collectJsonFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") return [];
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJsonFiles(entryPath);
    return entry.name.endsWith(".json") ? [entryPath] : [];
  });
}

test("versioned connector contract matches the authenticated backend contract", () => {
  const contract = contractSchema.parse(jsonFile(path.join(connectorsRoot, "contract.v1.json")));
  const artifact = z.object({
    artifactVersion: z.string(),
    contract: z.literal("contract.v1.json"),
    apiVersion: z.literal("v1"),
    packages: z.object({
      zapier: z.literal("zapier/package.json"),
      make: z.literal("make/makecomapp.json"),
    }),
  }).parse(jsonFile(path.join(connectorsRoot, "artifact.json")));
  const zapierPackage = z.object({ version: z.string() }).parse(
    jsonFile(path.join(connectorsRoot, artifact.packages.zapier)),
  );

  assert.equal(contract.contractVersion, AUTOMATION_CONNECTOR_CONTRACT_VERSION);
  assert.equal(artifact.artifactVersion, contract.contractVersion);
  assert.equal(zapierPackage.version, contract.contractVersion);
  assert.deepEqual(contract.authentication.requiredScopes, [...AUTOMATION_CONNECTOR_REQUIRED_SCOPES]);

  const statusOperation = operationForApiPath(contract.connectionTest.path, "get");
  assert.ok(statusOperation);
  assert.deepEqual(statusOperation["x-required-scopes"], [...AUTOMATION_CONNECTOR_REQUIRED_SCOPES]);
});

test("grant and revoke actions use the shared member-upsert schema and OpenAPI response", () => {
  const contract = contractSchema.parse(jsonFile(path.join(connectorsRoot, "contract.v1.json")));
  const grant = contract.actions.upsertMember;
  const revoke = contract.actions.revokeBundleAccess;
  const bundleId = "11111111-1111-4111-8111-111111111111";

  for (const action of [grant, revoke]) {
    assert.deepEqual(action.inputs.idempotencyKey, {
      type: "string",
      required: true,
      minLength: 8,
      maxLength: 180,
    });
  }

  assert.equal(automationMemberUpsertSchema.parse({
    email: "MEMBER@example.com",
    bundleId,
    ...grant.fixedInputs,
  }).bundleAction, "grant");
  assert.deepEqual(automationMemberUpsertSchema.parse({
    email: "member@example.com",
    bundleId,
    ...revoke.fixedInputs,
  }), {
    email: "member@example.com",
    firstName: "Mitglied",
    lastName: "",
    bundleId,
    bundleAction: "revoke",
    sendInvitation: false,
  });

  const operation = operationForApiPath(grant.path, "post");
  assert.ok(operation);
  assert.ok(operation.responses["200"]);
  assert.ok(operation.responses["201"]);
  assert.deepEqual(grant.outputs, outputRequiredFields());
  assert.deepEqual(revoke.outputs, outputRequiredFields());
});

test("Zapier app exposes API-key auth, dynamic bundles and separate grant/revoke actions", () => {
  const authentication = zapierApp.authentication;
  assert.ok(authentication);
  assert.equal(authentication.type, "custom");
  assert.deepEqual(authentication.fields?.map((field) => field.key), ["baseUrl", "apiKey"]);
  assert.deepEqual(Object.keys(zapierApp.creates), ["upsert_member", "revoke_bundle_access"]);

  const upsertFields = zapierApp.creates.upsert_member.operation.inputFields;
  const revokeFields = zapierApp.creates.revoke_bundle_access.operation.inputFields;
  assert.ok(upsertFields);
  assert.ok(revokeFields);
  const upsertBundle = upsertFields.find((field) => typeof field !== "function" && field.key === "bundleId");
  const revokeBundle = revokeFields.find((field) => typeof field !== "function" && field.key === "bundleId");
  const upsertIdempotency = upsertFields.find(
    (field) => typeof field !== "function" && field.key === "idempotencyKey",
  );
  const revokeIdempotency = revokeFields.find(
    (field) => typeof field !== "function" && field.key === "idempotencyKey",
  );
  assert.ok(upsertBundle && "choices" in upsertBundle && typeof upsertBundle.choices === "object");
  assert.ok(revokeBundle && "choices" in revokeBundle && typeof revokeBundle.choices === "object");
  assert.equal(revokeBundle.required, true);
  assert.equal(upsertIdempotency?.required, true);
  assert.equal(revokeIdempotency?.required, true);
});

test("Make manifest is origin-free, complete and wired to the canonical endpoints", () => {
  const makeRoot = path.join(connectorsRoot, "make");
  const manifest = makeManifestSchema.parse(jsonFile(path.join(makeRoot, "makecomapp.json")));
  const referencedFiles = [
    ...Object.values(manifest.generalCodeFiles),
    ...Object.values(manifest.components).flatMap((components) =>
      Object.values(components).flatMap((component) => Object.values(component.codeFiles))),
  ].filter((value): value is string => typeof value === "string");
  for (const relativePath of referencedFiles) {
    assert.ok(existsSync(path.join(makeRoot, relativePath)), `Missing Make code file: ${relativePath}`);
  }

  const base = readFileSync(path.join(makeRoot, "general", "base.iml.json"), "utf8");
  const connection = readFileSync(
    path.join(makeRoot, "connections", "q-academy-api", "q-academy-api.communication.iml.json"),
    "utf8",
  );
  const rpc = readFileSync(
    path.join(makeRoot, "rpcs", "list-bundles", "list-bundles.communication.iml.json"),
    "utf8",
  );
  const upsert = readFileSync(
    path.join(makeRoot, "modules", "upsert-member", "upsert-member.communication.iml.json"),
    "utf8",
  );
  const revoke = readFileSync(
    path.join(makeRoot, "modules", "revoke-bundle-access", "revoke-bundle-access.communication.iml.json"),
    "utf8",
  );
  const upsertParams = z.array(z.object({
    name: z.string(),
    required: z.boolean().optional(),
    validate: z.object({
      min: z.number().optional(),
      max: z.number().optional(),
    }).optional(),
  }).passthrough()).parse(jsonFile(path.join(
    makeRoot,
    "modules",
    "upsert-member",
    "upsert-member.mappable-params.iml.json",
  )));
  const revokeParams = z.array(z.object({
    name: z.string(),
    required: z.boolean().optional(),
    validate: z.object({
      min: z.number().optional(),
      max: z.number().optional(),
    }).optional(),
  }).passthrough()).parse(jsonFile(path.join(
    makeRoot,
    "modules",
    "revoke-bundle-access",
    "revoke-bundle-access.mappable-params.iml.json",
  )));
  assert.match(base, /Bearer \{\{connection\.apiKey\}\}/);
  assert.match(base, /request\.headers\.authorization/);
  assert.match(connection, /\/api\/v1\/automation\/connector-status/);
  assert.match(rpc, /\/api\/v1\/bundles/);
  assert.match(upsert, /"bundleAction": "grant"/);
  assert.match(revoke, /"bundleAction": "revoke"/);
  assert.match(upsert, /idempotency-key/);
  assert.match(revoke, /idempotency-key/);
  assert.match(upsert, /\{\{parameters\.idempotencyKey\}\}/);
  assert.match(revoke, /\{\{parameters\.idempotencyKey\}\}/);
  assert.doesNotMatch(upsert, /sha256|\bnow\b/);
  assert.doesNotMatch(revoke, /sha256|\bnow\b/);
  for (const params of [upsertParams, revokeParams]) {
    const field = params.find((candidate) => candidate.name === "idempotencyKey");
    assert.deepEqual(field && {
      required: field.required,
      validate: field.validate,
    }, {
      required: true,
      validate: { min: 8, max: 180 },
    });
  }
});

test("connector artifacts are valid JSON and contain no committed secret files", () => {
  for (const filePath of collectJsonFiles(connectorsRoot)) jsonFile(filePath);
  assert.equal(existsSync(path.join(connectorsRoot, "make", ".secrets")), false);
  assert.equal(existsSync(path.join(connectorsRoot, "zapier", ".zapierapprc")), false);
  const source = collectJsonFiles(connectorsRoot)
    .filter((filePath) => !filePath.endsWith("package-lock.json"))
    .map((filePath) => readFileSync(filePath, "utf8"))
    .join("\n");
  assert.doesNotMatch(source, /qak_(?:live|test)_[A-Za-z0-9_-]{12,}/);

  const ciWorkflow = readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(
    ciWorkflow,
    /npm ci --prefix integrations\/automation-connectors\/zapier/,
  );
  assert.match(
    ciWorkflow,
    /npm --prefix integrations\/automation-connectors\/zapier run validate/,
  );
});

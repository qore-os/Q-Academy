import { defineInputFields } from "zapier-platform-core";
import { listBundles } from "../choices/list-bundles.js";

export const idempotencyField = {
  key: "idempotencyKey",
  label: "Idempotency key",
  type: "string",
  required: true,
  helpText: "Stable 8-180 character key. Reuse it only when retrying the same request.",
} as const;

export const upsertInputFields = defineInputFields([
  { key: "email", label: "Email", type: "string", required: true },
  { key: "firstName", label: "First name", type: "string", required: false, default: "Mitglied" },
  { key: "lastName", label: "Last name", type: "string", required: false },
  {
    key: "bundleId",
    label: "Bundle to grant",
    type: "string",
    required: false,
    choices: { perform: listBundles },
  },
  { key: "sendInvitation", label: "Send invitation", type: "boolean", required: false, default: "true" },
  idempotencyField,
]);

export const revokeInputFields = defineInputFields([
  { key: "email", label: "Email", type: "string", required: true },
  {
    key: "bundleId",
    label: "Bundle to revoke",
    type: "string",
    required: true,
    choices: { perform: listBundles },
  },
  idempotencyField,
]);

export const memberOutputFields = [
  { key: "id", label: "Member ID", type: "string" },
  { key: "email", label: "Email", type: "string" },
  { key: "status", label: "Member status", type: "string" },
  { key: "created", label: "Created", type: "boolean" },
  { key: "bundleId", label: "Bundle ID", type: "string" },
  { key: "bundleAction", label: "Bundle action", type: "string" },
  { key: "bundleAccessChanged", label: "Bundle access changed", type: "boolean" },
] as const;

export const memberSample = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "member@example.com",
  status: "invited",
  created: true,
  bundleId: "11111111-1111-4111-8111-111111111111",
  bundleAction: "grant",
  bundleAccessChanged: true,
} as const;

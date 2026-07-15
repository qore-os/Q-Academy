import {
  defineCreate,
  type CreatePerform,
  type InferInputData,
} from "zapier-platform-core";
import { mutateMember } from "../api.js";
import { memberOutputFields, memberSample, upsertInputFields } from "./shared-fields.js";

const perform = (async (z, bundle) => mutateMember(z, bundle, {
  email: bundle.inputData.email,
  firstName: bundle.inputData.firstName || "Mitglied",
  lastName: bundle.inputData.lastName || "",
  bundleId: bundle.inputData.bundleId || null,
  bundleAction: "grant",
  sendInvitation: bundle.inputData.sendInvitation ?? true,
}, bundle.inputData.idempotencyKey)) satisfies CreatePerform<InferInputData<typeof upsertInputFields>>;

export default defineCreate({
  key: "upsert_member",
  noun: "Member",
  display: {
    label: "Create or Update Member",
    description: "Creates or updates a member and optionally grants bundle access.",
  },
  operation: {
    inputFields: upsertInputFields,
    perform,
    sample: memberSample,
    outputFields: [...memberOutputFields],
  },
});

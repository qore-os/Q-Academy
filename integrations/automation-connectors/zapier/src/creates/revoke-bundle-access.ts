import {
  defineCreate,
  type CreatePerform,
  type InferInputData,
} from "zapier-platform-core";
import { mutateMember } from "../api.js";
import { memberOutputFields, memberSample, revokeInputFields } from "./shared-fields.js";

const perform = (async (z, bundle) => mutateMember(z, bundle, {
  email: bundle.inputData.email,
  bundleId: bundle.inputData.bundleId,
  bundleAction: "revoke",
  sendInvitation: false,
}, bundle.inputData.idempotencyKey)) satisfies CreatePerform<InferInputData<typeof revokeInputFields>>;

export default defineCreate({
  key: "revoke_bundle_access",
  noun: "Bundle Access",
  display: {
    label: "Revoke Bundle Access",
    description: "Revokes access that was granted by the automation source.",
  },
  operation: {
    inputFields: revokeInputFields,
    perform,
    sample: { ...memberSample, created: false, bundleAction: "revoke" },
    outputFields: [...memberOutputFields],
  },
});

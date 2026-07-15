import zapier, { defineApp } from "zapier-platform-core";
import packageJson from "../package.json" with { type: "json" };
import authentication from "./authentication.js";
import revokeBundleAccess from "./creates/revoke-bundle-access.js";
import upsertMember from "./creates/upsert-member.js";
import { addBearerHeader, exposeProblemDetails } from "./middleware.js";

export default defineApp({
  version: packageJson.version,
  platformVersion: zapier.version,
  authentication,
  beforeRequest: [addBearerHeader],
  afterResponse: [exposeProblemDetails],
  flags: { cleanInputData: false },
  triggers: {},
  searches: {},
  creates: {
    [upsertMember.key]: upsertMember,
    [revokeBundleAccess.key]: revokeBundleAccess,
  },
});

import "server-only";

import { randomBytes } from "node:crypto";
import { apiKeys } from "@/db/schema";

export const apiKeyPublicFields = {
  id: apiKeys.id,
  name: apiKeys.name,
  prefix: apiKeys.prefix,
  scopes: apiKeys.scopes,
  status: apiKeys.status,
  lastUsedAt: apiKeys.lastUsedAt,
  expiresAt: apiKeys.expiresAt,
  revokedAt: apiKeys.revokedAt,
  createdAt: apiKeys.createdAt,
};

export function generateApiKey() {
  return `qak_live_${randomBytes(32).toString("base64url")}`;
}

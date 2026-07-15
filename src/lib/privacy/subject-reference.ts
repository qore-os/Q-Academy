import "server-only";

import { createHmac } from "node:crypto";
import { getPrivacySubjectHmacSecret } from "@/lib/server-environment";

export function privacySubjectReference(
  organizationId: string,
  subjectUserId: string,
) {
  return privacyIdentityReference(organizationId, "subject", subjectUserId);
}

export function privacyActorReference(
  organizationId: string,
  actorKind: "user" | "api_key" | "system",
  actorId: string,
) {
  return privacyIdentityReference(organizationId, `actor:${actorKind}`, actorId);
}

export function privacyEmailRecipientReference(
  organizationId: string,
  email: string,
) {
  return privacyIdentityReference(
    organizationId,
    "email-recipient",
    email.trim().toLowerCase(),
  );
}

function privacyIdentityReference(
  organizationId: string,
  namespace: string,
  identity: string,
) {
  return createHmac("sha256", getPrivacySubjectHmacSecret())
    .update("q-academy:privacy-identity:v1\0")
    .update(organizationId)
    .update("\0")
    .update(namespace)
    .update("\0")
    .update(identity)
    .digest("hex");
}

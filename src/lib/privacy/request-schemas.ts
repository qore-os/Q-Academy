import { z } from "zod";

export const privacyRequestCreateSchema = z.object({
  subjectUserId: z.string().uuid(),
  clientRequestId: z
    .string()
    .trim()
    .min(4)
    .max(180)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  type: z.enum(["access_export", "erasure"]),
});

export const privacyStepUpSchema = z.object({
  // SSO-only tenants submit no password; the centralized verifier requires
  // a fresh OIDC authentication in that mode and still rejects an empty
  // password for password-enabled tenants.
  password: z.string().max(256),
});

export function privacyStepUpPassword(formData: FormData) {
  const password = formData.get("password");
  return typeof password === "string" ? password : "";
}

export const privacyReasonStepUpSchema = privacyStepUpSchema.extend({
  reason: z.string().trim().min(4).max(1_000),
});

export const privacyLegalHoldCreateSchema = privacyReasonStepUpSchema.extend({
  reference: z
    .string()
    .trim()
    .min(4)
    .max(180)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
  legalBasis: z.string().trim().min(4).max(1_000),
  scope: z.enum([
    "all",
    "profile",
    "authentication",
    "learning",
    "certificates",
    "community",
    "feedback",
    "events",
    "gamification",
    "ai",
    "media",
    "audit",
    "integrations",
    "communications",
  ]),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

export const privacyLegalHoldReleaseSchema = privacyReasonStepUpSchema;

export type PrivacyRequestCreateInput = z.infer<
  typeof privacyRequestCreateSchema
>;

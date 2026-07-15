import { z } from "zod";
import {
  authenticationLinkRenderedPayloadSchema,
  authenticationLinkSourcePayloadSchema,
  courseModulesReleasedStoredPayloadSchema,
  MAX_RENDERED_EMAIL_HTML_LENGTH,
  plainTextToSafeEmailHtml,
  renderedEmailMessageSchema,
  renderedEmailSubjectSchema,
} from "@/lib/email-center-model";
import { brandLogoSource } from "@/lib/branding-asset-policy";
import type { TenantBranding } from "@/lib/branding-model";
import type { AppLocale } from "@/lib/i18n/model";

const gatewayLinkSchema = z
  .string()
  .url()
  .max(2_000)
  .refine((value) => /^https?:\/\//i.test(value));
const safeMessageShape = {
  subject: renderedEmailSubjectSchema,
  message: renderedEmailMessageSchema,
  html: z.string().max(MAX_RENDERED_EMAIL_HTML_LENGTH).optional(),
  locale: z.enum(["de", "en", "it", "es", "fr"]).optional(),
};
function validateDerivedHtml(
  payload: { message: string; html?: string },
  context: z.RefinementCtx,
) {
  if (
    payload.html !== undefined &&
    payload.html !== plainTextToSafeEmailHtml(payload.message)
  ) {
    context.addIssue({
      code: "custom",
      path: ["html"],
      message: "HTML muss exakt aus dem Plaintext abgeleitet sein.",
    });
  }
}
const feedbackReplyPayloadSchema = z
  .object(safeMessageShape)
  .strict()
  .superRefine(validateDerivedHtml);
const lessonAvailablePayloadSchema = z
  .object({ ...safeMessageShape, link: gatewayLinkSchema })
  .strict()
  .superRefine(validateDerivedHtml);
const eventLifecyclePayloadSchema = lessonAvailablePayloadSchema;
const templateTestPayloadSchema = feedbackReplyPayloadSchema;
const authLinkPayloadSchema = z.union([
  authenticationLinkSourcePayloadSchema,
  authenticationLinkRenderedPayloadSchema.superRefine(validateDerivedHtml),
]);

export type EmailTenantBranding = {
  organizationId: string;
  name: string;
  platformName: string;
  primaryColor: string;
  accentColor: string;
  senderName: string;
  logoUrl: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  locale: AppLocale;
};

function absoluteBrandAsset(source: string | null, origin: string) {
  if (!source) return null;
  try {
    const resolved = new URL(source, origin);
    return ["http:", "https:"].includes(resolved.protocol) &&
      !resolved.username &&
      !resolved.password
      ? resolved.toString()
      : null;
  } catch {
    return null;
  }
}

export function emailTenantBrandingFromTenantBranding(input: {
  branding: TenantBranding;
  organizationName: string;
  assetOrigin: string;
  locale?: AppLocale;
}): EmailTenantBranding {
  if (!input.branding.organizationId) {
    throw new Error("E-Mail-Branding benoetigt eine Organisation.");
  }
  const logoLightUrl = absoluteBrandAsset(
    brandLogoSource(input.branding, "light"),
    input.assetOrigin,
  );
  const logoDarkUrl = absoluteBrandAsset(
    brandLogoSource(input.branding, "dark"),
    input.assetOrigin,
  );
  return {
    organizationId: input.branding.organizationId,
    name: input.organizationName,
    platformName: input.branding.platformName,
    primaryColor: input.branding.primaryColor,
    accentColor: input.branding.accentColor,
    senderName: input.branding.emailSenderName,
    logoUrl: logoLightUrl,
    logoLightUrl,
    logoDarkUrl,
    locale: input.locale ?? "de",
  };
}

export function canDispatchEmailToRecipient(input: {
  event: string;
  recipientStatus: string;
  recipientRole: string;
}) {
  switch (input.event) {
    case "invitation.created":
      return input.recipientStatus === "invited";
    case "password.reset":
      return input.recipientStatus === "active";
    case "feedback.reply":
    case "lesson.available":
    case "course.modules.released":
    case "event.rescheduled":
    case "event.cancelled":
      return (
        input.recipientStatus === "active" && input.recipientRole === "member"
      );
    case "email.template.test":
      return (
        input.recipientStatus === "active" &&
        ["owner", "admin"].includes(input.recipientRole)
      );
    default:
      return false;
  }
}

export function buildEmailGatewayRequest(input: {
  event: string;
  email: string;
  decryptedPayload: unknown;
  tenantBranding: EmailTenantBranding;
}) {
  switch (input.event) {
    case "invitation.created":
    case "password.reset": {
      const payload = authLinkPayloadSchema.parse(input.decryptedPayload);
      return {
        event: input.event,
        email: input.email,
        link: payload.link,
        ...("subject" in payload
          ? {
              subject: payload.subject,
              message: payload.message,
              ...(payload.html ? { html: payload.html } : {}),
            }
          : {}),
        tenantBranding: input.tenantBranding,
      };
    }
    case "feedback.reply": {
      const payload = feedbackReplyPayloadSchema.parse(input.decryptedPayload);
      return {
        event: input.event,
        email: input.email,
        subject: payload.subject,
        message: payload.message,
        ...(payload.html ? { html: payload.html } : {}),
        tenantBranding: input.tenantBranding,
      };
    }
    case "lesson.available": {
      const payload = lessonAvailablePayloadSchema.parse(input.decryptedPayload);
      return {
        event: input.event,
        email: input.email,
        subject: payload.subject,
        message: payload.message,
        ...(payload.html ? { html: payload.html } : {}),
        link: payload.link,
        tenantBranding: input.tenantBranding,
      };
    }
    case "course.modules.released": {
      const payload = courseModulesReleasedStoredPayloadSchema.parse(
        input.decryptedPayload,
      );
      return {
        event: input.event,
        email: input.email,
        subject: payload.subject,
        message: payload.message,
        html: payload.html,
        link: payload.link,
        tenantBranding: input.tenantBranding,
      };
    }
    case "event.rescheduled":
    case "event.cancelled": {
      const payload = eventLifecyclePayloadSchema.parse(input.decryptedPayload);
      return {
        event: input.event,
        email: input.email,
        subject: payload.subject,
        message: payload.message,
        ...(payload.html ? { html: payload.html } : {}),
        link: payload.link,
        tenantBranding: input.tenantBranding,
      };
    }
    case "email.template.test": {
      const payload = templateTestPayloadSchema.parse(input.decryptedPayload);
      return {
        event: input.event,
        email: input.email,
        subject: payload.subject,
        message: payload.message,
        ...(payload.html ? { html: payload.html } : {}),
        tenantBranding: input.tenantBranding,
      };
    }
    default:
      throw new Error("Nicht unterstuetztes E-Mail-Ereignis.");
  }
}

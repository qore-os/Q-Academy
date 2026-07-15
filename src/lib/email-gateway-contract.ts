import { z } from "zod";
import {
  authenticationLinkRenderedPayloadSchema,
  courseModulesReleasedStoredPayloadSchema,
  MAX_RENDERED_EMAIL_HTML_LENGTH,
  plainTextToSafeEmailHtml,
  renderedEmailMessageSchema,
  renderedEmailSubjectSchema,
} from "@/lib/email-center-model";
import { brandLogoSource } from "@/lib/branding-asset-policy";
import type { TenantBranding } from "@/lib/branding-model";
import {
  SUPPORTED_LOCALES,
  type AppLocale,
} from "@/lib/i18n/model";

const gatewayLinkSchema = z
  .string()
  .url()
  .max(2_000)
  .refine((value) => /^https?:\/\//i.test(value));
const safeMessageShape = {
  subject: renderedEmailSubjectSchema,
  message: renderedEmailMessageSchema,
  html: z.string().max(MAX_RENDERED_EMAIL_HTML_LENGTH).optional(),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
};
const gatewayMessageShape = {
  subject: renderedEmailSubjectSchema,
  message: renderedEmailMessageSchema,
  html: z.string().max(MAX_RENDERED_EMAIL_HTML_LENGTH).optional(),
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
const authLinkPayloadSchema =
  authenticationLinkRenderedPayloadSchema.superRefine(validateDerivedHtml);

const gatewayEmailSchema = z.string().email().max(255);
const gatewayColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const gatewayDisplayNameSchema = (minimum: number, maximum: number) =>
  z
    .string()
    .min(minimum)
    .max(maximum)
    .refine((value) => value.trim() === value)
    .regex(/^[^\u0000-\u001f\u007f]+$/);
const gatewaySenderNameSchema = gatewayDisplayNameSchema(2, 120).regex(
  /^[^<>"\\]+$/,
);
const gatewayBrandAssetSchema = z
  .string()
  .url()
  .max(2_000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  })
  .nullable();

export const emailTenantBrandingSchema = z
  .object({
    organizationId: z.string().uuid(),
    name: gatewayDisplayNameSchema(1, 160),
    platformName: gatewayDisplayNameSchema(2, 120),
    primaryColor: gatewayColorSchema,
    accentColor: gatewayColorSchema,
    senderName: gatewaySenderNameSchema,
    logoUrl: gatewayBrandAssetSchema,
    logoLightUrl: gatewayBrandAssetSchema,
    logoDarkUrl: gatewayBrandAssetSchema,
    locale: z.enum(SUPPORTED_LOCALES),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.logoUrl !== value.logoLightUrl) {
      context.addIssue({
        code: "custom",
        path: ["logoUrl"],
        message: "Das Standardlogo muss dem hellen Logo entsprechen.",
      });
    }
  });

const gatewayRequestBaseShape = {
  email: gatewayEmailSchema,
  tenantBranding: emailTenantBrandingSchema,
};
const invitationGatewayRequestSchema = z
  .object({
    event: z.literal("invitation.created"),
    ...gatewayRequestBaseShape,
    ...gatewayMessageShape,
    link: gatewayLinkSchema,
  })
  .strict()
  .superRefine(validateDerivedHtml);
const passwordResetGatewayRequestSchema = z
  .object({
    event: z.literal("password.reset"),
    ...gatewayRequestBaseShape,
    ...gatewayMessageShape,
    link: gatewayLinkSchema,
  })
  .strict()
  .superRefine(validateDerivedHtml);
const feedbackReplyGatewayRequestSchema = z
  .object({
    event: z.literal("feedback.reply"),
    ...gatewayRequestBaseShape,
    ...gatewayMessageShape,
  })
  .strict()
  .superRefine(validateDerivedHtml);
const lessonAvailableGatewayRequestSchema = z
  .object({
    event: z.literal("lesson.available"),
    ...gatewayRequestBaseShape,
    ...gatewayMessageShape,
    link: gatewayLinkSchema,
  })
  .strict()
  .superRefine(validateDerivedHtml);
const courseModulesReleasedGatewayRequestSchema = z
  .object({
    event: z.literal("course.modules.released"),
    ...gatewayRequestBaseShape,
    subject: renderedEmailSubjectSchema,
    message: renderedEmailMessageSchema,
    html: z.string().max(MAX_RENDERED_EMAIL_HTML_LENGTH),
    link: gatewayLinkSchema,
  })
  .strict()
  .superRefine(validateDerivedHtml);
const eventRescheduledGatewayRequestSchema = z
  .object({
    event: z.literal("event.rescheduled"),
    ...gatewayRequestBaseShape,
    ...gatewayMessageShape,
    link: gatewayLinkSchema,
  })
  .strict()
  .superRefine(validateDerivedHtml);
const eventCancelledGatewayRequestSchema = z
  .object({
    event: z.literal("event.cancelled"),
    ...gatewayRequestBaseShape,
    ...gatewayMessageShape,
    link: gatewayLinkSchema,
  })
  .strict()
  .superRefine(validateDerivedHtml);
const templateTestGatewayRequestSchema = z
  .object({
    event: z.literal("email.template.test"),
    ...gatewayRequestBaseShape,
    ...gatewayMessageShape,
  })
  .strict()
  .superRefine(validateDerivedHtml);

// Immutable snapshot wire contract. Future gateway fields require a V2 schema.
export const emailGatewayRequestV1Schema = z.union([
  invitationGatewayRequestSchema,
  passwordResetGatewayRequestSchema,
  feedbackReplyGatewayRequestSchema,
  lessonAvailableGatewayRequestSchema,
  courseModulesReleasedGatewayRequestSchema,
  eventRescheduledGatewayRequestSchema,
  eventCancelledGatewayRequestSchema,
  templateTestGatewayRequestSchema,
]);
export const emailGatewayRequestSchema = emailGatewayRequestV1Schema;

export type EmailGatewayRequestV1 = z.infer<
  typeof emailGatewayRequestV1Schema
>;
export type EmailGatewayRequest = EmailGatewayRequestV1;

export type EmailTenantBranding = z.infer<typeof emailTenantBrandingSchema>;

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
}): EmailGatewayRequest {
  switch (input.event) {
    case "invitation.created":
    case "password.reset": {
      const payload = authLinkPayloadSchema.parse(input.decryptedPayload);
      return emailGatewayRequestSchema.parse({
        event: input.event,
        email: input.email,
        link: payload.link,
        subject: payload.subject,
        message: payload.message,
        ...(payload.html ? { html: payload.html } : {}),
        tenantBranding: input.tenantBranding,
      });
    }
    case "feedback.reply": {
      const payload = feedbackReplyPayloadSchema.parse(input.decryptedPayload);
      return emailGatewayRequestSchema.parse({
        event: input.event,
        email: input.email,
        subject: payload.subject,
        message: payload.message,
        ...(payload.html ? { html: payload.html } : {}),
        tenantBranding: input.tenantBranding,
      });
    }
    case "lesson.available": {
      const payload = lessonAvailablePayloadSchema.parse(input.decryptedPayload);
      return emailGatewayRequestSchema.parse({
        event: input.event,
        email: input.email,
        subject: payload.subject,
        message: payload.message,
        ...(payload.html ? { html: payload.html } : {}),
        link: payload.link,
        tenantBranding: input.tenantBranding,
      });
    }
    case "course.modules.released": {
      const payload = courseModulesReleasedStoredPayloadSchema.parse(
        input.decryptedPayload,
      );
      return emailGatewayRequestSchema.parse({
        event: input.event,
        email: input.email,
        subject: payload.subject,
        message: payload.message,
        html: payload.html,
        link: payload.link,
        tenantBranding: input.tenantBranding,
      });
    }
    case "event.rescheduled":
    case "event.cancelled": {
      const payload = eventLifecyclePayloadSchema.parse(input.decryptedPayload);
      return emailGatewayRequestSchema.parse({
        event: input.event,
        email: input.email,
        subject: payload.subject,
        message: payload.message,
        ...(payload.html ? { html: payload.html } : {}),
        link: payload.link,
        tenantBranding: input.tenantBranding,
      });
    }
    case "email.template.test": {
      const payload = templateTestPayloadSchema.parse(input.decryptedPayload);
      return emailGatewayRequestSchema.parse({
        event: input.event,
        email: input.email,
        subject: payload.subject,
        message: payload.message,
        ...(payload.html ? { html: payload.html } : {}),
        tenantBranding: input.tenantBranding,
      });
    }
    default:
      throw new Error("Nicht unterstuetztes E-Mail-Ereignis.");
  }
}

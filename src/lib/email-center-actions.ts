"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { ApiError } from "@/lib/api/errors";
import { requireTeamPermission } from "@/lib/auth";
import {
  queueEmailTemplateTest,
  retryFailedEmailDelivery,
  updateEmailTemplateSettings,
} from "@/lib/email-center";
import {
  EMAIL_TEMPLATE_EVENTS,
  emailTemplateSettingsSchema,
} from "@/lib/email-center-model";
import { listMemberPropertyVariableCatalog } from "@/lib/member-properties";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import {
  getEmailDeliveryCopy,
  type EmailDeliveryMessageCode,
} from "@/lib/i18n/email-delivery";
import { resolveUserLocale } from "@/lib/i18n/server";
import { logServerError } from "@/lib/server-error-logging";
import { SUPPORTED_LOCALES } from "@/lib/i18n/model";

export type EmailCenterActionState = {
  ok: boolean | null;
  message: string;
  messageCode?: EmailDeliveryMessageCode;
  resourceId?: string;
};

const initialFailure = (
  message: string,
  messageCode?: EmailDeliveryMessageCode,
): EmailCenterActionState => ({
  ok: false,
  message,
  messageCode,
});

export async function updateEmailTemplatesAction(
  _state: EmailCenterActionState,
  formData: FormData,
): Promise<EmailCenterActionState> {
  const actor = await requireTeamPermission("settings.manage");
  const locale = z.enum(SUPPORTED_LOCALES).safeParse(formData.get("locale"));
  if (!locale.success) return initialFailure("Bitte eine Sprache auswaehlen.");
  const copy = getCoreDictionary(locale.data).experience.emailCenter;
  const propertyCatalog = await listMemberPropertyVariableCatalog(
    actor.organizationId,
  );
  const propertyVariables = propertyCatalog.map((entry) => entry.emailToken);
  const parsed = emailTemplateSettingsSchema({
    "feedback.reply": propertyVariables,
    "lesson.available": propertyVariables,
  }).safeParse({
    version: 1,
    templates: {
      "feedback.reply": {
        subject: formData.get("feedbackSubject"),
        body: formData.get("feedbackBody"),
      },
      "lesson.available": {
        subject: formData.get("lessonSubject"),
        body: formData.get("lessonBody"),
      },
      "course.modules.released": {
        subject: formData.get("courseModulesReleasedSubject"),
        body: formData.get("courseModulesReleasedBody"),
      },
      "invitation.created": {
        subject: formData.get("invitationSubject"),
        body: formData.get("invitationBody"),
      },
      "password.reset": {
        subject: formData.get("passwordResetSubject"),
        body: formData.get("passwordResetBody"),
      },
    },
  });
  if (!parsed.success) {
    return initialFailure(copy.validationHint);
  }
  try {
    const saved = await db.transaction((tx) =>
      updateEmailTemplateSettings(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        source: "admin_ui",
        settings: parsed.data,
        locale: locale.data,
      }),
    );
    revalidatePath("/admin/email", "layout");
    return {
      ok: true,
      message: saved.changed ? copy.saveSuccess : copy.noChanges,
    };
  } catch (error) {
    if (error instanceof ApiError) return initialFailure(copy.saveFailed);
    logServerError(error, { action: "platform.email_templates.update" });
    return initialFailure(copy.saveFailed);
  }
}

const deliveryIdSchema = z.string().uuid();

export async function retryEmailDeliveryAction(
  _state: EmailCenterActionState,
  formData: FormData,
): Promise<EmailCenterActionState> {
  const actor = await requireTeamPermission("settings.manage");
  const parsedLocale = z.enum(SUPPORTED_LOCALES).safeParse(formData.get("locale"));
  const locale = parsedLocale.success
    ? parsedLocale.data
    : await resolveUserLocale(actor);
  const copy = getEmailDeliveryCopy(locale);
  const deliveryId = deliveryIdSchema.safeParse(formData.get("deliveryId"));
  if (!deliveryId.success) {
    return initialFailure(
      copy.messages["emailDelivery.invalid"],
      "emailDelivery.invalid",
    );
  }
  try {
    const result = await db.transaction((tx) =>
      retryFailedEmailDelivery(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        deliveryId: deliveryId.data,
        source: "admin_ui",
      }),
    );
    revalidatePath("/admin/email");
    revalidatePath(`/admin/email/${deliveryId.data}`);
    return {
      ok: true,
      message: result.changed
        ? copy.messages["emailDelivery.queued"]
        : copy.messages["emailDelivery.alreadyQueued"],
      messageCode: result.changed
        ? "emailDelivery.queued"
        : "emailDelivery.alreadyQueued",
      resourceId: deliveryId.data,
    };
  } catch (error) {
    if (!(error instanceof ApiError)) {
      logServerError(error, { action: "email.delivery.retry" });
    }
    return initialFailure(
      copy.messages["emailDelivery.retryFailed"],
      "emailDelivery.retryFailed",
    );
  }
}

const testDeliverySchema = z
  .object({
    event: z.enum(EMAIL_TEMPLATE_EVENTS),
    requestId: z.string().uuid(),
    locale: z.enum(SUPPORTED_LOCALES),
  })
  .strict();

export async function queueEmailTemplateTestAction(
  _state: EmailCenterActionState,
  formData: FormData,
): Promise<EmailCenterActionState> {
  const actor = await requireTeamPermission("settings.manage");
  const parsed = testDeliverySchema.safeParse({
    event: formData.get("event"),
    requestId: formData.get("requestId"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return initialFailure("Testsendung ist ungueltig.");
  const copy = getCoreDictionary(parsed.data.locale).experience.emailCenter;
  try {
    const result = await db.transaction((tx) =>
      queueEmailTemplateTest(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        event: parsed.data.event,
        requestId: parsed.data.requestId,
        source: "admin_ui",
        locale: parsed.data.locale,
      }),
    );
    revalidatePath("/admin/email", "layout");
    return {
      ok: true,
      message: result.changed ? copy.testQueued : copy.testDuplicate,
      resourceId: result.delivery.id,
    };
  } catch (error) {
    if (error instanceof ApiError) return initialFailure(copy.testFailed);
    logServerError(error, { action: "email.template_test.queue" });
    return initialFailure(copy.testFailed);
  }
}

"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  courseCertificates,
  notifications,
} from "@/db/schema";
import { requireTeamPermission } from "@/lib/auth";
import { issueCourseCertificate } from "@/lib/certificates";
import { logServerError } from "@/lib/server-error-logging";
import { getCertificateCopy } from "@/lib/i18n/certificates";
import { resolveRecipientLocale } from "@/lib/i18n/server";

export type CertificateMessageCode =
  | "invalid"
  | "reason_too_long"
  | "not_found_or_revoked"
  | "revoked"
  | "revoke_failed"
  | "not_found"
  | "disabled"
  | "incomplete"
  | "member_course_not_found"
  | "issue_failed"
  | "reissued"
  | "already_active"
  | "reissue_failed";

export type CertificateActionState = {
  ok: boolean | null;
  message: string;
  messageCode?: CertificateMessageCode;
};

const identifierSchema = z.string().uuid();

function refreshCertificatePages(certificateId?: string, memberId?: string) {
  revalidatePath("/admin/certificates");
  revalidatePath("/academy/certificates");
  revalidatePath("/academy", "layout");
  if (certificateId) {
    revalidatePath(`/admin/certificates/${certificateId}`);
    revalidatePath(`/academy/certificates/${certificateId}`);
  }
  if (memberId) revalidatePath(`/admin/members/${memberId}`);
}

export async function revokeCertificateAction(
  certificateId: string,
  _state: CertificateActionState,
  formData: FormData,
): Promise<CertificateActionState> {
  const actor = await requireTeamPermission("members.manage");
  const parsedId = identifierSchema.safeParse(certificateId);
  if (!parsedId.success) {
    return {
      ok: false,
      message: "Das Zertifikat ist ungueltig.",
      messageCode: "invalid",
    };
  }
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length > 500) {
    return {
      ok: false,
      message: "Die Begruendung ist zu lang.",
      messageCode: "reason_too_long",
    };
  }

  try {
    const revoked = await db.transaction(async (tx) => {
      const [certificate] = await tx
        .update(courseCertificates)
        .set({
          revokedAt: new Date(),
          revokedById: actor.id,
          revocationReason: reason || null,
        })
        .where(
          and(
            eq(courseCertificates.id, parsedId.data),
            eq(courseCertificates.organizationId, actor.organizationId),
            isNull(courseCertificates.revokedAt),
          ),
        )
        .returning();
      if (!certificate) return null;

      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "certificate.revoked",
        entityType: "course_certificate",
        entityId: certificate.id,
        metadata: {
          recipientUserId: certificate.userId,
          courseId: certificate.courseId,
          reason: certificate.revocationReason,
        },
      });
      const recipientLocale = await resolveRecipientLocale(tx, {
        organizationId: actor.organizationId,
        userId: certificate.userId,
      });
      const notificationCopy = getCertificateCopy(recipientLocale).notification;
      await tx.insert(notifications).values({
        userId: certificate.userId,
        title: notificationCopy.revokedTitle,
        body: notificationCopy.revokedBody(certificate.courseTitle),
        type: "warning",
        category: "learning",
        href: `/academy/certificates/${certificate.id}`,
      });
      return certificate;
    });
    if (!revoked) {
      return {
        ok: false,
        message: "Das Zertifikat wurde nicht gefunden oder ist bereits widerrufen.",
        messageCode: "not_found_or_revoked",
      };
    }
    refreshCertificatePages(revoked.id, revoked.userId);
    return {
      ok: true,
      message: "Zertifikat widerrufen.",
      messageCode: "revoked",
    };
  } catch (error) {
    logServerError(error, { action: "certificate.revoke" });
    return {
      ok: false,
      message: "Das Zertifikat konnte nicht widerrufen werden.",
      messageCode: "revoke_failed",
    };
  }
}

export async function reissueCertificateAction(
  certificateId: string,
  _state: CertificateActionState,
  _formData: FormData,
): Promise<CertificateActionState> {
  void _state;
  void _formData;
  const actor = await requireTeamPermission("members.manage");
  const parsedId = identifierSchema.safeParse(certificateId);
  if (!parsedId.success) {
    return {
      ok: false,
      message: "Das Zertifikat ist ungueltig.",
      messageCode: "invalid",
    };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [source] = await tx
        .select({
          userId: courseCertificates.userId,
          courseId: courseCertificates.courseId,
        })
        .from(courseCertificates)
        .where(
          and(
            eq(courseCertificates.id, parsedId.data),
            eq(courseCertificates.organizationId, actor.organizationId),
          ),
        )
        .limit(1);
      if (!source) return null;
      const issuance = await issueCourseCertificate(tx, {
        organizationId: actor.organizationId,
        userId: source.userId,
        courseId: source.courseId,
        issuedById: actor.id,
      });
      return { source, issuance };
    });
    if (!result) {
      return {
        ok: false,
        message: "Das Zertifikat wurde nicht gefunden.",
        messageCode: "not_found",
      };
    }
    if (result.issuance.status === "disabled") {
      return {
        ok: false,
        message: "Zertifikate sind fuer diesen Kurs deaktiviert.",
        messageCode: "disabled",
      };
    }
    if (result.issuance.status === "incomplete") {
      return {
        ok: false,
        message: "Der Kursabschluss ist serverseitig nicht mehr vollstaendig nachweisbar.",
        messageCode: "incomplete",
      };
    }
    if (result.issuance.status === "not_found") {
      return {
        ok: false,
        message: "Mitglied oder Kurs wurde nicht gefunden.",
        messageCode: "member_course_not_found",
      };
    }
    const certificate = result.issuance.certificate;
    if (!certificate) {
      return {
        ok: false,
        message: "Das Zertifikat konnte nicht ausgestellt werden.",
        messageCode: "issue_failed",
      };
    }
    refreshCertificatePages(certificate.id, result.source.userId);
    return {
      ok: true,
      message:
        result.issuance.status === "issued"
          ? "Zertifikat neu ausgestellt."
          : "Es besteht bereits ein aktives Zertifikat.",
      messageCode:
        result.issuance.status === "issued" ? "reissued" : "already_active",
    };
  } catch (error) {
    logServerError(error, { action: "certificate.reissue" });
    return {
      ok: false,
      message: "Das Zertifikat konnte nicht neu ausgestellt werden.",
      messageCode: "reissue_failed",
    };
  }
}

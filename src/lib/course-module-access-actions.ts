"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { activityEvents } from "@/db/schema";
import { requireTeamPermission, requireUser } from "@/lib/auth";
import {
  cancelCourseModuleAccessRequestInTransaction,
  createCourseModuleAccessRequestInTransaction,
  decideCourseModuleAccessRequestInTransaction,
  deleteCourseModuleAccessOverrideInTransaction,
  upsertCourseModuleAccessOverrideInTransaction,
} from "@/lib/course-module-access-service";
import { logServerError } from "@/lib/server-error-logging";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import { normalizeLocale } from "@/lib/i18n/model";
import { resolveUserLocale } from "@/lib/i18n/server";

export type CourseModuleAccessActionState = {
  ok: boolean | null;
  message: string;
  resourceId?: string;
};

const initialError = (message: string): CourseModuleAccessActionState => ({
  ok: false,
  message,
});

const uuidSchema = z.string().uuid();
const requestSchema = z.object({
  courseId: uuidSchema,
  moduleId: uuidSchema,
  message: z.string().trim().max(1_000).nullable(),
});
const decisionSchema = z.object({
  requestId: uuidSchema,
  decision: z.enum(["approved", "rejected"]),
  decisionNote: z.string().trim().max(1_000).nullable(),
  expiresAt: z.date().nullable(),
});
const overrideSchema = z.object({
  courseId: uuidSchema,
  moduleId: uuidSchema,
  userId: uuidSchema,
  state: z.enum(["available", "read_only", "locked", "hidden"]),
  reason: z.string().trim().max(500).nullable(),
  expiresAt: z.date().nullable(),
});

function optionalText(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function optionalDate(value: FormDataEntryValue | null) {
  const normalized = optionalText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function actionFailure(error: unknown, fallback: string) {
  logServerError(error, { action: "course.module_access.mutation" });
  return initialError(fallback);
}

function refreshAccessViews(courseId?: string) {
  revalidatePath("/academy", "layout");
  revalidatePath("/admin", "layout");
  if (courseId) revalidatePath(`/admin/courses/${courseId}`);
}

export async function requestCourseModuleAccessAction(
  courseId: string,
  moduleId: string,
  _state: CourseModuleAccessActionState,
  formData: FormData,
): Promise<CourseModuleAccessActionState> {
  void _state;
  const user = await requireUser();
  const locale = normalizeLocale(
    formData.get("locale"),
    await resolveUserLocale(user),
  );
  const copy = getCourseSupportCopy(locale).actions.access;
  if (user.role !== "member") {
    return initialError(copy.learnerOnlyRequest);
  }
  const parsed = requestSchema.safeParse({
    courseId,
    moduleId,
    message: optionalText(formData.get("message")),
  });
  if (!parsed.success) {
    return initialError(copy.invalidInput);
  }

  try {
    const result = await db.transaction(async (tx) => {
      const created = await createCourseModuleAccessRequestInTransaction(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        ...parsed.data,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "course_module.access_requested",
        entityType: "course_module_access_request",
        entityId: created.request.id,
        metadata: {
          courseId: parsed.data.courseId,
          moduleId: parsed.data.moduleId,
        },
      });
      return created;
    });
    refreshAccessViews(parsed.data.courseId);
    return {
      ok: true,
      message: copy.requestSent,
      resourceId: result.request.id,
    };
  } catch (error) {
    return actionFailure(error, copy.requestFailed);
  }
}

export async function withdrawCourseModuleAccessRequestAction(
  requestId: string,
  _state: CourseModuleAccessActionState,
  _formData: FormData,
): Promise<CourseModuleAccessActionState> {
  void _state;
  const user = await requireUser();
  const locale = normalizeLocale(
    _formData.get("locale"),
    await resolveUserLocale(user),
  );
  const copy = getCourseSupportCopy(locale).actions.access;
  if (user.role !== "member") {
    return initialError(copy.learnerOnlyWithdraw);
  }
  const parsedId = uuidSchema.safeParse(requestId);
  if (!parsedId.success) return initialError(copy.invalidRequest);

  try {
    const cancelled = await db.transaction(async (tx) => {
      const result = await cancelCourseModuleAccessRequestInTransaction(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        requestId: parsedId.data,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "course_module.access_request_withdrawn",
        entityType: "course_module_access_request",
        entityId: result.id,
        metadata: { courseId: result.courseId, moduleId: result.moduleId },
      });
      return result;
    });
    refreshAccessViews(cancelled.courseId);
    return {
      ok: true,
      message: copy.requestWithdrawn,
      resourceId: cancelled.id,
    };
  } catch (error) {
    return actionFailure(error, copy.withdrawFailed);
  }
}

export async function decideCourseModuleAccessRequestAction(
  requestId: string,
  decision: "approved" | "rejected",
  _state: CourseModuleAccessActionState,
  formData: FormData,
): Promise<CourseModuleAccessActionState> {
  void _state;
  const actor = await requireTeamPermission("courses.manage");
  const locale = normalizeLocale(
    formData.get("locale"),
    await resolveUserLocale(actor),
  );
  const copy = getCourseSupportCopy(locale).actions.access;
  const expiresAtValue = optionalText(formData.get("expiresAt"));
  const parsed = decisionSchema.safeParse({
    requestId,
    decision,
    decisionNote: optionalText(formData.get("decisionNote")),
    expiresAt: expiresAtValue ? optionalDate(expiresAtValue) : null,
  });
  if (!parsed.success || (expiresAtValue && !parsed.data?.expiresAt)) {
    return initialError(copy.invalidDecision);
  }

  try {
    const result = await db.transaction(async (tx) => {
      const decided = await decideCourseModuleAccessRequestInTransaction(tx, {
        organizationId: actor.organizationId,
        actorId: actor.id,
        ...parsed.data,
      });
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: decided.stale
          ? "course_module.access_request_stale_rejected"
          : parsed.data.decision === "approved"
            ? "course_module.access_request_approved"
            : "course_module.access_request_rejected",
        entityType: "course_module_access_request",
        entityId: decided.request.id,
        metadata: {
          courseId: decided.request.courseId,
          moduleId: decided.request.moduleId,
          memberId: decided.request.userId,
          overrideId: decided.override?.id ?? null,
        },
      });
      return decided;
    });
    refreshAccessViews(result.request.courseId);
    return {
      ok: true,
      message: result.stale
        ? copy.staleRejected
        : parsed.data.decision === "approved"
          ? copy.approved
          : copy.rejected,
      resourceId: result.request.id,
    };
  } catch (error) {
    return actionFailure(error, copy.decisionFailed);
  }
}

export async function saveCourseModuleAccessOverrideAction(
  courseId: string,
  moduleId: string,
  userId: string,
  _state: CourseModuleAccessActionState,
  formData: FormData,
): Promise<CourseModuleAccessActionState> {
  void _state;
  const actor = await requireTeamPermission("courses.manage");
  const locale = normalizeLocale(
    formData.get("locale"),
    await resolveUserLocale(actor),
  );
  const copy = getCourseSupportCopy(locale).actions.access;
  const expiresAtValue = optionalText(formData.get("expiresAt"));
  const parsed = overrideSchema.safeParse({
    courseId,
    moduleId,
    userId,
    state: formData.get("state"),
    reason: optionalText(formData.get("reason")),
    expiresAt: expiresAtValue ? optionalDate(expiresAtValue) : null,
  });
  if (!parsed.success || (expiresAtValue && !parsed.data?.expiresAt)) {
    return initialError(copy.invalidOverride);
  }

  try {
    const result = await db.transaction(async (tx) => {
      const saved = await upsertCourseModuleAccessOverrideInTransaction(tx, {
        organizationId: actor.organizationId,
        actorId: actor.id,
        ...parsed.data,
      });
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "course_module.access_override_saved",
        entityType: "course_module_access_override",
        entityId: saved.override.id,
        metadata: {
          courseId,
          moduleId,
          memberId: userId,
          state: parsed.data.state,
          expiresAt: parsed.data.expiresAt?.toISOString() ?? null,
        },
      });
      return saved;
    });
    refreshAccessViews(courseId);
    return {
      ok: true,
      message: copy.overrideSaved,
      resourceId: result.override.id,
    };
  } catch (error) {
    return actionFailure(error, copy.overrideSaveFailed);
  }
}

export async function deleteCourseModuleAccessOverrideAction(
  courseId: string,
  moduleId: string,
  userId: string,
  _state: CourseModuleAccessActionState,
  _formData: FormData,
): Promise<CourseModuleAccessActionState> {
  void _state;
  const actor = await requireTeamPermission("courses.manage");
  const locale = normalizeLocale(
    _formData.get("locale"),
    await resolveUserLocale(actor),
  );
  const copy = getCourseSupportCopy(locale).actions.access;
  const parsed = z
    .object({ courseId: uuidSchema, moduleId: uuidSchema, userId: uuidSchema })
    .safeParse({ courseId, moduleId, userId });
  if (!parsed.success) return initialError(copy.invalidOverride);

  try {
    const deleted = await db.transaction(async (tx) => {
      const result = await deleteCourseModuleAccessOverrideInTransaction(tx, {
        organizationId: actor.organizationId,
        actorId: actor.id,
        ...parsed.data,
      });
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "course_module.access_override_deleted",
        entityType: "course_module_access_override",
        entityId: result.id,
        metadata: { courseId, moduleId, memberId: userId },
      });
      return result;
    });
    refreshAccessViews(courseId);
    return {
      ok: true,
      message: copy.overrideRemoved,
      resourceId: deleted.id,
    };
  } catch (error) {
    return actionFailure(error, copy.overrideRemoveFailed);
  }
}

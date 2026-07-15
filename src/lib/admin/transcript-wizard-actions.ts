"use server";

import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import {
  activityEvents,
  contentBlocks,
  courseModules,
  courses,
  lessons,
  modules,
  type ContentBlockData,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { requireCoursePermission } from "@/lib/course-permissions";
import { requireSharedModuleContentPermission } from "@/lib/shared-module-permissions";
import {
  deterministicTranscriptWizardResult,
  transcriptWizardCopyResponse,
  transcriptWizardGenerationRequestSchema,
} from "@/lib/ai/transcript-wizard-schema";
import {
  getCourseParityCopy,
  type TranscriptWizardActionCode,
} from "@/lib/i18n/course-parity";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import { normalizeLocale } from "@/lib/i18n/model";
import { resolveUserLocale } from "@/lib/i18n/server";
import { logServerError } from "@/lib/server-error-logging";

export type TranscriptWizardActionState = {
  ok?: boolean;
  code?: TranscriptWizardActionCode;
  message?: string;
  created?: number;
  response?: string;
};

const inputSchema = z
  .object({
    courseId: z.string().uuid(),
    blockId: z.string().uuid(),
    ...transcriptWizardGenerationRequestSchema.shape,
  })
  .strict();

function persistedBlock(
  block: NonNullable<
    ReturnType<typeof deterministicTranscriptWizardResult>
  >["blocks"][number],
  booleanLabels: { trueLabel: string; falseLabel: string },
) {
  if (block.type === "text") {
    return {
      type: block.type,
      title: null,
      required: false,
      data: { text: block.text } satisfies ContentBlockData,
    };
  }
  if (block.type === "fill_blank") {
    return {
      type: block.type,
      title: block.title,
      required: true,
      data: {
        prompt: block.prompt,
        acceptedAnswers: block.acceptedAnswers,
        caseSensitive: block.caseSensitive,
        feedback: block.feedback,
      } satisfies ContentBlockData,
    };
  }
  if (block.type === "multiple_choice") {
    return {
      type: block.type,
      title: block.title,
      required: true,
      data: {
        prompt: block.prompt,
        options: block.options,
        correctOption: block.correctOption,
        feedback: block.feedback,
      } satisfies ContentBlockData,
    };
  }
  if (block.type === "true_false") {
    return {
      type: block.type,
      title: block.title,
      required: true,
      data: {
        prompt: block.prompt,
        options: [booleanLabels.trueLabel, booleanLabels.falseLabel],
        correctOption: block.correctOption,
        feedback: block.feedback,
      } satisfies ContentBlockData,
    };
  }
  if (block.type === "multi_select") {
    return {
      type: block.type,
      title: block.title,
      required: true,
      data: {
        prompt: block.prompt,
        options: block.options,
        correctOptions: block.correctOptions,
        feedback: block.feedback,
      } satisfies ContentBlockData,
    };
  }
  if (block.type === "ordering") {
    return {
      type: block.type,
      title: block.title,
      required: true,
      data: {
        prompt: block.prompt,
        options: block.options,
        feedback: block.feedback,
      } satisfies ContentBlockData,
    };
  }
  return null;
}

export async function createBlocksFromTranscriptAction(
  courseId: string,
  blockId: string,
  _state: TranscriptWizardActionState,
  formData: FormData,
): Promise<TranscriptWizardActionState> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const locale = normalizeLocale(
    formData.get("locale"),
    await resolveUserLocale(user),
  );
  const copy = getCourseParityCopy(locale).transcript;
  const booleanLabels = getCourseSupportCopy(locale).actions.ai;
  const failure = (
    code: Exclude<TranscriptWizardActionCode, "transcript_wizard.created">,
  ): TranscriptWizardActionState => ({
    ok: false,
    code,
    message: copy.action[code] as string,
  });
  const parsed = inputSchema.safeParse({
    courseId,
    blockId,
    operation: formData.get("operation"),
    instruction: formData.get("instruction") ?? "",
  });
  if (!parsed.success) {
    return failure("transcript_wizard.invalid_input");
  }

  let result: {
    created: number;
    reason: "missing_transcript" | "invalid_result" | null;
    response: string | null;
  } | null;
  try {
    result = await db.transaction(async (transaction) => {
      await requireSharedModuleContentPermission(transaction, user, courseId, {
        type: "block",
        id: parsed.data.blockId,
      });
      const [source] = await transaction
        .select({
          id: contentBlocks.id,
          lessonId: contentBlocks.lessonId,
          pageId: contentBlocks.pageId,
          sortOrder: contentBlocks.sortOrder,
          type: contentBlocks.type,
          data: contentBlocks.data,
        })
        .from(contentBlocks)
        .innerJoin(lessons, eq(lessons.id, contentBlocks.lessonId))
        .innerJoin(
          modules,
          and(
            eq(modules.id, lessons.moduleId),
            eq(modules.organizationId, user.organizationId),
          ),
        )
        .innerJoin(
          courseModules,
          and(
            eq(courseModules.moduleId, modules.id),
            eq(courseModules.courseId, parsed.data.courseId),
          ),
        )
        .innerJoin(
          courses,
          and(
            eq(courses.id, courseModules.courseId),
            eq(courses.organizationId, user.organizationId),
          ),
        )
        .where(eq(contentBlocks.id, parsed.data.blockId))
        .limit(1)
        .for("update", { of: contentBlocks });
      if (!source || source.type !== "video") return null;

      const transcript = (
        source.data as ContentBlockData & { transcript?: unknown }
      ).transcript;
      const generated = deterministicTranscriptWizardResult(
        transcript,
        parsed.data.operation,
        locale,
        parsed.data.instruction,
      );
      if (!generated)
        return {
          created: 0,
          reason: "missing_transcript" as const,
          response: null,
        };
      const response = transcriptWizardCopyResponse(generated);
      if (!response)
        return { created: 0, reason: "invalid_result" as const, response: null };
      const blocks = generated.blocks
        .map((block) => persistedBlock(block, booleanLabels))
        .filter(Boolean);
      if (!blocks.length)
        return { created: 0, reason: "invalid_result" as const, response: null };

      const siblingScope = and(
        eq(contentBlocks.lessonId, source.lessonId),
        source.pageId
          ? eq(contentBlocks.pageId, source.pageId)
          : isNull(contentBlocks.pageId),
        gt(contentBlocks.sortOrder, source.sortOrder),
      );
      await transaction
        .update(contentBlocks)
        .set({ sortOrder: sql`${contentBlocks.sortOrder} + ${blocks.length}` })
        .where(siblingScope);
      const created = await transaction
        .insert(contentBlocks)
        .values(
          blocks.map((block, index) => ({
            lessonId: source.lessonId,
            pageId: source.pageId,
            sortOrder: source.sortOrder + index + 1,
            ...block!,
          })),
        )
        .returning({ id: contentBlocks.id });
      await transaction.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "course.transcript_wizard.used",
        entityType: "content_block",
        entityId: source.id,
        metadata: {
          courseId: parsed.data.courseId,
          operation: parsed.data.operation,
          customInstructionUsed: Boolean(parsed.data.instruction),
          customInstructionLength: Array.from(parsed.data.instruction).length,
          generatedBlockIds: created.map((entry) => entry.id),
        },
      });
      return { created: created.length, reason: null, response };
    });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 403) {
        return failure("transcript_wizard.permission_denied");
      }
      if (error.status === 404) {
        return failure("transcript_wizard.block_unavailable");
      }
      if (error.status === 409) {
        return failure("transcript_wizard.conflict");
      }
    }
    logServerError(error, { action: "course.transcript_wizard.create" });
    return failure("transcript_wizard.failed");
  }

  if (!result) {
    return failure("transcript_wizard.block_unavailable");
  }
  if (!result.created) {
    return failure(
      result.reason === "missing_transcript"
        ? "transcript_wizard.transcript_missing"
        : "transcript_wizard.no_content",
    );
  }

  revalidatePath(`/admin/courses/${parsed.data.courseId}`);
  revalidatePath(`/admin/courses/${parsed.data.courseId}/preview`);
  return {
    ok: true,
    code: "transcript_wizard.created",
    created: result.created,
    response: result.response ?? undefined,
    message: (copy.action["transcript_wizard.created"] as (count: number) => string)(
      result.created,
    ),
  };
}

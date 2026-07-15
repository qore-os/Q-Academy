import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  contentBlocks,
  courses,
  courseVersions,
  dataForms,
  lessons,
  modules,
} from "@/db/schema";
import { dataFormMutationLockKey } from "@/lib/data-profile-lock";

export type CourseDataFormTransaction = Pick<
  typeof db,
  "execute" | "select"
>;

type CourseBlockReference = {
  type: string;
  data: unknown;
};

const identifierSchema = z.string().uuid();

export function courseDataFormIds(
  blocks: readonly CourseBlockReference[],
): string[] | null {
  const formIds = new Set<string>();
  for (const block of blocks) {
    if (block.type !== "data_form") continue;
    const formId =
      typeof block.data === "object" &&
      block.data !== null &&
      "formId" in block.data &&
      typeof block.data.formId === "string"
        ? block.data.formId
        : null;
    const parsed = identifierSchema.safeParse(formId);
    if (!parsed.success) return null;
    formIds.add(parsed.data);
  }
  return [...formIds].sort();
}

export async function lockCourseContentBlocksForMutation(
  transaction: Pick<typeof db, "execute">,
) {
  await transaction.execute(
    sql`lock table ${contentBlocks} in row exclusive mode`,
  );
}

export async function lockActiveCourseDataForms(
  transaction: CourseDataFormTransaction,
  organizationId: string,
  blocks: readonly CourseBlockReference[],
) {
  const formIds = courseDataFormIds(blocks);
  if (!formIds) return false;
  for (const formId of formIds) {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${dataFormMutationLockKey(organizationId, formId)}))`,
    );
  }
  if (formIds.length === 0) return true;
  const rows = await transaction
    .select({ id: dataForms.id })
    .from(dataForms)
    .where(
      and(
        eq(dataForms.organizationId, organizationId),
        eq(dataForms.active, true),
        inArray(dataForms.id, formIds),
      ),
    )
    .for("share");
  return rows.length === formIds.length;
}

export async function courseReferencesDataForm(
  transaction: Pick<typeof db, "select">,
  organizationId: string,
  formId: string,
) {
  const [draftReference] = await transaction
    .select({ id: contentBlocks.id })
    .from(contentBlocks)
    .innerJoin(lessons, eq(lessons.id, contentBlocks.lessonId))
    .innerJoin(
      modules,
      and(
        eq(modules.id, lessons.moduleId),
        eq(modules.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(contentBlocks.type, "data_form"),
        sql`${contentBlocks.data} ->> 'formId' = ${formId}`,
      ),
    )
    .limit(1);
  if (draftReference) return true;

  const [publishedReference] = await transaction
    .select({ id: courseVersions.id })
    .from(courseVersions)
    .innerJoin(
      courses,
      and(
        eq(courses.publishedVersionId, courseVersions.id),
        eq(courses.id, courseVersions.courseId),
        eq(courses.organizationId, organizationId),
      ),
    )
    .where(sql`exists (
      select 1
      from jsonb_path_query(${courseVersions.snapshot}, '$.**.blocks[*]')
        as snapshot_blocks(block)
      where block ->> 'type' = 'data_form'
        and block -> 'data' ->> 'formId' = ${formId}
    )`)
    .limit(1);
  return Boolean(publishedReference);
}

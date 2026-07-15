import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";

export type ProgressLockExecutor = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export function memberCourseProgressLockKey(input: {
  organizationId: string;
  userId: string;
  courseId: string;
}) {
  return `member-course-progress:${input.organizationId}:${input.userId}:${input.courseId}`;
}

export async function lockMemberCourseProgress(
  executor: ProgressLockExecutor,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
  },
) {
  const key = memberCourseProgressLockKey(input);
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}

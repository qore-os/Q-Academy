import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { courseModules, courses, lessonProgress, lessons, modules, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["members:read", "courses:read"], action: "lesson_progress.list", resourceType: "lesson_progress" }, async (context) => {
    const [member] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, id), eq(users.organizationId, context.organizationId))).limit(1);
    if (!member) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
    const data = await db
      .select({
        id: lessonProgress.id,
        lessonId: lessons.id,
        lessonTitle: lessons.title,
        moduleId: modules.id,
        moduleTitle: modules.title,
        courseId: courses.id,
        courseTitle: courses.title,
        status: lessonProgress.status,
        percent: lessonProgress.percent,
        startedAt: lessonProgress.startedAt,
        completedAt: lessonProgress.completedAt,
      })
      .from(lessonProgress)
      .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
      .innerJoin(modules, and(eq(modules.id, lessons.moduleId), eq(modules.organizationId, context.organizationId)))
      .innerJoin(courseModules, eq(courseModules.moduleId, modules.id))
      .innerJoin(courses, and(eq(courses.id, courseModules.courseId), eq(courses.organizationId, context.organizationId)))
      .where(eq(lessonProgress.userId, id))
      .orderBy(asc(courses.title), asc(courseModules.sortOrder), asc(lessons.sortOrder));
    return { data };
  });
}

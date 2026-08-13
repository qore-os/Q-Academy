import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  contentBlocks,
  courseModules,
  courses,
  lessonPages,
  lessons,
  modules,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { requireActiveApiKeyCreator } from "@/lib/api/api-key-actor";
import {
  lockCourseForVersion,
  publishCourseVersion,
} from "@/lib/api/course-versioning";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { courseUpdateSchema } from "@/lib/api/schemas";
import {
  getCourseAuthors,
  getCourseLearningGoals,
  replaceCourseInformationCollections,
} from "@/lib/course-information-service";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { publicApiContentBlock } from "@/lib/api/public-content-block";
import {
  assertCourseCanBecomeUnavailable,
  clearPublishedCourseLinkEdges,
  lockCourseLinkGraph,
} from "@/lib/course-link-service";
import { safeCourseCoverSource } from "@/lib/course-cover";
import { COURSE_LIFECYCLE_PRESERVED_DATA } from "@/lib/course-lifecycle";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function courseForOrganization(id: string, organizationId: string) {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.id, id), eq(courses.organizationId, organizationId)))
    .limit(1);
  if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
  return course;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    { scopes: ["courses:read"], action: "course.read", resourceType: "course" },
    async (context) => {
      const course = await courseForOrganization(id, context.organizationId);
      const moduleRows = await db
        .select({
          id: modules.id,
          title: modules.title,
          kind: modules.kind,
          description: modules.description,
          folder: modules.folder,
          isReusable: modules.isReusable,
          estimatedMinutes: modules.estimatedMinutes,
          sortOrder: courseModules.sortOrder,
          dripDays: courseModules.dripDays,
          isRequired: courseModules.isRequired,
        })
        .from(courseModules)
        .innerJoin(modules, eq(modules.id, courseModules.moduleId))
        .where(eq(courseModules.courseId, id))
        .orderBy(asc(courseModules.sortOrder));
      const structure = await Promise.all(
        moduleRows.map(async (learningModule) => {
          const lessonRows = await db
            .select()
            .from(lessons)
            .where(eq(lessons.moduleId, learningModule.id))
            .orderBy(asc(lessons.sortOrder));
          const lessonStructure = await Promise.all(
            lessonRows.map(async (lesson) => {
              const pages = await db
                .select()
                .from(lessonPages)
                .where(eq(lessonPages.lessonId, lesson.id))
                .orderBy(asc(lessonPages.sortOrder), asc(lessonPages.id));
              return {
                ...lesson,
                blocks: (
                  await db
                    .select()
                    .from(contentBlocks)
                    .where(
                      and(
                        eq(contentBlocks.lessonId, lesson.id),
                        isNull(contentBlocks.pageId),
                      ),
                    )
                    .orderBy(asc(contentBlocks.sortOrder))
                ).map(publicApiContentBlock),
                pages: await Promise.all(
                  pages.map(async (page) => ({
                    ...page,
                    blocks: (
                      await db
                        .select()
                        .from(contentBlocks)
                        .where(eq(contentBlocks.pageId, page.id))
                        .orderBy(asc(contentBlocks.sortOrder))
                    ).map(publicApiContentBlock),
                  })),
                ),
              };
            }),
          );
          return { ...learningModule, lessons: lessonStructure };
        }),
      );
      const [learningGoals, authors] = await Promise.all([
        getCourseLearningGoals(id, context.organizationId),
        getCourseAuthors(id, context.organizationId),
      ]);
      return {
        data: {
          ...course,
          coverImage: safeCourseCoverSource(course.coverImage),
          learningGoals,
          authors,
          modules: structure,
        },
        resourceId: course.id,
      };
    },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["courses:write"],
      action: "course.update",
      resourceType: "course",
      idempotent: true,
    },
    async (context) => {
      const current = await courseForOrganization(id, context.organizationId);
      const input = await parseJson(request, courseUpdateSchema);
      if (input.slug && input.slug !== current.slug) {
        const [duplicate] = await db
          .select({ id: courses.id })
          .from(courses)
          .where(
            and(
              eq(courses.organizationId, context.organizationId),
              eq(courses.slug, input.slug),
            ),
          )
          .limit(1);
        if (duplicate)
          throw new ApiError(
            409,
            "conflict",
            "Ein Kurs mit diesem Slug existiert bereits.",
          );
      }
      const result = await db.transaction(async (transaction) => {
        const actor =
          input.status === "published"
            ? await requireActiveApiKeyCreator(transaction, {
                organizationId: context.organizationId,
                apiKeyId: context.apiKeyId,
              })
            : null;
        const locked = await lockCourseForVersion(
          transaction,
          id,
          context.organizationId,
        );
        const updatedAt = new Date();
        const { status, learningGoals, authorIds, ...changes } = input;
        if (locked.status === "published" && status && status !== "published") {
          await assertCourseCanBecomeUnavailable(transaction, {
            organizationId: context.organizationId,
            courseId: id,
          });
          await clearPublishedCourseLinkEdges(transaction, {
            organizationId: context.organizationId,
            sourceCourseId: id,
          });
        }
        const [draft] = await transaction
          .update(courses)
          .set({
            ...changes,
            ...(status && status !== "published" ? { status } : {}),
            updatedAt,
          })
          .where(
            and(
              eq(courses.id, id),
              eq(courses.organizationId, context.organizationId),
            ),
          )
          .returning();
        if (!draft)
          throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
        await replaceCourseInformationCollections(transaction, {
          organizationId: context.organizationId,
          courseId: id,
          learningGoals,
          authorIds,
        });

        await transaction.insert(activityEvents).values({
          organizationId: context.organizationId,
          userId: null,
          type: "course.information.updated",
          entityType: "course",
          entityId: id,
          metadata: {
            source: "api",
            apiKeyId: context.apiKeyId,
            learningGoalCount: learningGoals?.length,
            authorCount: authorIds?.length,
            visibleInCatalog: draft.visibleInCatalog,
            showProgressPercentage: draft.showProgressPercentage,
          },
        });

        if (
          status &&
          status !== locked.status &&
          (status === "archived" || locked.status === "archived")
        ) {
          await transaction.insert(activityEvents).values({
            organizationId: context.organizationId,
            userId: null,
            type: status === "archived" ? "course.archived" : "course.restored",
            entityType: "course",
            entityId: id,
            metadata: {
              source: "api",
              apiKeyId: context.apiKeyId,
              previousStatus: locked.status,
              nextStatus: status,
              preservedData: COURSE_LIFECYCLE_PRESERVED_DATA,
            },
          });
        }

        if (status === "published") {
          if (!actor) {
            throw new ApiError(
              403,
              "forbidden",
              "Die Veroeffentlichung benoetigt einen aktiven verantwortlichen Benutzer.",
            );
          }
          const publication = await publishCourseVersion(transaction, {
            organizationId: context.organizationId,
            course: { ...locked, ...draft },
            createdById: actor.id,
            changelog: "Ueber die Kurs-API veroeffentlicht.",
            publishedAt: updatedAt,
          });
          await enqueueWebhook(
            context.organizationId,
            "course.published",
            {
              ...publication.course,
              coverImage: safeCourseCoverSource(publication.course.coverImage),
              versionId: publication.version.id,
              version: publication.version.version,
            },
            transaction,
          );
          return {
            ...publication.course,
            coverImage: safeCourseCoverSource(publication.course.coverImage),
          };
        }

        await enqueueWebhook(
          context.organizationId,
          "course.updated",
          {
            ...draft,
            coverImage: safeCourseCoverSource(draft.coverImage),
          },
          transaction,
        );
        return {
          ...draft,
          coverImage: safeCourseCoverSource(draft.coverImage),
        };
      });
      return { data: result, resourceId: id };
    },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["courses:write"],
      action: "course.archive",
      resourceType: "course",
      idempotent: true,
    },
    async (context) => {
      const course = await db.transaction(async (tx) => {
        await lockCourseLinkGraph(tx, context.organizationId);
        const current = await lockCourseForVersion(
          tx,
          id,
          context.organizationId,
        );
        await assertCourseCanBecomeUnavailable(tx, {
          organizationId: context.organizationId,
          courseId: current.id,
        });
        await clearPublishedCourseLinkEdges(tx, {
          organizationId: context.organizationId,
          sourceCourseId: current.id,
        });
        const [archived] = await tx
          .update(courses)
          .set({ status: "archived", updatedAt: new Date() })
          .where(
            and(
              eq(courses.id, id),
              eq(courses.organizationId, context.organizationId),
            ),
          )
          .returning();
        await tx.insert(activityEvents).values({
          organizationId: context.organizationId,
          userId: null,
          type: "course.archived",
          entityType: "course",
          entityId: id,
          metadata: {
            source: "api",
            apiKeyId: context.apiKeyId,
            previousStatus: current.status,
            nextStatus: "archived",
            preservedData: COURSE_LIFECYCLE_PRESERVED_DATA,
          },
        });
        return archived;
      });
      const publicCourse = {
        ...course,
        coverImage: safeCourseCoverSource(course.coverImage),
      };
      await enqueueWebhook(
        context.organizationId,
        "course.updated",
        publicCourse,
      );
      return { data: publicCourse, resourceId: id };
    },
  );
}

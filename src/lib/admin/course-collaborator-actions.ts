"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import {
  activityEvents,
  courseCollaborators,
  courses,
  users,
} from "@/db/schema";
import { requireOrganizationAdmin } from "@/lib/auth";

const idSchema = z.string().uuid();
const permissionSchema = z.enum(["view", "edit", "manage", "none"]);

export async function setCourseCollaboratorAction(
  courseId: string,
  collaboratorId: string,
  formData: FormData,
) {
  const actor = await requireOrganizationAdmin();
  const parsed = z
    .object({
      courseId: idSchema,
      collaboratorId: idSchema,
      permission: permissionSchema,
    })
    .safeParse({
      courseId,
      collaboratorId,
      permission: formData.get("permission"),
    });
  if (!parsed.success) return;

  const updated = await db.transaction(async (tx) => {
    const [course] = await tx
      .select({ id: courses.id })
      .from(courses)
      .where(
        and(
          eq(courses.id, parsed.data.courseId),
          eq(courses.organizationId, actor.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    const [currentActor] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, actor.id),
          eq(users.organizationId, actor.organizationId),
          eq(users.status, "active"),
          inArray(users.role, ["owner", "admin"]),
        ),
      )
      .limit(1)
      .for("share");
    const [collaborator] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, parsed.data.collaboratorId),
          eq(users.organizationId, actor.organizationId),
          eq(users.role, "trainer"),
          ne(users.status, "disabled"),
        ),
      )
      .limit(1)
      .for("update");
    if (!course || !currentActor || !collaborator) return false;

    if (parsed.data.permission === "none") {
      await tx
        .delete(courseCollaborators)
        .where(
          and(
            eq(courseCollaborators.organizationId, actor.organizationId),
            eq(courseCollaborators.courseId, course.id),
            eq(courseCollaborators.userId, collaborator.id),
          ),
        );
    } else {
      await tx
        .insert(courseCollaborators)
        .values({
          organizationId: actor.organizationId,
          courseId: course.id,
          userId: collaborator.id,
          permission: parsed.data.permission,
          grantedById: currentActor.id,
        })
        .onConflictDoUpdate({
          target: [courseCollaborators.courseId, courseCollaborators.userId],
          set: {
            permission: parsed.data.permission,
            grantedById: currentActor.id,
            updatedAt: new Date(),
          },
        });
    }
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: currentActor.id,
      type: "course.collaborator.updated",
      entityType: "course",
      entityId: course.id,
      metadata: {
        collaboratorId: collaborator.id,
        permission: parsed.data.permission,
      },
    });
    return true;
  });
  if (!updated) return;
  revalidatePath(`/admin/courses/${parsed.data.courseId}`);
  revalidatePath(`/admin/courses/${parsed.data.courseId}/team`);
  revalidatePath("/admin/courses");
}

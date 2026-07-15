"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { activityEvents, bundles, courses, groups, users } from "@/db/schema";
import {
  addCourseToBundle,
  addMemberToGroup,
  assignBundleToGroup,
  assignCourseToGroup,
  removeCourseFromBundle,
  removeMemberFromGroup,
  unassignBundleFromGroup,
  unassignCourseFromGroup,
  updateBundleCoursePolicy,
} from "@/lib/access";
import {
  bundleCoursePolicySchema,
  bundleCreateSchema,
  groupCreateSchema,
} from "@/lib/api/schemas";
import { requireTeamPermission } from "@/lib/auth";
import { logServerError } from "@/lib/server-error-logging";

export type AccessManagementActionResult = {
  ok: boolean;
  message: string;
};

const idSchema = z.string().uuid();

const ok = (message: string): AccessManagementActionResult => ({
  ok: true,
  message,
});
const fail = (message: string): AccessManagementActionResult => ({
  ok: false,
  message,
});

function stringValue(formData: FormData, name: string) {
  const input = formData.get(name);
  return typeof input === "string" ? input.trim() : "";
}

function optionalValue(formData: FormData, name: string) {
  const input = stringValue(formData, name);
  return input || null;
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function revalidateGroup(groupId: string) {
  revalidatePath(`/admin/groups/${groupId}`);
  revalidatePath("/admin/groups");
  revalidatePath("/admin/members");
  revalidatePath("/academy");
  revalidatePath("/academy/courses");
}

function revalidateBundle(bundleId: string) {
  revalidatePath(`/admin/bundles/${bundleId}`);
  revalidatePath("/admin/bundles");
  revalidatePath("/admin/groups");
  revalidatePath("/admin/members");
  revalidatePath("/academy");
  revalidatePath("/academy/courses");
}

async function ownedGroup(groupId: string, organizationId: string) {
  const [group] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(
      and(eq(groups.id, groupId), eq(groups.organizationId, organizationId)),
    )
    .limit(1);
  return group ?? null;
}

async function ownedBundle(bundleId: string, organizationId: string) {
  const [bundle] = await db
    .select({ id: bundles.id })
    .from(bundles)
    .where(
      and(eq(bundles.id, bundleId), eq(bundles.organizationId, organizationId)),
    )
    .limit(1);
  return bundle ?? null;
}

async function ownedCourse(courseId: string, organizationId: string) {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(eq(courses.id, courseId), eq(courses.organizationId, organizationId)),
    )
    .limit(1);
  return course ?? null;
}

async function ownedMember(userId: string, organizationId: string) {
  const [member] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.organizationId, organizationId),
        eq(users.role, "member"),
      ),
    )
    .limit(1);
  return member ?? null;
}

function validPair(first: string, second: string) {
  return (
    idSchema.safeParse(first).success && idSchema.safeParse(second).success
  );
}

export async function updateGroupAdminAction(
  groupId: string,
  formData: FormData,
): Promise<AccessManagementActionResult> {
  const actor = await requireTeamPermission("members.manage");
  if (!idSchema.safeParse(groupId).success)
    return fail("Gruppe ist ungueltig.");
  const parsed = groupCreateSchema.safeParse({
    name: stringValue(formData, "name"),
    description: optionalValue(formData, "description"),
    color: stringValue(formData, "color") || "#4f7cac",
  });
  if (!parsed.success)
    return fail(
      parsed.error.issues[0]?.message ?? "Gruppendaten sind ungueltig.",
    );

  try {
    const updated = await db.transaction(async (tx) => {
      const [duplicate] = await tx
        .select({ id: groups.id })
        .from(groups)
        .where(
          and(
            eq(groups.organizationId, actor.organizationId),
            eq(groups.name, parsed.data.name),
            ne(groups.id, groupId),
          ),
        )
        .limit(1);
      if (duplicate) return null;
      const [group] = await tx
        .update(groups)
        .set(parsed.data)
        .where(
          and(
            eq(groups.id, groupId),
            eq(groups.organizationId, actor.organizationId),
          ),
        )
        .returning({ id: groups.id });
      if (!group) return null;
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "group.updated",
        entityType: "group",
        entityId: group.id,
        metadata: { name: parsed.data.name },
      });
      return group;
    });
    if (!updated)
      return fail("Gruppe nicht gefunden oder Name bereits vergeben.");
    revalidateGroup(groupId);
    return ok("Gruppe gespeichert.");
  } catch (error) {
    if (isUniqueViolation(error))
      return fail("Eine Gruppe mit diesem Namen existiert bereits.");
    logServerError(error, { action: "admin.group.update" });
    return fail("Die Gruppe konnte nicht gespeichert werden.");
  }
}

export async function updateBundleAdminAction(
  bundleId: string,
  formData: FormData,
): Promise<AccessManagementActionResult> {
  const actor = await requireTeamPermission("members.manage");
  if (!idSchema.safeParse(bundleId).success)
    return fail("Bundle ist ungueltig.");
  const parsed = bundleCreateSchema.safeParse({
    name: stringValue(formData, "name"),
    description: optionalValue(formData, "description"),
    color: stringValue(formData, "color") || "#ee6c5d",
    active: formData.get("active") === "on",
  });
  if (!parsed.success)
    return fail(
      parsed.error.issues[0]?.message ?? "Bundle-Daten sind ungueltig.",
    );

  try {
    const updated = await db.transaction(async (tx) => {
      const [duplicate] = await tx
        .select({ id: bundles.id })
        .from(bundles)
        .where(
          and(
            eq(bundles.organizationId, actor.organizationId),
            eq(bundles.name, parsed.data.name),
            ne(bundles.id, bundleId),
          ),
        )
        .limit(1);
      if (duplicate) return null;
      const [bundle] = await tx
        .update(bundles)
        .set(parsed.data)
        .where(
          and(
            eq(bundles.id, bundleId),
            eq(bundles.organizationId, actor.organizationId),
          ),
        )
        .returning({ id: bundles.id });
      if (!bundle) return null;
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "bundle.updated",
        entityType: "bundle",
        entityId: bundle.id,
        metadata: { name: parsed.data.name, active: parsed.data.active },
      });
      return bundle;
    });
    if (!updated)
      return fail("Bundle nicht gefunden oder Name bereits vergeben.");
    revalidateBundle(bundleId);
    return ok("Bundle gespeichert.");
  } catch (error) {
    if (isUniqueViolation(error))
      return fail("Ein Bundle mit diesem Namen existiert bereits.");
    logServerError(error, { action: "admin.bundle.update" });
    return fail("Das Bundle konnte nicht gespeichert werden.");
  }
}

export async function addGroupMemberAdminAction(
  groupId: string,
  userId: string,
): Promise<AccessManagementActionResult> {
  const actor = await requireTeamPermission("members.manage");
  if (!validPair(groupId, userId))
    return fail("Gruppe oder Mitglied ist ungueltig.");
  const [group, member] = await Promise.all([
    ownedGroup(groupId, actor.organizationId),
    ownedMember(userId, actor.organizationId),
  ]);
  if (!group) return fail("Gruppe nicht gefunden.");
  if (!member) return fail("Mitglied nicht gefunden.");
  const result = await addMemberToGroup(actor.organizationId, groupId, userId);
  if (!result.membership)
    return fail("Mitglied konnte nicht hinzugefuegt werden.");
  revalidateGroup(groupId);
  return ok(
    `Mitglied hinzugefuegt. ${result.grantsCreated} Zugriffe synchronisiert.`,
  );
}

export async function removeGroupMemberAdminAction(
  groupId: string,
  userId: string,
): Promise<AccessManagementActionResult> {
  const actor = await requireTeamPermission("members.manage");
  if (!validPair(groupId, userId))
    return fail("Gruppe oder Mitglied ist ungueltig.");
  const [group, member] = await Promise.all([
    ownedGroup(groupId, actor.organizationId),
    ownedMember(userId, actor.organizationId),
  ]);
  if (!group) return fail("Gruppe nicht gefunden.");
  if (!member) return fail("Mitglied nicht gefunden.");
  const result = await removeMemberFromGroup(
    actor.organizationId,
    groupId,
    userId,
  );
  revalidateGroup(groupId);
  return ok(
    `Mitglied entfernt. ${result.grantsRevoked} Zugriffsquellen entzogen; Fortschritt bleibt erhalten.`,
  );
}

export async function addGroupCourseAdminAction(
  groupId: string,
  courseId: string,
): Promise<AccessManagementActionResult> {
  const actor = await requireTeamPermission("members.manage");
  if (!validPair(groupId, courseId))
    return fail("Gruppe oder Kurs ist ungueltig.");
  const [group, course] = await Promise.all([
    ownedGroup(groupId, actor.organizationId),
    ownedCourse(courseId, actor.organizationId),
  ]);
  if (!group) return fail("Gruppe nicht gefunden.");
  if (!course) return fail("Kurs nicht gefunden.");
  const result = await assignCourseToGroup(
    actor.organizationId,
    groupId,
    courseId,
  );
  revalidateGroup(groupId);
  return ok(
    `Kurs zugewiesen. ${result.affectedMembers} Mitglieder synchronisiert.`,
  );
}

export async function removeGroupCourseAdminAction(
  groupId: string,
  courseId: string,
): Promise<AccessManagementActionResult> {
  const actor = await requireTeamPermission("members.manage");
  if (!validPair(groupId, courseId))
    return fail("Gruppe oder Kurs ist ungueltig.");
  const [group, course] = await Promise.all([
    ownedGroup(groupId, actor.organizationId),
    ownedCourse(courseId, actor.organizationId),
  ]);
  if (!group) return fail("Gruppe nicht gefunden.");
  if (!course) return fail("Kurs nicht gefunden.");
  const result = await unassignCourseFromGroup(
    actor.organizationId,
    groupId,
    courseId,
  );
  revalidateGroup(groupId);
  return ok(
    `Direkte Kurszuweisung entfernt. ${result.affectedEnrollments} Zugriffsquellen aktualisiert.`,
  );
}

export async function addGroupBundleAdminAction(
  groupId: string,
  bundleId: string,
): Promise<AccessManagementActionResult> {
  const actor = await requireTeamPermission("members.manage");
  if (!validPair(groupId, bundleId))
    return fail("Gruppe oder Bundle ist ungueltig.");
  const [group, bundle] = await Promise.all([
    ownedGroup(groupId, actor.organizationId),
    ownedBundle(bundleId, actor.organizationId),
  ]);
  if (!group) return fail("Gruppe nicht gefunden.");
  if (!bundle) return fail("Bundle nicht gefunden.");
  const result = await assignBundleToGroup(
    actor.organizationId,
    groupId,
    bundleId,
  );
  revalidateGroup(groupId);
  revalidateBundle(bundleId);
  return ok(
    `Bundle zugewiesen. ${result.affectedMembers} Mitglieder und ${result.courses} Kurse synchronisiert.`,
  );
}

export async function removeGroupBundleAdminAction(
  groupId: string,
  bundleId: string,
): Promise<AccessManagementActionResult> {
  const actor = await requireTeamPermission("members.manage");
  if (!validPair(groupId, bundleId))
    return fail("Gruppe oder Bundle ist ungueltig.");
  const [group, bundle] = await Promise.all([
    ownedGroup(groupId, actor.organizationId),
    ownedBundle(bundleId, actor.organizationId),
  ]);
  if (!group) return fail("Gruppe nicht gefunden.");
  if (!bundle) return fail("Bundle nicht gefunden.");
  const result = await unassignBundleFromGroup(
    actor.organizationId,
    groupId,
    bundleId,
  );
  revalidateGroup(groupId);
  revalidateBundle(bundleId);
  return ok(
    `Bundle-Zuweisung entfernt. ${result.affectedEnrollments} Zugriffsquellen aktualisiert.`,
  );
}

export async function addBundleCourseAdminAction(
  bundleId: string,
  courseId: string,
): Promise<AccessManagementActionResult> {
  const actor = await requireTeamPermission("members.manage");
  if (!validPair(bundleId, courseId))
    return fail("Bundle oder Kurs ist ungueltig.");
  const [bundle, course] = await Promise.all([
    ownedBundle(bundleId, actor.organizationId),
    ownedCourse(courseId, actor.organizationId),
  ]);
  if (!bundle) return fail("Bundle nicht gefunden.");
  if (!course) return fail("Kurs nicht gefunden.");
  const result = await addCourseToBundle(
    actor.organizationId,
    bundleId,
    courseId,
  );
  revalidateBundle(bundleId);
  return ok(
    `Kurs hinzugefuegt. ${result.affectedDirectMembers + result.affectedGroupMembers} Mitglieder synchronisiert.`,
  );
}

export async function removeBundleCourseAdminAction(
  bundleId: string,
  courseId: string,
): Promise<AccessManagementActionResult> {
  const actor = await requireTeamPermission("members.manage");
  if (!validPair(bundleId, courseId))
    return fail("Bundle oder Kurs ist ungueltig.");
  const [bundle, course] = await Promise.all([
    ownedBundle(bundleId, actor.organizationId),
    ownedCourse(courseId, actor.organizationId),
  ]);
  if (!bundle) return fail("Bundle nicht gefunden.");
  if (!course) return fail("Kurs nicht gefunden.");
  const result = await removeCourseFromBundle(
    actor.organizationId,
    bundleId,
    courseId,
  );
  revalidateBundle(bundleId);
  return ok(
    `Kurs entfernt. ${result.affectedEnrollments} Zugriffsquellen aktualisiert; Fortschritt bleibt erhalten.`,
  );
}

export async function updateBundleCoursePolicyAdminAction(
  bundleId: string,
  courseId: string,
  formData: FormData,
): Promise<AccessManagementActionResult> {
  const actor = await requireTeamPermission("members.manage");
  if (!validPair(bundleId, courseId))
    return fail("Bundle oder Kurs ist ungueltig.");

  const parsed = bundleCoursePolicySchema.safeParse({
    availableFrom: optionalValue(formData, "availableFrom"),
    availableUntil: optionalValue(formData, "availableUntil"),
    delayDays: Number(stringValue(formData, "delayDays")),
    visible: formData.get("visible") === "true",
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Freigabe ist ungueltig.");
  }

  const [bundle, course] = await Promise.all([
    ownedBundle(bundleId, actor.organizationId),
    ownedCourse(courseId, actor.organizationId),
  ]);
  if (!bundle) return fail("Bundle nicht gefunden.");
  if (!course) return fail("Kurs nicht gefunden.");

  const assignment = await updateBundleCoursePolicy(
    actor.organizationId,
    bundleId,
    courseId,
    parsed.data,
  );
  if (!assignment) return fail("Kurszuordnung nicht gefunden.");

  revalidateBundle(bundleId);
  return ok("Kursfreigabe gespeichert.");
}

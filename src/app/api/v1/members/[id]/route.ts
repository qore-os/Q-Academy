import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  courses,
  enrollments,
  groupMembers,
  groups,
  userSessions,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import {
  memberUpdatePolicySchema,
  memberUpdateSchema,
} from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { safeAvatarSource } from "@/lib/avatar-policy";
import { assertOrganizationSeatCapacity } from "@/lib/organization-contracts";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function memberForOrganization(id: string, organizationId: string) {
  const [member] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      avatarUrl: users.avatarUrl,
      role: users.role,
      status: users.status,
      jobTitle: users.jobTitle,
      department: users.department,
      phone: users.phone,
      bio: users.bio,
      preferredLocale: users.preferredLocale,
      points: users.points,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(eq(users.id, id), eq(users.organizationId, organizationId)))
    .limit(1);
  if (!member) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
  return { ...member, avatarUrl: safeAvatarSource(member.avatarUrl) };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["members:read"], action: "member.read", resourceType: "member" }, async (context) => {
    const member = await memberForOrganization(id, context.organizationId);
    const [memberGroups, memberEnrollments] = await Promise.all([
      db
        .select({ id: groups.id, name: groups.name, color: groups.color, joinedAt: groupMembers.joinedAt })
        .from(groupMembers)
        .innerJoin(groups, eq(groups.id, groupMembers.groupId))
        .where(and(eq(groupMembers.userId, id), eq(groups.organizationId, context.organizationId))),
      db
        .select({
          id: enrollments.id,
          courseId: courses.id,
          courseTitle: courses.title,
          courseSlug: courses.slug,
          status: enrollments.status,
          progress: enrollments.progress,
          enrolledAt: enrollments.enrolledAt,
          lastAccessedAt: enrollments.lastAccessedAt,
          completedAt: enrollments.completedAt,
        })
        .from(enrollments)
        .innerJoin(courses, eq(courses.id, enrollments.courseId))
        .where(and(eq(enrollments.userId, id), eq(courses.organizationId, context.organizationId))),
    ]);
    return { data: { ...member, groups: memberGroups, enrollments: memberEnrollments }, resourceId: id };
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(
    request,
    { scopes: ["members:write"], action: "member.update", resourceType: "member", idempotent: true },
    async (context) => {
      const policyInput = await parseJson(request, memberUpdatePolicySchema);
      const member = await db.transaction(async (tx) => {
        const tenantAccounts = await tx
          .select({
            id: users.id,
            email: users.email,
            role: users.role,
            status: users.status,
          })
          .from(users)
          .where(eq(users.organizationId, context.organizationId))
          .for("update");
        const current = tenantAccounts.find((account) => account.id === id);
        if (!current) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");

        const removesOwnerRole =
          current.role === "owner" &&
          policyInput.role !== undefined &&
          policyInput.role !== "owner";
        const disablesActiveOwner =
          current.role === "owner" &&
          current.status === "active" &&
          policyInput.status !== undefined &&
          policyInput.status !== "active";
        const ownerCount = tenantAccounts.filter(
          (account) => account.role === "owner",
        ).length;
        const activeOwnerCount = tenantAccounts.filter(
          (account) => account.role === "owner" && account.status === "active",
        ).length;
        if (
          (removesOwnerRole && ownerCount <= 1) ||
          (disablesActiveOwner && activeOwnerCount <= 1)
        ) {
          throw new ApiError(
            403,
            "forbidden",
            "Der letzte aktive Organisationsinhaber darf nicht geaendert werden.",
          );
        }
        if (current.role !== "member") {
          throw new ApiError(
            403,
            "forbidden",
            "Staff-Konten duerfen ueber den members:write-Scope nicht geaendert werden.",
          );
        }
        if (policyInput.role !== undefined && policyInput.role !== "member") {
          throw new ApiError(
            403,
            "forbidden",
            "Mitgliedskonten duerfen ueber den members:write-Scope nicht zu Staff-Konten hochgestuft werden.",
          );
        }

        const input = memberUpdateSchema.parse(policyInput);
        if (current.status === "disabled" && input.status === "active") {
          await assertOrganizationSeatCapacity(tx, {
            organizationId: context.organizationId,
          });
        }
        const [updated] = await tx
          .update(users)
          .set(input)
          .where(
            and(
              eq(users.id, id),
              eq(users.organizationId, context.organizationId),
              eq(users.role, "member"),
            ),
          )
          .returning({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            role: users.role,
            status: users.status,
            jobTitle: users.jobTitle,
            department: users.department,
            phone: users.phone,
            bio: users.bio,
            preferredLocale: users.preferredLocale,
            points: users.points,
            createdAt: users.createdAt,
          });
        if (!updated) {
          throw new ApiError(
            403,
            "forbidden",
            "Das Mitgliedskonto konnte nicht geaendert werden.",
          );
        }
        if (
          updated.status !== current.status ||
          updated.email !== current.email
        ) {
          await tx
            .update(userSessions)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(userSessions.organizationId, context.organizationId),
                eq(userSessions.userId, updated.id),
                isNull(userSessions.revokedAt),
              ),
            );
        }
        return updated;
      });
      await enqueueWebhook(context.organizationId, "member.updated", member);
      return { data: member, resourceId: id };
    },
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(
    request,
    { scopes: ["members:write"], action: "member.disable", resourceType: "member", idempotent: true },
    async (context) => {
      const current = await memberForOrganization(id, context.organizationId);
      if (current.role !== "member") {
        throw new ApiError(
          403,
          "forbidden",
          "Staff-Konten duerfen ueber den members:write-Scope nicht deaktiviert werden.",
        );
      }
      const [member] = await db.transaction(async (tx) => {
        const [disabled] = await tx
          .update(users)
          .set({ status: "disabled" })
          .where(
            and(
              eq(users.id, id),
              eq(users.organizationId, context.organizationId),
              eq(users.role, "member"),
            ),
          )
          .returning({ id: users.id, status: users.status });
        if (disabled) {
          await tx
            .update(userSessions)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(userSessions.organizationId, context.organizationId),
                eq(userSessions.userId, disabled.id),
                isNull(userSessions.revokedAt),
              ),
            );
        }
        return [disabled] as const;
      });
      if (!member) {
        throw new ApiError(
          403,
          "forbidden",
          "Das Mitgliedskonto konnte nicht deaktiviert werden.",
        );
      }
      await enqueueWebhook(context.organizationId, "member.updated", member);
      return { data: member, resourceId: id };
    },
  );
}

import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  memberSidebarLinks,
  organizations,
  users,
} from "@/db/schema";
import type { MemberSidebarLinkIcon } from "@/lib/member-sidebar-link-model";

type SidebarTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type SidebarActor = { id: string; organizationId: string };

export type MemberSidebarLinkView = {
  id: string;
  label: string;
  description: string | null;
  href: string;
  icon: MemberSidebarLinkIcon;
  sortOrder: number;
  active: boolean;
};

async function lockAndAuthorize(
  tx: SidebarTransaction,
  actor: SidebarActor,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`member-sidebar-links:${actor.organizationId}`}, 0))`,
  );
  const [authorized] = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, users.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .where(
      and(
        eq(users.id, actor.id),
        eq(users.organizationId, actor.organizationId),
        eq(users.status, "active"),
        inArray(users.role, ["owner", "admin"]),
      ),
    )
    .limit(1)
    .for("share", { of: users });
  return Boolean(authorized);
}

export async function listMemberSidebarLinks(
  organizationId: string,
  options: { includeInactive?: boolean } = {},
): Promise<MemberSidebarLinkView[]> {
  const rows = await db
    .select({
      id: memberSidebarLinks.id,
      label: memberSidebarLinks.label,
      description: memberSidebarLinks.description,
      href: memberSidebarLinks.href,
      icon: memberSidebarLinks.icon,
      sortOrder: memberSidebarLinks.sortOrder,
      active: memberSidebarLinks.active,
    })
    .from(memberSidebarLinks)
    .where(
      options.includeInactive
        ? eq(memberSidebarLinks.organizationId, organizationId)
        : and(
            eq(memberSidebarLinks.organizationId, organizationId),
            eq(memberSidebarLinks.active, true),
          ),
    )
    .orderBy(asc(memberSidebarLinks.sortOrder), asc(memberSidebarLinks.id));
  return rows.map((row) => ({
    ...row,
    icon: row.icon as MemberSidebarLinkIcon,
  }));
}

export async function createMemberSidebarLink(input: {
  actor: SidebarActor;
  label: string;
  description: string | null;
  href: string;
  icon: MemberSidebarLinkIcon;
  active: boolean;
}) {
  return db.transaction(async (tx) => {
    if (!(await lockAndAuthorize(tx, input.actor))) return null;
    const [last] = await tx
      .select({ sortOrder: memberSidebarLinks.sortOrder })
      .from(memberSidebarLinks)
      .where(eq(memberSidebarLinks.organizationId, input.actor.organizationId))
      .orderBy(sql`${memberSidebarLinks.sortOrder} desc`)
      .limit(1)
      .for("update");
    const [created] = await tx
      .insert(memberSidebarLinks)
      .values({
        organizationId: input.actor.organizationId,
        label: input.label,
        description: input.description,
        href: input.href,
        icon: input.icon,
        active: input.active,
        sortOrder: Math.min((last?.sortOrder ?? -1) + 1, 999),
      })
      .returning({ id: memberSidebarLinks.id });
    await tx.insert(activityEvents).values({
      organizationId: input.actor.organizationId,
      userId: input.actor.id,
      type: "platform.member_sidebar_link.created",
      entityType: "member_sidebar_link",
      entityId: created.id,
      metadata: { label: input.label, icon: input.icon },
    });
    return created;
  });
}

export async function updateMemberSidebarLink(input: {
  actor: SidebarActor;
  id: string;
  label: string;
  description: string | null;
  href: string;
  icon: MemberSidebarLinkIcon;
  active: boolean;
}) {
  return db.transaction(async (tx) => {
    if (!(await lockAndAuthorize(tx, input.actor))) return null;
    const [updated] = await tx
      .update(memberSidebarLinks)
      .set({
        label: input.label,
        description: input.description,
        href: input.href,
        icon: input.icon,
        active: input.active,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(memberSidebarLinks.id, input.id),
          eq(memberSidebarLinks.organizationId, input.actor.organizationId),
        ),
      )
      .returning({ id: memberSidebarLinks.id });
    if (!updated) return false;
    await tx.insert(activityEvents).values({
      organizationId: input.actor.organizationId,
      userId: input.actor.id,
      type: "platform.member_sidebar_link.updated",
      entityType: "member_sidebar_link",
      entityId: updated.id,
      metadata: { label: input.label, icon: input.icon, active: input.active },
    });
    return true;
  });
}

export async function deleteMemberSidebarLink(input: {
  actor: SidebarActor;
  id: string;
}) {
  return db.transaction(async (tx) => {
    if (!(await lockAndAuthorize(tx, input.actor))) return null;
    const [deleted] = await tx
      .delete(memberSidebarLinks)
      .where(
        and(
          eq(memberSidebarLinks.id, input.id),
          eq(memberSidebarLinks.organizationId, input.actor.organizationId),
        ),
      )
      .returning({ id: memberSidebarLinks.id, label: memberSidebarLinks.label });
    if (!deleted) return false;
    await tx.insert(activityEvents).values({
      organizationId: input.actor.organizationId,
      userId: input.actor.id,
      type: "platform.member_sidebar_link.deleted",
      entityType: "member_sidebar_link",
      entityId: deleted.id,
      metadata: { label: deleted.label },
    });
    return true;
  });
}

export async function reorderMemberSidebarLinks(input: {
  actor: SidebarActor;
  orderedIds: string[];
}) {
  return db.transaction(async (tx) => {
    if (!(await lockAndAuthorize(tx, input.actor))) return null;
    const current = await tx
      .select({ id: memberSidebarLinks.id })
      .from(memberSidebarLinks)
      .where(eq(memberSidebarLinks.organizationId, input.actor.organizationId))
      .for("update");
    const currentIds = new Set(current.map((row) => row.id));
    if (
      currentIds.size !== input.orderedIds.length ||
      input.orderedIds.some((id) => !currentIds.has(id))
    ) {
      return false;
    }
    for (const [sortOrder, id] of input.orderedIds.entries()) {
      await tx
        .update(memberSidebarLinks)
        .set({ sortOrder, updatedAt: new Date() })
        .where(
          and(
            eq(memberSidebarLinks.id, id),
            eq(memberSidebarLinks.organizationId, input.actor.organizationId),
          ),
        );
    }
    await tx.insert(activityEvents).values({
      organizationId: input.actor.organizationId,
      userId: input.actor.id,
      type: "platform.member_sidebar_links.reordered",
      entityType: "organization",
      entityId: input.actor.organizationId,
      metadata: { orderedIds: input.orderedIds },
    });
    return true;
  });
}

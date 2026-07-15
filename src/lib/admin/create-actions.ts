"use server";

import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  bundles,
  events,
  groups,
  hubs,
  modules,
} from "@/db/schema";
import { insertInitialEventLifecycleHistory } from "@/lib/event-lifecycle";
import { privacyActorReference } from "@/lib/privacy/subject-reference";
import { requireTeamPermission } from "@/lib/auth";
import {
  agentCreateSchema,
  bundleCreateSchema,
  communitySpaceCreateSchema,
  eventCreateSchema,
  groupCreateSchema,
  hubCreateSchema,
  moduleCreateSchema,
} from "@/lib/api/schemas";
import { logServerError } from "@/lib/server-error-logging";
import { createAiAgentDraftIdentity } from "@/lib/ai/agent-studio";
import { createModuleWithStructure } from "@/lib/module-creation-service";
import { createCommunitySpaceWithLayout } from "@/lib/community-layout";
import {
  createHubTemplateLayout,
  HUB_TEMPLATE_KEYS,
} from "@/lib/hub-templates";
import { slugify } from "@/lib/utils";

export type AdminCreateState = {
  ok: boolean | null;
  message: string;
  resourceId?: string;
  code?: AdminCreateActionCode;
};

export type AdminCreateActionCode =
  | "eventCreateInvalid"
  | "eventCreateFuture"
  | "eventCreateDuplicate"
  | "eventCreated"
  | "eventCreateFailed";

function errorState(
  message: string,
  code?: AdminCreateActionCode,
): AdminCreateState {
  return { ok: false, message, code };
}

function issueMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? "Bitte pruefe die Eingaben.";
}

function optionalString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function mutationError(error: unknown, conflictMessage: string, fallback: string): AdminCreateState {
  if (isUniqueViolation(error)) return errorState(conflictMessage);
  logServerError(error, { action: "admin.create.mutation" });
  return errorState(fallback);
}

export async function createGroupAdminAction(
  _state: AdminCreateState,
  formData: FormData,
): Promise<AdminCreateState> {
  const user = await requireTeamPermission("members.manage");
  const parsed = groupCreateSchema.safeParse({
    name: stringValue(formData, "name"),
    description: optionalString(formData, "description"),
    color: stringValue(formData, "color") || "#4f7cac",
  });
  if (!parsed.success) return errorState(issueMessage(parsed.error));

  try {
    const created = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.organizationId, user.organizationId), eq(groups.name, parsed.data.name)))
        .limit(1);
      if (existing) return null;
      const [record] = await tx
        .insert(groups)
        .values({ organizationId: user.organizationId, ...parsed.data })
        .returning({ id: groups.id });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "group.created",
        entityType: "group",
        entityId: record.id,
        metadata: { name: parsed.data.name },
      });
      return record;
    });
    if (!created) return errorState("Eine Gruppe mit diesem Namen existiert bereits.");
    revalidatePath("/admin/groups");
    return { ok: true, message: "Gruppe erstellt.", resourceId: created.id };
  } catch (error) {
    return mutationError(error, "Eine Gruppe mit diesem Namen existiert bereits.", "Die Gruppe konnte nicht erstellt werden.");
  }
}

export async function createBundleAdminAction(
  _state: AdminCreateState,
  formData: FormData,
): Promise<AdminCreateState> {
  const user = await requireTeamPermission("members.manage");
  const parsed = bundleCreateSchema.safeParse({
    name: stringValue(formData, "name"),
    description: optionalString(formData, "description"),
    color: stringValue(formData, "color") || "#ee6c5d",
    active: formData.get("active") === "on",
  });
  if (!parsed.success) return errorState(issueMessage(parsed.error));

  try {
    const created = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: bundles.id })
        .from(bundles)
        .where(and(eq(bundles.organizationId, user.organizationId), eq(bundles.name, parsed.data.name)))
        .limit(1);
      if (existing) return null;
      const [record] = await tx
        .insert(bundles)
        .values({ organizationId: user.organizationId, ...parsed.data })
        .returning({ id: bundles.id });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "bundle.created",
        entityType: "bundle",
        entityId: record.id,
        metadata: { name: parsed.data.name },
      });
      return record;
    });
    if (!created) return errorState("Ein Bundle mit diesem Namen existiert bereits.");
    revalidatePath("/admin/bundles");
    return { ok: true, message: "Bundle erstellt.", resourceId: created.id };
  } catch (error) {
    return mutationError(error, "Ein Bundle mit diesem Namen existiert bereits.", "Das Bundle konnte nicht erstellt werden.");
  }
}

export async function createModuleAdminAction(
  _state: AdminCreateState,
  formData: FormData,
): Promise<AdminCreateState> {
  const user = await requireTeamPermission("courses.manage");
  const parsed = moduleCreateSchema.safeParse({
    title: stringValue(formData, "title"),
    kind: stringValue(formData, "kind") || "learning",
    description: optionalString(formData, "description"),
    folder: stringValue(formData, "folder") || "Allgemein",
    isReusable: formData.get("isReusable") === "on",
    estimatedMinutes: Number(stringValue(formData, "estimatedMinutes") || 30),
  });
  if (!parsed.success) return errorState(issueMessage(parsed.error));

  try {
    const created = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`module:${user.organizationId}:${parsed.data.folder}:${parsed.data.title}`}))`,
      );
      const [existing] = await tx
        .select({ id: modules.id })
        .from(modules)
        .where(
          and(
            eq(modules.organizationId, user.organizationId),
            eq(modules.title, parsed.data.title),
            eq(modules.folder, parsed.data.folder),
          ),
        )
        .limit(1);
      if (existing) return null;
      const structure = await createModuleWithStructure(tx, {
        organizationId: user.organizationId,
        title: parsed.data.title,
        kind: parsed.data.kind,
        description: parsed.data.description ?? null,
        folder: parsed.data.folder,
        isReusable: parsed.data.isReusable,
        estimatedMinutes: parsed.data.estimatedMinutes,
      });
      const record = structure.learningModule;
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "module.created",
        entityType: "module",
        entityId: record.id,
        metadata: {
          title: parsed.data.title,
          folder: parsed.data.folder,
          kind: parsed.data.kind,
          lessonId: structure.lesson?.id ?? null,
        },
      });
      return record;
    });
    if (!created) return errorState("Ein Modul mit diesem Titel existiert im gewaehlten Ordner bereits.");
    revalidatePath("/admin/modules");
    return { ok: true, message: "Modul erstellt.", resourceId: created.id };
  } catch (error) {
    return mutationError(error, "Ein Modul mit diesem Titel existiert bereits.", "Das Modul konnte nicht erstellt werden.");
  }
}

export async function createHubAdminAction(
  _state: AdminCreateState,
  formData: FormData,
): Promise<AdminCreateState> {
  const user = await requireTeamPermission("settings.manage");
  const title = stringValue(formData, "title");
  const template = z
    .enum(HUB_TEMPLATE_KEYS)
    .safeParse(stringValue(formData, "template") || "blank");
  if (!template.success) return errorState("Die Hub-Vorlage ist ungueltig.");
  const layout = createHubTemplateLayout(template.data, randomUUID);
  const parsed = hubCreateSchema.safeParse({
    title,
    slug: slugify(title),
    description: optionalString(formData, "description"),
    status: stringValue(formData, "status") || "draft",
    layout,
  });
  if (!parsed.success) return errorState(issueMessage(parsed.error));

  try {
    const created = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: hubs.id })
        .from(hubs)
        .where(and(eq(hubs.organizationId, user.organizationId), eq(hubs.slug, parsed.data.slug!)))
        .limit(1);
      if (existing) return null;
      const [record] = await tx
        .insert(hubs)
        .values({ organizationId: user.organizationId, ...parsed.data, slug: parsed.data.slug! })
        .returning({ id: hubs.id });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "hub.created",
        entityType: "hub",
        entityId: record.id,
        metadata: {
          title: parsed.data.title,
          slug: parsed.data.slug,
          template: template.data,
        },
      });
      return record;
    });
    if (!created) return errorState("Ein Hub mit diesem Namen existiert bereits.");
    revalidatePath("/admin/hubs");
    return { ok: true, message: "Hub erstellt.", resourceId: created.id };
  } catch (error) {
    return mutationError(error, "Ein Hub mit diesem Namen existiert bereits.", "Der Hub konnte nicht erstellt werden.");
  }
}

export async function createEventAdminAction(
  _state: AdminCreateState,
  formData: FormData,
): Promise<AdminCreateState> {
  const user = await requireTeamPermission("events.manage");
  const parsed = eventCreateSchema.safeParse({
    title: stringValue(formData, "title"),
    description: optionalString(formData, "description"),
    type: stringValue(formData, "type") || "live_call",
    startsAt: stringValue(formData, "startsAt"),
    endsAt: stringValue(formData, "endsAt"),
    timezone: stringValue(formData, "timezone"),
    meetingUrl: optionalString(formData, "meetingUrl"),
    location: optionalString(formData, "location"),
    color: stringValue(formData, "color") || "#ee6c5d",
    capacity: stringValue(formData, "capacity") ? Number(stringValue(formData, "capacity")) : null,
  });
  if (!parsed.success) return errorState(issueMessage(parsed.error), "eventCreateInvalid");
  if (parsed.data.endsAt <= new Date()) return errorState("Das Event muss in der Zukunft enden.", "eventCreateFuture");
  const eventData = { ...parsed.data };
  delete eventData.audience;

  try {
    const created = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`event:${user.organizationId}:${parsed.data.title}:${parsed.data.startsAt.toISOString()}`}))`,
      );
      const [existing] = await tx
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.organizationId, user.organizationId),
            eq(events.title, parsed.data.title),
            eq(events.startsAt, parsed.data.startsAt),
          ),
        )
        .limit(1);
      if (existing) return null;
      const [record] = await tx
        .insert(events)
        .values({ organizationId: user.organizationId, createdById: user.id, ...eventData })
        .returning({ id: events.id });
      await insertInitialEventLifecycleHistory(tx, {
        eventId: record.id,
        organizationId: user.organizationId,
        actorReference: privacyActorReference(
          user.organizationId,
          "user",
          user.id,
        ),
        startsAt: parsed.data.startsAt,
        endsAt: parsed.data.endsAt,
        timezone: parsed.data.timezone,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "event.created",
        entityType: "event",
        entityId: record.id,
        metadata: { title: parsed.data.title, startsAt: parsed.data.startsAt.toISOString() },
      });
      return record;
    });
    if (!created) return errorState("Ein Event mit diesem Titel und Startzeitpunkt existiert bereits.", "eventCreateDuplicate");
    revalidatePath("/admin/events");
    return { ok: true, message: "Event erstellt.", resourceId: created.id, code: "eventCreated" };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return errorState("Ein identisches Event existiert bereits.", "eventCreateDuplicate");
    }
    logServerError(error, { action: "admin.create.event" });
    return errorState("Das Event konnte nicht erstellt werden.", "eventCreateFailed");
  }
}

export async function createAgentAdminAction(
  _state: AdminCreateState,
  formData: FormData,
): Promise<AdminCreateState> {
  const user = await requireTeamPermission("ai.manage");
  const parsed = agentCreateSchema.safeParse({
    name: stringValue(formData, "name"),
    description: stringValue(formData, "description"),
    systemPrompt: stringValue(formData, "systemPrompt"),
    color: stringValue(formData, "color") || "#2bb7a9",
    icon: stringValue(formData, "icon") || "sparkles",
    active: formData.get("active") === "on",
  });
  if (!parsed.success) return errorState(issueMessage(parsed.error));

  try {
    const created = await createAiAgentDraftIdentity({
      actor: {
        id: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      name: parsed.data.name,
      description: parsed.data.description,
      systemPrompt: parsed.data.systemPrompt,
      color: parsed.data.color,
      icon: parsed.data.icon,
    });
    revalidatePath("/admin/ai");
    return {
      ok: true,
      message: "KI-Agent als unveroeffentlichter Entwurf erstellt.",
      resourceId: created.agentId,
    };
  } catch (error) {
    return mutationError(error, "Ein KI-Agent mit diesem Namen existiert bereits.", "Der KI-Agent konnte nicht erstellt werden.");
  }
}

export async function createCommunitySpaceAdminAction(
  _state: AdminCreateState,
  formData: FormData,
): Promise<AdminCreateState> {
  const user = await requireTeamPermission("community.manage");
  const title = stringValue(formData, "title");
  const parsed = communitySpaceCreateSchema.safeParse({
    title,
    slug: slugify(title),
    description: optionalString(formData, "description"),
    color: stringValue(formData, "color") || "#2bb7a9",
    type: stringValue(formData, "type") || "feed",
    areaId: optionalString(formData, "areaId") ?? undefined,
  });
  if (!parsed.success) return errorState(issueMessage(parsed.error));

  try {
    const created = await createCommunitySpaceWithLayout({
      organizationId: user.organizationId,
      actorId: user.id,
      areaId: parsed.data.areaId,
      position: parsed.data.position,
      title: parsed.data.title,
      slug: parsed.data.slug!,
      description: parsed.data.description,
      color: parsed.data.color,
      type: parsed.data.type,
      accessMode: parsed.data.accessMode,
    });
    revalidatePath("/admin/community");
    revalidatePath("/academy/community");
    return { ok: true, message: "Community-Bereich erstellt.", resourceId: created.id };
  } catch (error) {
    return mutationError(
      error,
      "Ein Community-Bereich mit diesem Namen existiert bereits.",
      "Der Community-Bereich konnte nicht erstellt werden.",
    );
  }
}

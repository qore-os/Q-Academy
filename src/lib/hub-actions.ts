"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  bundles,
  dataForms,
  groups,
  hubAccessGrants,
  hubs,
  users,
  type HubLayout,
  type HubLayoutWidget,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { hubAccessSchema, hubUpdateSchema } from "@/lib/api/schemas";
import { requireTeamPermission } from "@/lib/auth";
import { lockHubLayoutFormTransitionForMutation } from "@/lib/data-form-embedding";
import { assertPublishedAiAgentHubLayout } from "@/lib/hub-ai-agent-embedding";
import { cloneHub } from "@/lib/hub-clone-service";
import { HUB_CUSTOM_CODE_MAX_LENGTH } from "@/lib/hub-custom-code-policy";
import { logServerError } from "@/lib/server-error-logging";
import { safeHubEmbedUrl } from "@/lib/hub-embed-policy";
import { validateTenantPersonalizedTexts } from "@/lib/member-properties";

export type HubActionResult = {
  ok: boolean;
  code: HubActionCode;
  params?: Record<string, string>;
  resourceId?: string;
};

export type HubActionCode =
  | "idle"
  | "hub.invalid"
  | "hub.not_found"
  | "hub.dependency_unavailable"
  | "layout.invalid"
  | "layout.saved"
  | "layout.save_failed"
  | "details.invalid"
  | "details.slug_taken"
  | "details.saved"
  | "details.save_failed"
  | "hub.duplicated"
  | "hub.duplicate_failed"
  | "row.added"
  | "row.category_too_long"
  | "row.category_saved"
  | "row.deleted"
  | "row.moved"
  | "row.not_found"
  | "direction.invalid"
  | "personalization.invalid"
  | "form.invalid"
  | "form.not_found"
  | "form.unavailable"
  | "widget.invalid"
  | "widget.saved"
  | "widget.deleted"
  | "widget.moved"
  | "widget.not_found"
  | "widget.row_limit"
  | "access.invalid"
  | "access.subject_not_found"
  | "access.granted"
  | "access.not_found"
  | "access.revoked";

function actionResult(
  ok: boolean,
  code: HubActionCode,
  options?: Pick<HubActionResult, "params" | "resourceId">,
): HubActionResult {
  return { ok, code, ...options };
}

const hubIdSchema = z.string().uuid();
const directionSchema = z.enum(["up", "down"]);
const widgetTypeSchema = z.enum([
  "link",
  "text",
  "contact",
  "stat",
  "event",
  "data_form",
  "ai_agent",
  "embed",
  "code",
]);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

function optionalString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isSafeHref(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const widgetInputSchema = z
  .object({
    rowId: z.string().min(1).max(120),
    widgetIndex: z.coerce.number().int().min(-1).max(11),
    type: widgetTypeSchema,
    title: z.string().trim().min(1).max(180),
    description: z
      .string()
      .max(HUB_CUSTOM_CODE_MAX_LENGTH)
      .optional(),
    href: z
      .string()
      .trim()
      .max(2000)
      .refine((value) => !value || isSafeHref(value), {
        message: "widget.invalid",
      })
      .optional(),
    color: colorSchema,
    formId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((widget, context) => {
    if (widget.type === "data_form" && !widget.formId) {
      context.addIssue({
        code: "custom",
        path: ["formId"],
        message: "form.invalid",
      });
    }
    if (widget.type === "ai_agent" && !widget.agentId) {
      context.addIssue({
        code: "custom",
        path: ["agentId"],
        message: "widget.invalid",
      });
    }
    if (widget.type === "ai_agent" && (widget.href || widget.formId)) {
      context.addIssue({
        code: "custom",
        path: [widget.formId ? "formId" : "href"],
        message: "widget.invalid",
      });
    }
    if (widget.type !== "ai_agent" && widget.agentId) {
      context.addIssue({
        code: "custom",
        path: ["agentId"],
        message: "widget.invalid",
      });
    }
    if (widget.type === "embed" && !safeHubEmbedUrl(widget.href)) {
      context.addIssue({
        code: "custom",
        path: ["href"],
        message: "widget.invalid",
      });
    }
    if (widget.type === "code" && widget.href) {
      context.addIssue({
        code: "custom",
        path: ["href"],
        message: "widget.invalid",
      });
    }
    if (widget.type === "code" && !widget.description?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["description"],
        message: "widget.invalid",
      });
    }
    if (widget.type !== "code" && (widget.description?.length ?? 0) > 2000) {
      context.addIssue({
        code: "too_big",
        maximum: 2000,
        origin: "string",
        inclusive: true,
        path: ["description"],
        message: "widget.invalid",
      });
    }
  });

class HubMutationError extends Error {
  constructor(readonly code: HubActionCode) {
    super(code);
  }
}

function refreshHubPaths(hubId: string) {
  revalidatePath(`/admin/hubs/${hubId}`);
  revalidatePath("/admin/hubs");
  revalidatePath("/academy/hub");
}

async function mutateHubLayout(
  organizationId: string,
  actorId: string,
  hubId: string,
  operation: string,
  mutate: (layout: HubLayout) => HubLayout,
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`hub-layout:${organizationId}:${hubId}`}))`,
    );
    const [hub] = await tx
      .select({ layout: hubs.layout })
      .from(hubs)
      .where(and(eq(hubs.id, hubId), eq(hubs.organizationId, organizationId)))
      .limit(1);
    if (!hub) return null;

    const nextLayout = mutate(structuredClone(hub.layout));
    const parsed = hubUpdateSchema.safeParse({ layout: nextLayout });
    if (!parsed.success) {
      throw new HubMutationError("layout.invalid");
    }
    const validatedLayout = parsed.data.layout;
    if (!validatedLayout) {
      throw new HubMutationError("layout.invalid");
    }
    const personalizationError = await validateTenantPersonalizedTexts({
      organizationId,
      values: validatedLayout.flatMap((row) =>
        row.columns.flatMap((widget) => [
          widget.title,
          ...(widget.type === "code" ? [] : [widget.description ?? ""]),
        ]),
      ),
      staticTokens: [
        "member.firstName",
        "member.lastName",
        "member.fullName",
        "course.title",
        "course.progress",
      ],
      reader: tx,
    });
    if (personalizationError) {
      throw new HubMutationError("personalization.invalid");
    }
    if (
      !(await lockHubLayoutFormTransitionForMutation(
        hub.layout,
        validatedLayout,
        organizationId,
        tx,
      ))
    ) {
      throw new HubMutationError("form.unavailable");
    }
    await assertPublishedAiAgentHubLayout({
      transaction: tx,
      organizationId,
      layout: validatedLayout,
    });

    await tx
      .update(hubs)
      .set({ layout: validatedLayout })
      .where(and(eq(hubs.id, hubId), eq(hubs.organizationId, organizationId)));
    await tx.insert(activityEvents).values({
      organizationId,
      userId: actorId,
      type: "hub.updated",
      entityType: "hub",
      entityId: hubId,
      metadata: { operation },
    });
    return validatedLayout;
  });
}

async function runLayoutMutation(
  hubIdInput: string,
  operation: string,
  successCode: HubActionCode,
  mutate: (layout: HubLayout) => HubLayout,
): Promise<HubActionResult> {
  const user = await requireTeamPermission("settings.manage");
  const parsedHubId = hubIdSchema.safeParse(hubIdInput);
  if (!parsedHubId.success) {
    return actionResult(false, "hub.invalid");
  }

  try {
    const updated = await mutateHubLayout(
      user.organizationId,
      user.id,
      parsedHubId.data,
      operation,
      mutate,
    );
    if (!updated) return actionResult(false, "hub.not_found");
    refreshHubPaths(parsedHubId.data);
    return actionResult(true, successCode);
  } catch (error) {
    if (error instanceof HubMutationError) {
      return actionResult(false, error.code);
    }
    if (error instanceof ApiError) {
      return actionResult(false, "hub.dependency_unavailable");
    }
    logServerError(error, { action: "admin.hub.layout" });
    return actionResult(false, "layout.save_failed");
  }
}

export async function updateHubDetailsAction(
  hubId: string,
  _state: HubActionResult,
  formData: FormData,
): Promise<HubActionResult> {
  const user = await requireTeamPermission("settings.manage");
  const parsedHubId = hubIdSchema.safeParse(hubId);
  const parsed = hubUpdateSchema.safeParse({
    title: formData.get("title"),
    slug: formData.get("slug"),
    description: optionalString(formData.get("description")) ?? null,
    status: formData.get("status"),
  });
  if (!parsedHubId.success || !parsed.success) {
    return actionResult(
      false,
      parsedHubId.success ? "details.invalid" : "hub.invalid",
    );
  }

  try {
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: hubs.id, slug: hubs.slug, layout: hubs.layout })
        .from(hubs)
        .where(
          and(
            eq(hubs.id, parsedHubId.data),
            eq(hubs.organizationId, user.organizationId),
          ),
        )
        .limit(1);
      if (!current) return null;

      await assertPublishedAiAgentHubLayout({
        transaction: tx,
        organizationId: user.organizationId,
        layout: current.layout,
      });

      if (parsed.data.slug !== current.slug) {
        const [duplicate] = await tx
          .select({ id: hubs.id })
          .from(hubs)
          .where(
            and(
              eq(hubs.organizationId, user.organizationId),
              eq(hubs.slug, parsed.data.slug!),
            ),
          )
          .limit(1);
        if (duplicate) {
          throw new HubMutationError("details.slug_taken");
        }
      }

      const [record] = await tx
        .update(hubs)
        .set(parsed.data)
        .where(
          and(
            eq(hubs.id, current.id),
            eq(hubs.organizationId, user.organizationId),
          ),
        )
        .returning({ id: hubs.id });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "hub.updated",
        entityType: "hub",
        entityId: current.id,
        metadata: { operation: "details.updated" },
      });
      return record;
    });
    if (!updated) return actionResult(false, "hub.not_found");
    refreshHubPaths(parsedHubId.data);
    return actionResult(true, "details.saved");
  } catch (error) {
    if (error instanceof HubMutationError) {
      return actionResult(false, error.code);
    }
    if (error instanceof ApiError) {
      return actionResult(false, "hub.dependency_unavailable");
    }
    logServerError(error, { action: "admin.hub.update" });
    return actionResult(false, "details.save_failed");
  }
}

export async function duplicateHubAction(
  hubId: string,
): Promise<HubActionResult> {
  const user = await requireTeamPermission("settings.manage");
  const parsedHubId = hubIdSchema.safeParse(hubId);
  if (!parsedHubId.success) {
    return actionResult(false, "hub.invalid");
  }
  try {
    const cloned = await db.transaction(async (tx) => {
      const clone = await cloneHub(tx, {
        organizationId: user.organizationId,
        sourceHubId: parsedHubId.data,
      });
      if (!clone) return null;
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "hub.created",
        entityType: "hub",
        entityId: clone.id,
        metadata: {
          operation: "hub.cloned",
          sourceHubId: parsedHubId.data,
          title: clone.title,
        },
      });
      return clone;
    });
    if (!cloned) return actionResult(false, "hub.not_found");
    revalidatePath("/admin/hubs");
    refreshHubPaths(cloned.id);
    return actionResult(true, "hub.duplicated", { resourceId: cloned.id });
  } catch (error) {
    if (error instanceof ApiError) {
      return actionResult(false, "hub.dependency_unavailable");
    }
    logServerError(error, { action: "admin.hub.clone" });
    return actionResult(false, "hub.duplicate_failed");
  }
}

export async function addHubRowAction(hubId: string) {
  return runLayoutMutation(
    hubId,
    "row.created",
    "row.added",
    (layout) => {
      layout.push({ id: crypto.randomUUID(), columns: [] });
      return layout;
    },
  );
}

export async function updateHubRowCategoryAction(
  hubId: string,
  rowId: string,
  formData: FormData,
) {
  const category = optionalString(formData.get("category"));
  if (category && category.length > 80) {
    return actionResult(false, "row.category_too_long");
  }
  return runLayoutMutation(
    hubId,
    "row.category_updated",
    "row.category_saved",
    (layout) => {
      const row = layout.find((candidate) => candidate.id === rowId);
      if (!row) throw new HubMutationError("row.not_found");
      if (category) row.category = category;
      else delete row.category;
      return layout;
    },
  );
}

export async function deleteHubRowAction(hubId: string, rowId: string) {
  return runLayoutMutation(
    hubId,
    "row.deleted",
    "row.deleted",
    (layout) => {
      const index = layout.findIndex((row) => row.id === rowId);
      if (index < 0) throw new HubMutationError("row.not_found");
      layout.splice(index, 1);
      return layout;
    },
  );
}

export async function moveHubRowAction(
  hubId: string,
  rowId: string,
  directionInput: "up" | "down",
) {
  return runLayoutMutation(
    hubId,
    "row.moved",
    "row.moved",
    (layout) => {
      const parsedDirection = directionSchema.safeParse(directionInput);
      if (!parsedDirection.success) {
        throw new HubMutationError("direction.invalid");
      }
      const index = layout.findIndex((row) => row.id === rowId);
      const target = parsedDirection.data === "up" ? index - 1 : index + 1;
      if (index < 0) throw new HubMutationError("row.not_found");
      if (target < 0 || target >= layout.length) return layout;
      [layout[index], layout[target]] = [layout[target], layout[index]];
      return layout;
    },
  );
}

export async function saveHubWidgetAction(
  hubId: string,
  formData: FormData,
): Promise<HubActionResult> {
  const actor = await requireTeamPermission("settings.manage");
  const requestedType = widgetTypeSchema.safeParse(formData.get("type"));
  const requestedFormId = optionalString(formData.get("formId"));
  const requestedAgentId = optionalString(formData.get("agentId"));
  const personalizationError = await validateTenantPersonalizedTexts({
    organizationId: actor.organizationId,
    values: [
      String(formData.get("title") ?? ""),
      ...(requestedType.success && requestedType.data === "code"
        ? []
        : [String(formData.get("description") ?? "")]),
    ],
    staticTokens: [
      "member.firstName",
      "member.lastName",
      "member.fullName",
      "course.title",
      "course.progress",
    ],
  });
  if (personalizationError) {
    return actionResult(false, "personalization.invalid");
  }
  if (requestedType.success && requestedType.data === "data_form") {
    const parsedFormId = hubIdSchema.safeParse(requestedFormId);
    if (!parsedFormId.success) {
      return actionResult(false, "form.invalid");
    }
    const [form] = await db
      .select({ id: dataForms.id })
      .from(dataForms)
      .where(
        and(
          eq(dataForms.id, parsedFormId.data),
          eq(dataForms.organizationId, actor.organizationId),
          eq(dataForms.active, true),
        ),
      )
      .limit(1);
    if (!form) return actionResult(false, "form.not_found");
  }
  return runLayoutMutation(
    hubId,
    "widget.saved",
    "widget.saved",
    (layout) => {
      const parsed = widgetInputSchema.safeParse({
        rowId: formData.get("rowId"),
        widgetIndex: formData.get("widgetIndex"),
        type: formData.get("type"),
        title: formData.get("title"),
        description:
          requestedType.success && requestedType.data === "code"
            ? (() => {
                const value = formData.get("description");
                return typeof value === "string" && value.trim()
                  ? value
                  : undefined;
              })()
            : optionalString(formData.get("description")),
        href: optionalString(formData.get("href")),
        color: formData.get("color") || "#2bb7a9",
        formId: requestedFormId,
        agentId: requestedAgentId,
      });
      if (!parsed.success) {
        const issueCode = parsed.error.issues[0]?.message;
        throw new HubMutationError(
          issueCode === "form.invalid" ? "form.invalid" : "widget.invalid",
        );
      }

      const { rowId, widgetIndex, ...widget } = parsed.data;
      const base = {
        title: widget.title,
        ...(widget.description ? { description: widget.description } : {}),
        color: widget.color,
      };
      const safeWidget: HubLayoutWidget =
        widget.type === "ai_agent"
          ? { ...base, type: "ai_agent", agentId: widget.agentId! }
          : widget.type === "data_form"
            ? { ...base, type: "data_form", formId: widget.formId! }
            : widget.type === "embed"
              ? {
                  ...base,
                  type: "embed",
                  href: safeHubEmbedUrl(widget.href)!,
                }
              : widget.type === "code"
                ? { ...base, type: "code" }
            : {
                ...base,
                type: widget.type,
                ...(widget.href ? { href: widget.href } : {}),
              };
      const row = layout.find((candidate) => candidate.id === rowId);
      if (!row) throw new HubMutationError("row.not_found");
      if (widgetIndex < 0) {
        if (row.columns.length >= 12) {
          throw new HubMutationError("widget.row_limit");
        }
        row.columns.push(safeWidget);
      } else {
        if (!row.columns[widgetIndex]) {
          throw new HubMutationError("widget.not_found");
        }
        row.columns[widgetIndex] = safeWidget;
      }
      return layout;
    },
  );
}

export async function deleteHubWidgetAction(
  hubId: string,
  rowId: string,
  widgetIndex: number,
) {
  return runLayoutMutation(
    hubId,
    "widget.deleted",
    "widget.deleted",
    (layout) => {
      const row = layout.find((candidate) => candidate.id === rowId);
      if (!row?.columns[widgetIndex]) {
        throw new HubMutationError("widget.not_found");
      }
      row.columns.splice(widgetIndex, 1);
      return layout;
    },
  );
}

export async function moveHubWidgetAction(
  hubId: string,
  rowId: string,
  widgetIndex: number,
  directionInput: "up" | "down",
) {
  return runLayoutMutation(
    hubId,
    "widget.moved",
    "widget.moved",
    (layout) => {
      const parsedDirection = directionSchema.safeParse(directionInput);
      if (!parsedDirection.success) {
        throw new HubMutationError("direction.invalid");
      }
      const row = layout.find((candidate) => candidate.id === rowId);
      if (!row?.columns[widgetIndex]) {
        throw new HubMutationError("widget.not_found");
      }
      const target =
        parsedDirection.data === "up" ? widgetIndex - 1 : widgetIndex + 1;
      if (target < 0 || target >= row.columns.length) return layout;
      [row.columns[widgetIndex], row.columns[target]] = [
        row.columns[target],
        row.columns[widgetIndex],
      ];
      return layout;
    },
  );
}

async function accessSubjectExists(
  organizationId: string,
  subjectType: "user" | "group" | "bundle",
  subjectId: string,
) {
  if (subjectType === "user") {
    const [subject] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.id, subjectId), eq(users.organizationId, organizationId)),
      )
      .limit(1);
    return Boolean(subject);
  }
  if (subjectType === "group") {
    const [subject] = await db
      .select({ id: groups.id })
      .from(groups)
      .where(
        and(
          eq(groups.id, subjectId),
          eq(groups.organizationId, organizationId),
        ),
      )
      .limit(1);
    return Boolean(subject);
  }
  const [subject] = await db
    .select({ id: bundles.id })
    .from(bundles)
    .where(
      and(
        eq(bundles.id, subjectId),
        eq(bundles.organizationId, organizationId),
      ),
    )
    .limit(1);
  return Boolean(subject);
}

export async function grantHubAccessAction(
  hubId: string,
  formData: FormData,
): Promise<HubActionResult> {
  const user = await requireTeamPermission("settings.manage");
  const parsedHubId = hubIdSchema.safeParse(hubId);
  const parsed = hubAccessSchema.safeParse({
    subjectType: formData.get("subjectType"),
    subjectId: formData.get("subjectId"),
  });
  if (!parsedHubId.success || !parsed.success) {
    return actionResult(false, "access.invalid");
  }

  const [hub] = await db
    .select({ id: hubs.id })
    .from(hubs)
    .where(
      and(
        eq(hubs.id, parsedHubId.data),
        eq(hubs.organizationId, user.organizationId),
      ),
    )
    .limit(1);
  if (!hub) return actionResult(false, "hub.not_found");
  if (
    !(await accessSubjectExists(
      user.organizationId,
      parsed.data.subjectType,
      parsed.data.subjectId,
    ))
  ) {
    return actionResult(false, "access.subject_not_found");
  }

  await db
    .insert(hubAccessGrants)
    .values({ hubId: hub.id, ...parsed.data })
    .onConflictDoUpdate({
      target: [
        hubAccessGrants.hubId,
        hubAccessGrants.subjectType,
        hubAccessGrants.subjectId,
      ],
      set: { createdAt: new Date() },
    });
  refreshHubPaths(hub.id);
  return actionResult(true, "access.granted");
}

export async function revokeHubAccessAction(
  hubId: string,
  subjectType: "user" | "group" | "bundle",
  subjectId: string,
): Promise<HubActionResult> {
  const user = await requireTeamPermission("settings.manage");
  const parsedHubId = hubIdSchema.safeParse(hubId);
  const parsed = hubAccessSchema.safeParse({ subjectType, subjectId });
  if (!parsedHubId.success || !parsed.success) {
    return actionResult(false, "access.invalid");
  }

  const [hub] = await db
    .select({ id: hubs.id })
    .from(hubs)
    .where(
      and(
        eq(hubs.id, parsedHubId.data),
        eq(hubs.organizationId, user.organizationId),
      ),
    )
    .limit(1);
  if (!hub) return actionResult(false, "hub.not_found");

  const deleted = await db
    .delete(hubAccessGrants)
    .where(
      and(
        eq(hubAccessGrants.hubId, hub.id),
        eq(hubAccessGrants.subjectType, parsed.data.subjectType),
        eq(hubAccessGrants.subjectId, parsed.data.subjectId),
      ),
    )
    .returning({ hubId: hubAccessGrants.hubId });
  if (!deleted.length) {
    return actionResult(false, "access.not_found");
  }
  refreshHubPaths(hub.id);
  return actionResult(true, "access.revoked");
}

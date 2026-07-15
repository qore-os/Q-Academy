"use server";

import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import Papa from "papaparse";
import { z } from "zod";
import { db } from "@/db";
import { activityEvents, invitations, users, userSessions } from "@/db/schema";
import { requireTeamPermission } from "@/lib/auth";
import { deliverAuthLink, generateOpaqueToken, hashOpaqueToken } from "@/lib/auth-tokens";
import { getCanonicalTenantAuthOrigin } from "@/lib/branding";
import { ApiError } from "@/lib/api/errors";
import { transferOrganizationOwnershipInTransaction } from "@/lib/organization-ownership";
import { assertOrganizationSeatCapacity } from "@/lib/organization-contracts";
import {
  PrivacyOwnerStepUpError,
  verifyPrivacyOwnerStepUp,
} from "@/lib/privacy/owner-step-up";
import { logServerError } from "@/lib/server-error-logging";

export type MemberImportIssue = {
  row: number;
  email: string;
  code:
    | "parseFailed"
    | "invalidField"
    | "duplicateInFile"
    | "existingEmail"
    | "ownerForbidden"
    | "adminForbidden"
    | "invitedRequired"
    | "createdConcurrently"
    | "capacity"
    | "recordFailed";
  field?: (typeof CSV_COLUMNS)[number] | "row";
  limit?: number;
  kind: "invalid" | "skipped";
};

export type MemberImportSummary = {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  issues: MemberImportIssue[];
};

export type MemberImportState = {
  ok: boolean | null;
  code?:
    | "fileRequired"
    | "csvRequired"
    | "fileTooLarge"
    | "invalidFile"
    | "invalidHeader"
    | "noRows"
    | "tooManyRows"
    | "parseFailed"
    | "complete";
  expectedHeader?: string;
  limit?: number;
  summary?: MemberImportSummary;
};

export type MemberExportResult =
  | { ok: true; filename: string; csv: string }
  | { ok: false; code: "exportFailed" };

export type MemberStatusResult =
  | {
      ok: true;
      code: "unchanged" | "activated" | "disabled";
      status: "active" | "disabled";
      memberName: string;
    }
  | {
      ok: false;
      code:
        | "invalid"
        | "notFound"
        | "selfDisable"
        | "ownerProtected"
        | "adminForbidden"
        | "capacity"
        | "failed";
      limit?: number;
    };

export type OwnershipTransferState = Readonly<{
  ok: boolean | null;
  message: string;
  code?: OwnershipTransferCode;
  targetEmail?: string;
}>;

export type OwnershipTransferCode =
  | "ownershipIncomplete"
  | "ownershipOwnerOnly"
  | "ownershipEmailMismatch"
  | "ownershipTransferred"
  | "ownershipStepUpFailed"
  | "ownershipFailed";

const CSV_COLUMNS = [
  "email",
  "first_name",
  "last_name",
  "role",
  "status",
  "job_title",
  "department",
] as const;

const MAX_CSV_BYTES = 500_000;
const MAX_CSV_ROWS = 250;
const identifierSchema = z.string().uuid();
const targetStatusSchema = z.enum(["active", "disabled"]);
const ownershipTransferSchema = z
  .object({
    targetUserId: identifierSchema,
    confirmationEmail: z.string().trim().toLowerCase().email().max(255),
    password: z.string().max(1_024).default(""),
  })
  .strict();

const csvRowSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("ungueltige E-Mail-Adresse").max(255),
    first_name: z.string().trim().min(2, "mindestens 2 Zeichen").max(100, "maximal 100 Zeichen"),
    last_name: z.string().trim().min(2, "mindestens 2 Zeichen").max(100, "maximal 100 Zeichen"),
    role: z.preprocess(
      (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
      z.enum(["owner", "admin", "trainer", "member"]),
    ),
    status: z.preprocess(
      (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
      z.enum(["active", "invited", "disabled"]),
    ),
    job_title: z.string().trim().max(180, "maximal 180 Zeichen").transform((value) => value || null),
    department: z.string().trim().max(120, "maximal 120 Zeichen").transform((value) => value || null),
  })
  .strict();

function fatalImport(
  code: NonNullable<MemberImportState["code"]>,
  detail: Pick<MemberImportState, "expectedHeader" | "limit"> = {},
): MemberImportState {
  return { ok: false, code, ...detail };
}

function rowValidationField(error: z.ZodError): MemberImportIssue["field"] {
  const issue = error.issues[0];
  const field = String(issue?.path[0] ?? "row");
  return CSV_COLUMNS.includes(field as (typeof CSV_COLUMNS)[number])
    ? (field as (typeof CSV_COLUMNS)[number])
    : "row";
}

function databaseCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  return "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function apiErrorLimit(error: unknown) {
  if (!(error instanceof ApiError)) return undefined;
  const details = error.details;
  if (!details || typeof details !== "object" || !("limit" in details)) {
    return undefined;
  }
  const limit = details.limit;
  return typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0
    ? limit
    : undefined;
}

export async function exportMembersCsvAdminAction(): Promise<MemberExportResult> {
  const actor = await requireTeamPermission("members.view");

  const rows = await db
    .select({
      email: users.email,
      first_name: users.firstName,
      last_name: users.lastName,
      role: users.role,
      status: users.status,
      job_title: users.jobTitle,
      department: users.department,
    })
    .from(users)
    .where(eq(users.organizationId, actor.organizationId))
    .orderBy(asc(users.email));

  const csv = Papa.unparse(rows, {
    columns: [...CSV_COLUMNS],
    escapeFormulae: true,
    header: true,
    newline: "\r\n",
  });

  return {
    ok: true,
    filename: `mitglieder-${new Date().toISOString().slice(0, 10)}.csv`,
    csv,
  };
}

export async function importMembersCsvAdminAction(
  _state: MemberImportState,
  formData: FormData,
): Promise<MemberImportState> {
  const actor = await requireTeamPermission("members.manage");
  const invitationOrigin = await getCanonicalTenantAuthOrigin(
    actor.organizationId,
  );
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return fatalImport("fileRequired");
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return fatalImport("csvRequired");
  }
  if (file.size > MAX_CSV_BYTES) {
    return fatalImport("fileTooLarge");
  }

  const text = (await file.text()).replace(/^\uFEFF/, "");
  if (!text.trim() || text.includes("\0")) {
    return fatalImport("invalidFile");
  }

  const parsed = Papa.parse<Record<string, string>>(text, {
    dynamicTyping: false,
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.replace(/^\uFEFF/, "").trim().toLowerCase(),
  });
  const headers = parsed.meta.fields ?? [];
  if (headers.length !== CSV_COLUMNS.length || headers.some((header, index) => header !== CSV_COLUMNS[index])) {
    return fatalImport("invalidHeader", {
      expectedHeader: CSV_COLUMNS.join(","),
    });
  }
  if (parsed.data.length === 0) return fatalImport("noRows");
  if (parsed.data.length > MAX_CSV_ROWS) {
    return fatalImport("tooManyRows", { limit: MAX_CSV_ROWS });
  }

  const parseErrors = new Set<number>();
  for (const error of parsed.errors) {
    if (typeof error.row !== "number") {
      return fatalImport("parseFailed");
    }
    parseErrors.add(error.row);
  }

  const tenantMembers = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.organizationId, actor.organizationId));
  const existingEmails = new Set(tenantMembers.map((member) => member.email.trim().toLowerCase()));
  const seenEmails = new Set<string>();
  const issues: MemberImportIssue[] = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const [index, rawRow] of parsed.data.entries()) {
    const csvRow = index + 2;
    if (parseErrors.has(index)) {
      failed += 1;
      issues.push({
        row: csvRow,
        email: typeof rawRow.email === "string" ? rawRow.email.trim().toLowerCase() : "-",
        code: "parseFailed",
        kind: "invalid",
      });
      continue;
    }

    const row = csvRowSchema.safeParse(rawRow);
    if (!row.success) {
      failed += 1;
      issues.push({
        row: csvRow,
        email: typeof rawRow.email === "string" ? rawRow.email.trim().toLowerCase() : "-",
        code: "invalidField",
        field: rowValidationField(row.error),
        kind: "invalid",
      });
      continue;
    }

    const email = row.data.email;
    if (seenEmails.has(email)) {
      skipped += 1;
      issues.push({ row: csvRow, email, code: "duplicateInFile", kind: "skipped" });
      continue;
    }
    seenEmails.add(email);

    if (existingEmails.has(email)) {
      skipped += 1;
      issues.push({ row: csvRow, email, code: "existingEmail", kind: "skipped" });
      continue;
    }
    if (row.data.role === "owner") {
      failed += 1;
      issues.push({ row: csvRow, email, code: "ownerForbidden", kind: "invalid" });
      continue;
    }
    if (row.data.role === "admin" && actor.role !== "owner") {
      failed += 1;
      issues.push({ row: csvRow, email, code: "adminForbidden", kind: "invalid" });
      continue;
    }
    if (row.data.status !== "invited") {
      failed += 1;
      issues.push({ row: csvRow, email, code: "invitedRequired", kind: "invalid" });
      continue;
    }

    const passwordHash = await hash(randomBytes(48).toString("base64url"), 12);
    const invitationToken = generateOpaqueToken("invite");
    const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);

    try {
      const member = await db.transaction(async (tx) => {
        await assertOrganizationSeatCapacity(tx, {
          organizationId: actor.organizationId,
        });
        const [created] = await tx
          .insert(users)
          .values({
            organizationId: actor.organizationId,
            email,
            passwordHash,
            firstName: row.data.first_name,
            lastName: row.data.last_name,
            role: row.data.role,
            status: "invited",
            jobTitle: row.data.job_title,
            department: row.data.department,
          })
          .onConflictDoNothing({ target: [users.organizationId, users.email] })
          .returning({ id: users.id });
        if (!created) return null;

        await tx.insert(invitations).values({
          organizationId: actor.organizationId,
          userId: created.id,
          email,
          tokenHash: hashOpaqueToken(invitationToken),
          expiresAt: invitationExpiresAt,
          createdById: actor.id,
        });
        await tx.insert(activityEvents).values({
          organizationId: actor.organizationId,
          userId: actor.id,
          type: "member.invited",
          entityType: "user",
          entityId: created.id,
          metadata: { source: "csv_import", role: row.data.role },
        });
        await deliverAuthLink(
          {
            organizationId: actor.organizationId,
            userId: created.id,
            event: "invitation.created",
            email,
            link: `${invitationOrigin}/invitations/${encodeURIComponent(invitationToken)}`,
          },
          tx,
        );
        return created;
      });

      if (!member) {
        skipped += 1;
        issues.push({ row: csvRow, email, code: "createdConcurrently", kind: "skipped" });
        existingEmails.add(email);
        continue;
      }

      imported += 1;
      existingEmails.add(email);
    } catch (error) {
      const limit = apiErrorLimit(error);
      if (limit) {
        failed += 1;
        issues.push({ row: csvRow, email, code: "capacity", limit, kind: "invalid" });
      } else if (databaseCode(error) === "23505") {
        skipped += 1;
        issues.push({ row: csvRow, email, code: "existingEmail", kind: "skipped" });
      } else {
        logServerError(error, { action: "member.csv_import" });
        failed += 1;
        issues.push({ row: csvRow, email, code: "recordFailed", kind: "invalid" });
      }
    }
  }

  if (imported > 0) revalidatePath("/admin/members");
  const summary = { total: parsed.data.length, imported, skipped, failed, issues };
  return {
    ok: failed === 0,
    code: "complete",
    summary,
  };
}

export async function setMemberStatusAdminAction(
  memberId: string,
  targetStatus: "active" | "disabled",
): Promise<MemberStatusResult> {
  const actor = await requireTeamPermission("members.manage");
  const parsed = z.object({ memberId: identifierSchema, targetStatus: targetStatusSchema }).safeParse({
    memberId,
    targetStatus,
  });
  if (!parsed.success) return { ok: false, code: "invalid" };

  const [member] = await db
    .select({ id: users.id, role: users.role, status: users.status, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(and(eq(users.id, parsed.data.memberId), eq(users.organizationId, actor.organizationId)))
    .limit(1);
  if (!member) return { ok: false, code: "notFound" };
  if (member.id === actor.id && parsed.data.targetStatus === "disabled") {
    return { ok: false, code: "selfDisable" };
  }
  if (member.role === "owner") {
    return { ok: false, code: "ownerProtected" };
  }
  if (member.role === "admin" && actor.role !== "owner") {
    return { ok: false, code: "adminForbidden" };
  }
  const memberName = `${member.firstName} ${member.lastName}`;
  if (member.status === parsed.data.targetStatus) {
    return {
      ok: true,
      code: "unchanged",
      status: parsed.data.targetStatus,
      memberName,
    };
  }

  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      if (member.status === "disabled" && parsed.data.targetStatus === "active") {
        await assertOrganizationSeatCapacity(tx, {
          organizationId: actor.organizationId,
        });
      }
      await tx
        .update(users)
        .set({ status: parsed.data.targetStatus })
        .where(and(eq(users.id, member.id), eq(users.organizationId, actor.organizationId)));

      if (parsed.data.targetStatus === "disabled") {
        await tx
          .update(userSessions)
          .set({ revokedAt: now })
          .where(and(eq(userSessions.userId, member.id), eq(userSessions.organizationId, actor.organizationId), isNull(userSessions.revokedAt)));
        await tx
          .update(invitations)
          .set({ acceptedAt: now })
          .where(and(eq(invitations.userId, member.id), eq(invitations.organizationId, actor.organizationId), isNull(invitations.acceptedAt)));
      }

      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "member.updated",
        entityType: "user",
        entityId: member.id,
        metadata: { status: parsed.data.targetStatus },
      });
    });
  } catch (error) {
    const limit = apiErrorLimit(error);
    if (limit) return { ok: false, code: "capacity", limit };
    logServerError(error, { action: "member.status.update" });
    return { ok: false, code: "failed" };
  }

  revalidatePath("/admin/members");
  return {
    ok: true,
    code: parsed.data.targetStatus === "active" ? "activated" : "disabled",
    status: parsed.data.targetStatus,
    memberName,
  };
}

export async function transferOrganizationOwnershipAdminAction(
  _previousState: OwnershipTransferState,
  formData: FormData,
): Promise<OwnershipTransferState> {
  const actor = await requireTeamPermission("members.manage");
  const parsed = ownershipTransferSchema.safeParse({
    targetUserId: formData.get("targetUserId"),
    confirmationEmail: formData.get("confirmationEmail"),
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, code: "ownershipIncomplete", message: "Die Owner-Uebertragung ist unvollstaendig." };
  }
  if (actor.role !== "owner") {
    return { ok: false, code: "ownershipOwnerOnly", message: "Diese Aktion ist dem Owner vorbehalten." };
  }

  const [target] = await db
    .select({ email: users.email })
    .from(users)
    .where(
      and(
        eq(users.id, parsed.data.targetUserId),
        eq(users.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!target || target.email.toLowerCase() !== parsed.data.confirmationEmail) {
    return {
      ok: false,
      code: "ownershipEmailMismatch",
      message: "Die bestaetigte E-Mail-Adresse stimmt nicht mit dem Zielkonto ueberein.",
    };
  }

  try {
    await verifyPrivacyOwnerStepUp(actor, parsed.data.password);
    const result = await db.transaction((tx) =>
      transferOrganizationOwnershipInTransaction(tx, {
        actor,
        targetUserId: parsed.data.targetUserId,
      }),
    );
    revalidatePath("/admin/members");
    revalidatePath(`/admin/members/${result.nextOwnerId}`);
    return {
      ok: true,
      code: "ownershipTransferred",
      targetEmail: result.nextOwnerEmail,
      message: `Ownership wurde an ${result.nextOwnerEmail} uebertragen. Beide Konten muessen sich neu anmelden.`,
    };
  } catch (error) {
    if (error instanceof PrivacyOwnerStepUpError || error instanceof ApiError) {
      return { ok: false, code: "ownershipStepUpFailed", message: error.message };
    }
    logServerError(error, { action: "organization.owner_transfer" });
    return {
      ok: false,
      code: "ownershipFailed",
      message: "Ownership konnte nicht uebertragen werden.",
    };
  }
}

import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { and, asc, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { invitations, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import {
  memberCreatePolicySchema,
  memberCreateSchema,
} from "@/lib/api/schemas";
import {
  deliverAuthLink,
  generateOpaqueToken,
  hashOpaqueToken,
} from "@/lib/auth-tokens";
import { getCanonicalTenantAuthOrigin } from "@/lib/branding";
import { safeAvatarSource } from "@/lib/avatar-policy";
import { assertOrganizationSeatCapacity } from "@/lib/organization-contracts";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

const publicMemberFields = {
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
};

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["members:read"], action: "member.list", resourceType: "member" }, async (context) => {
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const conditions: SQL[] = [eq(users.organizationId, context.organizationId)];
    const search = url.searchParams.get("search")?.trim();
    const role = url.searchParams.get("role");
    const status = url.searchParams.get("status");
    if (search) {
      conditions.push(
        or(
          ilike(users.firstName, `%${search}%`),
          ilike(users.lastName, `%${search}%`),
          ilike(users.email, `%${search}%`),
          ilike(users.department, `%${search}%`),
        )!,
      );
    }
    if (role && ["owner", "admin", "trainer", "member"].includes(role)) {
      conditions.push(eq(users.role, role as "owner" | "admin" | "trainer" | "member"));
    }
    if (status && ["active", "invited", "disabled"].includes(status)) {
      conditions.push(eq(users.status, status as "active" | "invited" | "disabled"));
    }
    const order = url.searchParams.get("sort") === "name:asc" ? asc(users.lastName) : desc(users.createdAt);
    const rows = await db
      .select(publicMemberFields)
      .from(users)
      .where(and(...conditions))
      .orderBy(order)
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = (hasMore ? rows.slice(0, pagination.limit) : rows).map(
      (member) => ({
        ...member,
        avatarUrl: safeAvatarSource(member.avatarUrl),
      }),
    );
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
  });
}

export async function POST(request: Request) {
  return handleTransactionalApiCommand(
    request,
    { scopes: ["members:write"], action: "member.create", resourceType: "member", idempotent: true },
    {
      prepare: async (context) => {
        const policyInput = await parseJson(request, memberCreatePolicySchema);
        if (policyInput.role !== "member" || policyInput.status !== "invited") {
          throw new ApiError(
            403,
            "forbidden",
            "Der members:write-Scope darf ausschliesslich eingeladene Mitgliedskonten anlegen.",
          );
        }
        const input = memberCreateSchema.parse(policyInput);
        const email = input.email.toLowerCase();
        const passwordHash = await hash(
          randomBytes(48).toString("base64url"),
          12,
        );
        const token = generateOpaqueToken("invite");
        const invitationOrigin = await getCanonicalTenantAuthOrigin(
          context.organizationId,
        );
        const invitationLink = `${invitationOrigin}/invitations/${encodeURIComponent(token)}`;
        const invitationExpiresAt = new Date(
          Date.now() + 7 * 24 * 60 * 60_000,
        );
        return {
          email,
          input,
          invitationExpiresAt,
          invitationLink,
          passwordHash,
          token,
        };
      },
      execute: async (
        { context, tx, activity, webhook },
        {
          email,
          input,
          invitationExpiresAt,
          invitationLink,
          passwordHash,
          token,
        },
      ) => {
        const [duplicate] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.organizationId, context.organizationId),
              eq(users.email, email),
            ),
          )
          .limit(1);
        if (duplicate) {
          throw new ApiError(
            409,
            "conflict",
            "Ein Mitglied mit dieser E-Mail-Adresse existiert bereits.",
          );
        }
        await assertOrganizationSeatCapacity(tx, {
          organizationId: context.organizationId,
        });
        const [createdMember] = await tx
          .insert(users)
          .values({
            ...input,
            email,
            passwordHash,
            organizationId: context.organizationId,
            role: "member",
            status: "invited",
          })
          .returning(publicMemberFields);
        const [createdInvitation] = await tx
          .insert(invitations)
          .values({
            organizationId: context.organizationId,
            userId: createdMember.id,
            email: createdMember.email,
            tokenHash: hashOpaqueToken(token),
            expiresAt: invitationExpiresAt,
          })
          .returning();
        await deliverAuthLink(
          {
            organizationId: context.organizationId,
            userId: createdMember.id,
            event: "invitation.created",
            email: createdMember.email,
            link: invitationLink,
          },
          tx,
        );
        await activity({
          type: "member.invited",
          entityType: "user",
          entityId: createdMember.id,
          metadata: { role: createdMember.role, status: createdMember.status },
        });
        await webhook("member.created", createdMember);
        return {
          data: {
            ...createdMember,
            invitation: {
              token,
              link: invitationLink,
              expiresAt: createdInvitation.expiresAt,
            },
          },
          status: 201,
          resourceId: createdMember.id,
          meta: { invitationTokenShownOnce: true },
        };
      },
    },
  );
}

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bundles, memberBundles, users } from "@/db/schema";
import { assignBundleToMember, unassignBundleFromMember } from "@/lib/access";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertOwnership(userId: string, bundleId: string, organizationId: string) {
  const [[member], [bundle]] = await Promise.all([
    db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, organizationId)))
      .limit(1),
    db
      .select({ id: bundles.id })
      .from(bundles)
      .where(and(eq(bundles.id, bundleId), eq(bundles.organizationId, organizationId)))
      .limit(1),
  ]);
  if (!member) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
  if (!bundle) throw new ApiError(404, "not_found", "Bundle nicht gefunden.");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; bundleId: string }> },
) {
  const { id, bundleId } = await params;
  return handleApi(
    request,
    { scopes: ["members:read"], action: "member.bundle.read", resourceType: "member" },
    async (context) => {
      await assertOwnership(id, bundleId, context.organizationId);
      const [assignment] = await db
        .select()
        .from(memberBundles)
        .where(and(eq(memberBundles.userId, id), eq(memberBundles.bundleId, bundleId)))
        .limit(1);
      if (!assignment) {
        throw new ApiError(404, "not_found", "Bundle-Zuweisung nicht gefunden.");
      }
      return { data: assignment, resourceId: id };
    },
  );
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; bundleId: string }> },
) {
  const { id, bundleId } = await params;
  return handleApi(
    request,
    {
      scopes: ["members:write"],
      action: "member.bundle.assign",
      resourceType: "member",
      idempotent: true,
    },
    async (context) => {
      await assertOwnership(id, bundleId, context.organizationId);
      const result = await assignBundleToMember(context.organizationId, id, bundleId);
      return {
        data: { ...result.assignment, courses: result.courses },
        resourceId: id,
      };
    },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; bundleId: string }> },
) {
  const { id, bundleId } = await params;
  return handleApi(
    request,
    {
      scopes: ["members:write"],
      action: "member.bundle.unassign",
      resourceType: "member",
      idempotent: true,
    },
    async (context) => {
      await assertOwnership(id, bundleId, context.organizationId);
      const result = await unassignBundleFromMember(context.organizationId, id, bundleId);
      return {
        data: {
          userId: id,
          bundleId,
          deleted: Boolean(result.assignment),
          affectedEnrollments: result.affectedEnrollments,
        },
        resourceId: id,
      };
    },
  );
}

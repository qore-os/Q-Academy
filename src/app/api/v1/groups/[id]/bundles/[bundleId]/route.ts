import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bundles, groupBundles, groups } from "@/db/schema";
import { assignBundleToGroup, unassignBundleFromGroup } from "@/lib/access";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertOwnership(groupId: string, bundleId: string, organizationId: string) {
  const [[group], [bundle]] = await Promise.all([
    db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.organizationId, organizationId)))
      .limit(1),
    db
      .select({ id: bundles.id })
      .from(bundles)
      .where(and(eq(bundles.id, bundleId), eq(bundles.organizationId, organizationId)))
      .limit(1),
  ]);
  if (!group) throw new ApiError(404, "not_found", "Gruppe nicht gefunden.");
  if (!bundle) throw new ApiError(404, "not_found", "Bundle nicht gefunden.");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; bundleId: string }> },
) {
  const { id, bundleId } = await params;
  return handleApi(
    request,
    { scopes: ["groups:read"], action: "group.bundle.read", resourceType: "group" },
    async (context) => {
      await assertOwnership(id, bundleId, context.organizationId);
      const [assignment] = await db
        .select()
        .from(groupBundles)
        .where(and(eq(groupBundles.groupId, id), eq(groupBundles.bundleId, bundleId)))
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
      scopes: ["groups:write"],
      action: "group.bundle.assign",
      resourceType: "group",
      idempotent: true,
    },
    async (context) => {
      await assertOwnership(id, bundleId, context.organizationId);
      const result = await assignBundleToGroup(context.organizationId, id, bundleId);
      return {
        data: {
          ...result.assignment,
          affectedMembers: result.affectedMembers,
          courses: result.courses,
        },
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
      scopes: ["groups:write"],
      action: "group.bundle.unassign",
      resourceType: "group",
      idempotent: true,
    },
    async (context) => {
      await assertOwnership(id, bundleId, context.organizationId);
      const result = await unassignBundleFromGroup(context.organizationId, id, bundleId);
      return {
        data: {
          groupId: id,
          bundleId,
          deleted: Boolean(result.assignment),
          affectedEnrollments: result.affectedEnrollments,
        },
        resourceId: id,
      };
    },
  );
}

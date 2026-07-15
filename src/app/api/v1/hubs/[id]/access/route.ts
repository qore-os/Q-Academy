import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bundles, groups, hubAccessGrants, hubs, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { hubAccessSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertHub(id: string, organizationId: string) {
  const [hub] = await db.select({ id: hubs.id }).from(hubs).where(and(eq(hubs.id, id), eq(hubs.organizationId, organizationId))).limit(1);
  if (!hub) throw new ApiError(404, "not_found", "Hub nicht gefunden.");
}

async function subjectName(subjectType: "user" | "group" | "bundle", subjectId: string, organizationId: string) {
  if (subjectType === "user") {
    const [subject] = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email }).from(users).where(and(eq(users.id, subjectId), eq(users.organizationId, organizationId))).limit(1);
    return subject ? `${subject.firstName} ${subject.lastName} (${subject.email})` : null;
  }
  if (subjectType === "group") {
    const [subject] = await db.select({ id: groups.id, name: groups.name }).from(groups).where(and(eq(groups.id, subjectId), eq(groups.organizationId, organizationId))).limit(1);
    return subject?.name ?? null;
  }
  const [subject] = await db.select({ id: bundles.id, name: bundles.name }).from(bundles).where(and(eq(bundles.id, subjectId), eq(bundles.organizationId, organizationId))).limit(1);
  return subject?.name ?? null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["hubs:read"], action: "hub.access.list", resourceType: "hub" }, async (context) => {
    await assertHub(id, context.organizationId);
    const grants = await db.select().from(hubAccessGrants).where(eq(hubAccessGrants.hubId, id)).orderBy(asc(hubAccessGrants.createdAt));
    const data = await Promise.all(grants.map(async (grant) => ({ ...grant, subjectName: await subjectName(grant.subjectType as "user" | "group" | "bundle", grant.subjectId, context.organizationId) })));
    return { data, resourceId: id };
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["hubs:write"], action: "hub.access.grant", resourceType: "hub", idempotent: true }, async (context) => {
    await assertHub(id, context.organizationId);
    const input = await parseJson(request, hubAccessSchema);
    const name = await subjectName(input.subjectType, input.subjectId, context.organizationId);
    if (!name) throw new ApiError(404, "not_found", "Zugriffssubjekt nicht gefunden.");
    const [grant] = await db.insert(hubAccessGrants).values({ hubId: id, ...input }).onConflictDoUpdate({ target: [hubAccessGrants.hubId, hubAccessGrants.subjectType, hubAccessGrants.subjectId], set: { createdAt: new Date() } }).returning();
    return { data: { ...grant, subjectName: name }, status: 201, resourceId: id };
  });
}

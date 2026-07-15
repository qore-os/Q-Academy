import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { lessons, moduleSections, modules } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { sectionUpdateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function sectionForOrganization(id: string, organizationId: string) {
  const [section] = await db.select({ section: moduleSections }).from(moduleSections).innerJoin(modules, and(eq(modules.id, moduleSections.moduleId), eq(modules.organizationId, organizationId))).where(eq(moduleSections.id, id)).limit(1);
  if (!section) throw new ApiError(404, "not_found", "Sektion nicht gefunden.");
  return section.section;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:read"], action: "section.read", resourceType: "section" }, async (context) => {
    const section = await sectionForOrganization(id, context.organizationId);
    const sectionLessons = await db.select().from(lessons).where(eq(lessons.sectionId, id)).orderBy(asc(lessons.sortOrder), asc(lessons.id));
    return { data: { ...section, lessons: sectionLessons }, resourceId: id };
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:write"], action: "section.update", resourceType: "section", idempotent: true }, async (context) => {
    await sectionForOrganization(id, context.organizationId);
    const input = await parseJson(request, sectionUpdateSchema);
    const [section] = await db.update(moduleSections).set({ ...input, updatedAt: new Date() }).where(eq(moduleSections.id, id)).returning();
    return { data: section, resourceId: id };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["modules:write"], action: "section.delete", resourceType: "section", idempotent: true }, async (context) => {
    await sectionForOrganization(id, context.organizationId);
    await db.delete(moduleSections).where(eq(moduleSections.id, id));
    return { data: { id, deleted: true }, resourceId: id };
  });
}

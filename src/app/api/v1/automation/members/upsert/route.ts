import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bundles } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { automationMemberUpsertSchema } from "@/lib/commerce/model";
import { upsertAutomationMember } from "@/lib/commerce/service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(request: Request) {
  return handleApi(request, {
    scopes: ["automations:write"],
    action: "automation.member.upsert",
    resourceType: "member",
    idempotent: true,
  }, async (context) => {
    const input = await parseJson(request, automationMemberUpsertSchema);
    if (input.bundleId) {
      const [bundle] = await db.select({ id: bundles.id }).from(bundles).where(and(
        eq(bundles.id, input.bundleId),
        eq(bundles.organizationId, context.organizationId),
        input.bundleAction === "grant" ? eq(bundles.active, true) : undefined,
      )).limit(1);
      if (!bundle) {
        throw new ApiError(
          404,
          "not_found",
          input.bundleAction === "grant"
            ? "Bundle wurde nicht gefunden oder ist inaktiv."
            : "Bundle wurde nicht gefunden.",
        );
      }
    }
    const result = await upsertAutomationMember({
      organizationId: context.organizationId,
      ...input,
    });
    return {
      data: {
        id: result.user.id,
        email: result.user.email,
        status: result.user.status,
        created: result.created,
        bundleId: input.bundleId,
        bundleAction: input.bundleAction,
        bundleAccessChanged: result.bundleAccessChanged,
      },
      status: result.created ? 201 : 200,
      resourceId: result.user.id,
    };
  });
}

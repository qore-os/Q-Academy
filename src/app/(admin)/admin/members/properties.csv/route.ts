import { requireTeamPermission } from "@/lib/auth";
import { exportMemberPropertyCsv } from "@/lib/member-properties";
import { memberPropertyAnalyticsQuerySchema } from "@/lib/member-property-model";
import { getOperationsAdminCopy } from "@/lib/i18n/operations-admin";
import { resolveUserLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

function queryFromUrl(request: Request) {
  const search = new URL(request.url).searchParams;
  const [fieldId, profileDefinitionId] = (search.get("property") ?? "").split(":");
  return memberPropertyAnalyticsQuerySchema.safeParse({
    fieldId: fieldId || undefined,
    profileDefinitionId: profileDefinitionId || undefined,
    operator: search.get("operator") || "is_set",
    value: search.get("value") || undefined,
  });
}

export async function GET(request: Request) {
  const actor = await requireTeamPermission("analytics.view");
  await requireTeamPermission("members.manage");
  const locale = await resolveUserLocale(actor);
  const copy = getOperationsAdminCopy(locale);
  const parsed = queryFromUrl(request);
  if (!parsed.success) {
    return Response.json(
      { detail: copy("member.csv.invalidFilter") },
      { status: 422 },
    );
  }
  const csv = await exportMemberPropertyCsv({
    organizationId: actor.organizationId,
    viewer: actor,
    query: parsed.data,
    locale,
  });
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${copy("member.csv.fileName")}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

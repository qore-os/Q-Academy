import { getAdminAnalyticsData, buildAdminAnalyticsCsv } from "@/lib/admin-analytics";
import { getCurrentUser } from "@/lib/auth";
import { userHasTeamPermission } from "@/lib/team-permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { error: "authentication_required" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  if (!(await userHasTeamPermission(user, "analytics.view"))) {
    return Response.json(
      { error: "forbidden" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  const data = await getAdminAnalyticsData(user.organizationId);
  const csv = buildAdminAnalyticsCsv(data.members);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(`\uFEFF${csv}`, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="q-academy-lerndaten-${date}.csv"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

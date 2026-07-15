import { getCurrentUser, getSession } from "@/lib/auth";
import { publicData, publicProblem } from "@/lib/api/public-auth";
import { getOrganizationDefaultLocale } from "@/lib/i18n/server";
import { effectiveLocale } from "@/lib/i18n/model";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const [user, session] = await Promise.all([getCurrentUser(), getSession()]);
  if (!user || !session) return publicProblem(request, 401, "authentication_required", "Eine aktive Browser-Sitzung ist erforderlich.");
  const defaultLocale = await getOrganizationDefaultLocale(user.organizationId);
  return publicData(request, {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    status: user.status,
    jobTitle: user.jobTitle,
    department: user.department,
    phone: user.phone,
    preferredLocale: user.preferredLocale,
    defaultLocale,
    locale: effectiveLocale({
      preferredLocale: user.preferredLocale,
      defaultLocale,
    }),
    sessionId: session.sessionId,
  });
}

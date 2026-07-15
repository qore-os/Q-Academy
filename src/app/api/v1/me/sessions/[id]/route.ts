import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { userSessions } from "@/db/schema";
import { deleteSession, getCurrentUser, getSession } from "@/lib/auth";
import { assertTrustedOrigin, publicData, publicProblem } from "@/lib/api/public-auth";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertTrustedOrigin(request)) return publicProblem(request, 403, "untrusted_origin", "Der Request-Origin ist nicht erlaubt.");
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return publicProblem(request, 400, "bad_request", "Die Sitzungs-ID ist ungueltig.");
  const [user, currentSession] = await Promise.all([getCurrentUser(), getSession()]);
  if (!user || !currentSession) return publicProblem(request, 401, "authentication_required", "Eine aktive Browser-Sitzung ist erforderlich.");
  const [revoked] = await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.id, id), eq(userSessions.userId, user.id), eq(userSessions.organizationId, user.organizationId), isNull(userSessions.revokedAt)))
    .returning({ id: userSessions.id });
  if (!revoked) return publicProblem(request, 404, "not_found", "Sitzung nicht gefunden.");
  if (id === currentSession.sessionId) await deleteSession();
  return publicData(request, { id, revoked: true });
}

import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { userSessions } from "@/db/schema";
import { getCurrentUser, getSession } from "@/lib/auth";
import { publicData, publicProblem } from "@/lib/api/public-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const [user, currentSession] = await Promise.all([getCurrentUser(), getSession()]);
  if (!user || !currentSession) return publicProblem(request, 401, "authentication_required", "Eine aktive Browser-Sitzung ist erforderlich.");
  const sessions = await db
    .select({ id: userSessions.id, ipAddress: userSessions.ipAddress, userAgent: userSessions.userAgent, lastSeenAt: userSessions.lastSeenAt, expiresAt: userSessions.expiresAt, createdAt: userSessions.createdAt })
    .from(userSessions)
    .where(and(eq(userSessions.userId, user.id), eq(userSessions.organizationId, user.organizationId), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, new Date())))
    .orderBy(desc(userSessions.lastSeenAt));
  return publicData(request, sessions.map((session) => ({ ...session, current: session.id === currentSession.sessionId })));
}

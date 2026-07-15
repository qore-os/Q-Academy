import { deleteSession } from "@/lib/auth";
import { assertTrustedOrigin, publicData, publicProblem } from "@/lib/api/public-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!assertTrustedOrigin(request)) return publicProblem(request, 403, "untrusted_origin", "Der Request-Origin ist nicht erlaubt.");
  await deleteSession();
  return publicData(request, { loggedOut: true });
}

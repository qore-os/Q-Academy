import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  NavigationSearchForbiddenError,
  searchNavigation,
} from "@/lib/navigation-search";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().min(2).max(80),
  mode: z.enum(["admin", "member"]),
});

const responseHeaders = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
};

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { error: "Nicht authentifiziert." },
      { status: 401, headers: responseHeaders },
    );
  }

  const url = new URL(request.url);
  const input = querySchema.safeParse({
    q: url.searchParams.get("q"),
    mode: url.searchParams.get("mode"),
  });
  if (!input.success) {
    return Response.json(
      { error: "Ungueltige Suchanfrage." },
      { status: 400, headers: responseHeaders },
    );
  }

  try {
    const data = await searchNavigation(user, input.data.mode, input.data.q);
    return Response.json({ data }, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof NavigationSearchForbiddenError) {
      return Response.json(
        { error: "Keine Berechtigung fuer diese Suche." },
        { status: 403, headers: responseHeaders },
      );
    }
    throw error;
  }
}

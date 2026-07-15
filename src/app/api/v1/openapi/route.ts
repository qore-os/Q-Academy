import { openApiDocument } from "@/lib/api/openapi";

const cacheControl = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

export function GET() {
  return Response.json(openApiDocument, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Request-Id",
      "Access-Control-Expose-Headers": "Cache-Control, X-Request-Id",
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": crypto.randomUUID(),
    },
  });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Request-Id",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": cacheControl,
      "X-Request-Id": crypto.randomUUID(),
    },
  });
}

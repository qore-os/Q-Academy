import { orbitOpenApiDocument } from "@/lib/orbit/openapi";

export function GET() {
  return Response.json(orbitOpenApiDocument, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}


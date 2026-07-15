import "server-only";

import { timingSafeEqual } from "node:crypto";

import {
  getCronSecret,
  getMetricsSecret,
} from "@/lib/server-environment";

function authorizeBearer(request: Request, expected: string | null) {
  if (!expected) return process.env.NODE_ENV !== "production";
  const authorization = request.headers.get("authorization");
  const provided = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

export function authorizeInternalJobRequest(request: Request) {
  return authorizeBearer(request, getCronSecret());
}

export function authorizeInternalMetricsRequest(request: Request) {
  return authorizeBearer(request, getMetricsSecret());
}

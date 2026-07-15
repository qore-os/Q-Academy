import "server-only";

import { randomUUID } from "node:crypto";
import { trustProxyHeaders } from "@/lib/server-environment";
import { isTrustedMutationOrigin } from "@/lib/trusted-mutation-origin";

export function authRequestId(request: Request) {
  const supplied = request.headers.get("x-request-id");
  return supplied && /^[0-9a-f-]{36}$/i.test(supplied) ? supplied : randomUUID();
}

export function publicData(request: Request, data: unknown, status = 200, meta?: Record<string, unknown>) {
  const requestId = authRequestId(request);
  return Response.json(
    { data, meta: { requestId, timestamp: new Date().toISOString(), ...meta } },
    { status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } },
  );
}

export function publicProblem(request: Request, status: number, code: string, detail: string, errors?: unknown) {
  const requestId = authRequestId(request);
  return Response.json(
    {
      type: `https://q-academy.local/problems/${code}`,
      title: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 429 ? "Too Many Requests" : "Bad Request",
      status,
      detail,
      code,
      instance: new URL(request.url).pathname,
      requestId,
      errors: errors ?? null,
    },
    { status, headers: { "Cache-Control": "no-store", "Content-Type": "application/problem+json", "X-Request-Id": requestId } },
  );
}

export function assertTrustedOrigin(request: Request) {
  return isTrustedMutationOrigin({
    request,
    trustProxyHeaders: trustProxyHeaders(),
  });
}

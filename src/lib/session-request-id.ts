import { randomUUID } from "node:crypto";

const requestIds = new WeakMap<Request, string>();

export function sessionRequestId(request: Request) {
  const cached = requestIds.get(request);
  if (cached) return cached;
  const supplied = request.headers.get("x-request-id");
  const id =
    supplied && /^[0-9a-f-]{36}$/i.test(supplied)
      ? supplied
      : randomUUID();
  requestIds.set(request, id);
  return id;
}

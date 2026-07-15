export const MAX_BOUNDED_JSON_BYTES = 1024 * 1024;

export type BoundedJsonRequestErrorReason =
  | "too_large"
  | "missing_body"
  | "invalid_json"
  | "invalid_content_type"
  | "aborted";

export class BoundedJsonRequestError extends Error {
  constructor(public readonly reason: BoundedJsonRequestErrorReason) {
    super(`Bounded JSON request failed: ${reason}`);
    this.name = "BoundedJsonRequestError";
  }
}

export type BoundedRequestBody = {
  text: string;
  byteLength: number;
  hasBody: boolean;
};

const bodyReadCache = new WeakMap<Request, Promise<BoundedRequestBody>>();

function validateMaxBytes(maxBytes: number) {
  if (
    !Number.isInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_BOUNDED_JSON_BYTES
  ) {
    throw new TypeError(
      `maxBytes must be an integer between 1 and ${MAX_BOUNDED_JSON_BYTES}.`,
    );
  }
}

function assertContentLength(request: Request, maxBytes: number) {
  const contentLength = request.headers.get("content-length");
  if (contentLength === null) return;
  if (!/^\d+$/.test(contentLength)) {
    throw new BoundedJsonRequestError("too_large");
  }
  const declaredBytes = Number(contentLength);
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
    throw new BoundedJsonRequestError("too_large");
  }
}

async function consumeRequestBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedRequestBody> {
  if (!request.body) return { text: "", byteLength: 0, hasBody: false };

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let text = "";
  let completed = false;
  try {
    while (true) {
      if (request.signal.aborted) {
        throw new BoundedJsonRequestError("aborted");
      }
      const chunk = await reader.read();
      if (chunk.done) {
        completed = true;
        break;
      }
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        throw new BoundedJsonRequestError("too_large");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { text, byteLength, hasBody: true };
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) throw error;
    throw new BoundedJsonRequestError("invalid_json");
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function readBoundedRequestBody(
  request: Request,
  options: { maxBytes: number },
): Promise<BoundedRequestBody> {
  validateMaxBytes(options.maxBytes);
  assertContentLength(request, options.maxBytes);

  const cached = bodyReadCache.get(request);
  if (cached) {
    const body = await cached;
    if (body.byteLength > options.maxBytes) {
      throw new BoundedJsonRequestError("too_large");
    }
    return body;
  }

  const body = consumeRequestBody(request, options.maxBytes);
  bodyReadCache.set(request, body);
  return body;
}

export async function parseBoundedJsonRequest(
  request: Request,
  options: { maxBytes: number; requireJsonContentType?: boolean },
): Promise<unknown> {
  if (options.requireJsonContentType) {
    const contentType = request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      throw new BoundedJsonRequestError("invalid_content_type");
    }
  }

  const body = await readBoundedRequestBody(request, options);
  if (!body.hasBody) throw new BoundedJsonRequestError("missing_body");
  try {
    return JSON.parse(body.text);
  } catch {
    throw new BoundedJsonRequestError("invalid_json");
  }
}

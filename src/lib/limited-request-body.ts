export type LimitedRequestTextResult =
  | { ok: true; text: string; byteLength: number }
  | { ok: false; reason: "too_large" };

export async function readLimitedRequestText(
  request: Request,
  maxBytes: number,
): Promise<LimitedRequestTextResult> {
  if (!request.body) return { ok: true, text: "", byteLength: 0 };

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel("request_body_too_large");
        return { ok: false, reason: "too_large" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, text, byteLength };
  } finally {
    reader.releaseLock();
  }
}

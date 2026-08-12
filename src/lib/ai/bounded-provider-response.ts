export class BoundedProviderResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoundedProviderResponseError";
  }
}

export async function readBoundedProviderJson(
  response: Response,
  maximumBytes: number,
) {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > maximumBytes
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new BoundedProviderResponseError(
      "Provider response exceeds the bounded size.",
    );
  }
  if (!response.body) {
    throw new BoundedProviderResponseError("Provider response is empty.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BoundedProviderResponseError(
          "Provider response exceeds the bounded size.",
        );
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new BoundedProviderResponseError(
      "Provider response is invalid JSON.",
    );
  }
}

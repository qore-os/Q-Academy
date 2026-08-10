const S3_BROWSER_PREFLIGHT_DEADLINE_MS = 60_000;

function headerTokens(value: string | null) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function cancelBody(response: Response) {
  await response.body?.cancel().catch(() => undefined);
}

export async function uploadS3MultipartPartLikeBrowser(input: {
  url: string;
  expectedOrigin: string;
  body: Uint8Array;
  checksumSha256: string;
  contentType: string;
}) {
  const target = new URL(input.url);
  if (target.protocol !== "https:") {
    throw new Error("The presigned S3 multipart URL is not HTTPS.");
  }

  const preflight = await fetch(target, {
    method: "OPTIONS",
    redirect: "error",
    signal: AbortSignal.timeout(S3_BROWSER_PREFLIGHT_DEADLINE_MS),
    headers: {
      Origin: input.expectedOrigin,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers":
        "content-type,x-amz-checksum-sha256",
    },
  });
  const allowedMethods = headerTokens(
    preflight.headers.get("access-control-allow-methods"),
  );
  const allowedHeaders = headerTokens(
    preflight.headers.get("access-control-allow-headers"),
  );
  const validPreflight =
    preflight.ok &&
    preflight.headers.get("access-control-allow-origin") ===
      input.expectedOrigin &&
    allowedMethods.has("put") &&
    allowedHeaders.has("content-type") &&
    allowedHeaders.has("x-amz-checksum-sha256") &&
    !allowedMethods.has("*") &&
    !allowedHeaders.has("*");
  await cancelBody(preflight);
  if (!validPreflight) {
    throw new Error("The live S3 browser CORS preflight was rejected.");
  }

  const uploaded = await fetch(target, {
    method: "PUT",
    redirect: "error",
    signal: AbortSignal.timeout(S3_BROWSER_PREFLIGHT_DEADLINE_MS),
    headers: {
      Origin: input.expectedOrigin,
      "Content-Type": input.contentType,
      "X-Amz-Checksum-Sha256": input.checksumSha256,
    },
    body: Buffer.from(input.body),
  });
  const exposedHeaders = headerTokens(
    uploaded.headers.get("access-control-expose-headers"),
  );
  const etag = uploaded.headers.get("etag") ?? undefined;
  const validUpload =
    uploaded.ok &&
    uploaded.headers.get("access-control-allow-origin") ===
      input.expectedOrigin &&
    exposedHeaders.has("etag") &&
    !exposedHeaders.has("*") &&
    etag !== undefined;
  await cancelBody(uploaded);
  if (!validUpload) {
    throw new Error("The live S3 browser multipart PUT was rejected.");
  }
  return { ETag: etag, ChecksumSHA256: input.checksumSha256 };
}

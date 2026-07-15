import { createHash } from "node:crypto";

import {
  assertMediaContentSignature,
  MediaContentInspectionError,
} from "@/lib/media/content-inspection";
import type { ClamAvScanResult } from "@/lib/media/clamav-protocol";
import type { AllowedMediaMimeType } from "@/lib/media/mime-policy";
import { createMediaStructuredContentValidator } from "@/lib/media/structured-content-validation";

const SIGNATURE_SAMPLE_BYTES = 512;

export class MediaContentStreamError extends Error {
  readonly code = "size_mismatch";

  constructor(message: string) {
    super(message);
    this.name = "MediaContentStreamError";
  }
}

type Scanner = (
  body: AsyncIterable<Uint8Array>,
  expectedSizeBytes: number,
) => Promise<ClamAvScanResult>;

export async function inspectAndScanMediaStream(input: {
  body: AsyncIterable<Uint8Array>;
  expectedSizeBytes: number;
  mimeType: AllowedMediaMimeType;
  scanner?: Scanner;
}) {
  const hash = createHash("sha256");
  const signatureChunks: Uint8Array[] = [];
  const pendingChunks: Uint8Array[] = [];
  const sampleSize = Math.min(
    SIGNATURE_SAMPLE_BYTES,
    input.expectedSizeBytes,
  );
  let signatureLength = 0;
  let received = 0;
  let signatureChecked = false;
  const textDecoder =
    input.mimeType === "text/plain" || input.mimeType === "text/csv"
      ? new TextDecoder("utf-8", { fatal: true })
      : null;
  const structuredValidator = createMediaStructuredContentValidator(
    input.mimeType,
    input.expectedSizeBytes,
  );
  let durationMilliseconds: number | null = null;

  const inspectTextChunk = (chunk: Uint8Array, final = false) => {
    if (!textDecoder) return;
    if (
      chunk.some(
        (byte) =>
          byte === 0 ||
          byte === 0x7f ||
          (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d),
      )
    ) {
      throw new MediaContentInspectionError(
        "signature_mismatch",
        "The uploaded text media contains unsafe control bytes.",
      );
    }
    try {
      textDecoder.decode(chunk, { stream: !final });
    } catch {
      throw new MediaContentInspectionError(
        "signature_mismatch",
        "The uploaded text media is not valid UTF-8.",
      );
    }
  };

  const assertSignature = () => {
    if (signatureChecked) return;
    const header = Buffer.concat(
      signatureChunks.map((chunk) => Buffer.from(chunk)),
      signatureLength,
    );
    assertMediaContentSignature(input.mimeType, header);
    signatureChecked = true;
  };

  async function* checkedBody() {
    for await (const sourceChunk of input.body) {
      const chunk = Buffer.from(sourceChunk);
      if (!chunk.byteLength) continue;
      received += chunk.byteLength;
      if (received > input.expectedSizeBytes) {
        throw new MediaContentStreamError(
          "The stored media object exceeds its declared size.",
        );
      }
      hash.update(chunk);
      inspectTextChunk(chunk);
      await structuredValidator?.observe(chunk);

      if (!signatureChecked) {
        pendingChunks.push(chunk);
        const remaining = sampleSize - signatureLength;
        if (remaining > 0) {
          const sample = chunk.subarray(0, Math.min(remaining, chunk.length));
          signatureChunks.push(sample);
          signatureLength += sample.length;
        }
        if (signatureLength >= sampleSize) {
          assertSignature();
          for (const pending of pendingChunks.splice(0)) yield pending;
        }
        continue;
      }
      yield chunk;
    }

    assertSignature();
    for (const pending of pendingChunks.splice(0)) yield pending;
    inspectTextChunk(new Uint8Array(), true);
    if (received !== input.expectedSizeBytes) {
      throw new MediaContentStreamError(
        "The stored media object does not match its declared size.",
      );
    }
    const structuredInspection = await structuredValidator?.finalize();
    durationMilliseconds = structuredInspection?.durationMilliseconds ?? null;
  }

  let scan: ClamAvScanResult = { clean: true, signature: null };
  const body = checkedBody();
  if (input.scanner) {
    scan = await input.scanner(body, input.expectedSizeBytes);
  } else {
    for await (const chunk of body) {
      // Development still consumes and validates the complete immutable body.
      void chunk;
    }
  }

  if (!signatureChecked || received !== input.expectedSizeBytes) {
    throw new MediaContentStreamError(
      "The stored media object could not be fully inspected.",
    );
  }
  return {
    ...scan,
    sha256: hash.digest("hex"),
    scanner: input.scanner ? ("clamav" as const) : ("signature" as const),
    durationMilliseconds,
  };
}

export { MediaContentInspectionError };

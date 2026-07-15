export type HttpByteRange = Readonly<{
  start: number;
  end: number;
}>;

export class InvalidHttpByteRangeError extends Error {
  constructor() {
    super("The requested byte range is invalid or unsatisfiable.");
    this.name = "InvalidHttpByteRangeError";
  }
}

function safeOffset(value: string) {
  if (!/^\d+$/.test(value)) throw new InvalidHttpByteRangeError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new InvalidHttpByteRangeError();
  return parsed;
}

export function parseHttpByteRange(
  value: string | null,
  sizeBytes: number,
): HttpByteRange | null {
  if (!value) return null;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new InvalidHttpByteRangeError();
  }

  const unit = /^bytes=(.+)$/i.exec(value.trim());
  if (!unit) {
    throw new InvalidHttpByteRangeError();
  }
  const candidates = unit[1].split(",");
  if (!candidates.length || candidates.length > 16) {
    throw new InvalidHttpByteRangeError();
  }

  for (const candidate of candidates) {
    const match = /^(\d*)-(\d*)$/.exec(candidate.trim());
    if (!match || (!match[1] && !match[2])) continue;
    const [, startValue, endValue] = match;
    try {
      if (!startValue) {
        const suffixLength = safeOffset(endValue);
        if (suffixLength <= 0) continue;
        return {
          start: Math.max(0, sizeBytes - suffixLength),
          end: sizeBytes - 1,
        };
      }

      const start = safeOffset(startValue);
      if (start >= sizeBytes) continue;
      const requestedEnd = endValue ? safeOffset(endValue) : sizeBytes - 1;
      if (requestedEnd < start) continue;
      return {
        start,
        end: Math.min(requestedEnd, sizeBytes - 1),
      };
    } catch (error) {
      if (!(error instanceof InvalidHttpByteRangeError)) throw error;
    }
  }
  throw new InvalidHttpByteRangeError();
}

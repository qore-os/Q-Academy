import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE32_PATTERN = /^[A-Z2-7]+$/;

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function encodeBase32(value: Uint8Array) {
  let bits = 0;
  let accumulator = 0;
  let output = "";
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(accumulator >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(value: string) {
  const normalized = value.replace(/=+$/g, "").replace(/[\s-]/g, "").toUpperCase();
  if (!normalized || !BASE32_PATTERN.test(normalized)) {
    throw new Error("Invalid Base32 TOTP secret.");
  }
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];
  for (const character of normalized) {
    accumulator = (accumulator << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret() {
  return encodeBase32(randomBytes(20));
}

export function totpForCounter(
  secret: string,
  counter: number,
  digits = TOTP_DIGITS,
) {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error("TOTP counter must be a non-negative safe integer.");
  }
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
    throw new Error("TOTP digits must be between 6 and 8.");
  }
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

export function counterForTime(
  timeMs: number,
  periodSeconds = TOTP_PERIOD_SECONDS,
) {
  if (!Number.isFinite(timeMs) || timeMs < 0) {
    throw new Error("TOTP time must be a non-negative timestamp.");
  }
  return Math.floor(timeMs / (periodSeconds * 1000));
}

function equalCode(candidate: string, expected: string) {
  const left = Buffer.from(candidate, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyTotpCode(input: {
  secret: string;
  code: string;
  now?: number;
  window?: number;
  lastUsedCounter?: number | null;
}) {
  const code = input.code.replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const currentCounter = counterForTime(input.now ?? Date.now());
  const window = input.window ?? 1;
  if (!Number.isInteger(window) || window < 0 || window > 2) {
    throw new Error("TOTP verification window must be between 0 and 2.");
  }
  for (let offset = -window; offset <= window; offset += 1) {
    const counter = currentCounter + offset;
    if (counter < 0 || counter <= (input.lastUsedCounter ?? -1)) continue;
    if (equalCode(code, totpForCounter(input.secret, counter))) return counter;
  }
  return null;
}

export function buildOtpAuthUri(input: {
  secret: string;
  issuer: string;
  accountName: string;
}) {
  const issuer = input.issuer.trim().slice(0, 80);
  const account = input.accountName.trim().slice(0, 255);
  const label = `${issuer}:${account}`;
  const parameters = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${parameters.toString()}`;
}

export function generateRecoveryCodes(count = 10) {
  if (!Number.isInteger(count) || count < 1 || count > 12) {
    throw new Error("Recovery code count must be between 1 and 12.");
  }
  return Array.from({ length: count }, () => {
    const encoded = encodeBase32(randomBytes(10));
    return encoded.match(/.{1,4}/g)!.join("-");
  });
}

export function normalizeRecoveryCode(value: string) {
  return value.normalize("NFKC").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

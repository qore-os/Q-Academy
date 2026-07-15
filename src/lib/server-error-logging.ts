import packageMetadata from "../../package.json";

export type ServerErrorLogContext = {
  action?: string;
  requestId?: string;
};

export type ServerErrorLogEvent = {
  timestamp: string;
  level: "error";
  event: "server.error";
  appVersion: string;
  environment: "development" | "production" | "test" | "unknown";
  runtimeRole: "app" | "media-worker" | "unknown";
  requestId?: string;
  action?: string;
  errorClass: string;
  errorCode?: string;
  errorMessage: string;
};

const MAX_ERROR_MESSAGE_LENGTH = 256;
const MAX_RAW_ERROR_MESSAGE_LENGTH = 4_096;
const MAX_ACTION_LENGTH = 96;
const MAX_REQUEST_ID_LENGTH = 64;

const knownErrorClasses = new Set([
  "AbortError",
  "AggregateError",
  "DOMException",
  "Error",
  "EvalError",
  "PostgresError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TimeoutError",
  "TypeError",
  "URIError",
  "ZodError",
]);
const allowedEnvironments = new Set([
  "development",
  "production",
  "test",
]);
const allowedRuntimeRoles = new Set(["app", "media-worker"]);
const actionPattern = /^[a-z][a-z0-9_.:-]*$/;
const boundedRequestIdPattern = /^[a-z0-9][a-z0-9._:-]*$/i;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidAnywherePattern =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const jwtPattern =
  /\beyJ[a-z0-9_-]{5,}\.[a-z0-9_-]{5,}\.[a-z0-9_-]{5,}\b/gi;
const errorCodePatterns = [
  /^[0-9A-Z]{5}$/,
  /^E[A-Z0-9_]{1,31}$/,
  /^ERR_[A-Z0-9_]{1,48}$/,
  /^UND_ERR_[A-Z0-9_]{1,48}$/,
  /^ABORT_ERR$/,
];

function property(value: unknown, key: string): unknown {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return undefined;
  }
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function safeErrorCode(value: unknown) {
  if (typeof value !== "string") return undefined;
  return errorCodePatterns.some((pattern) => pattern.test(value))
    ? value
    : undefined;
}

function safeErrorClass(error: unknown) {
  const candidate = property(error, "name");
  return typeof candidate === "string" && knownErrorClasses.has(candidate)
    ? candidate
    : "UnknownError";
}

function safeEnvironment(value: string | undefined) {
  return value && allowedEnvironments.has(value)
    ? (value as ServerErrorLogEvent["environment"])
    : "unknown";
}

function safeRuntimeRole(value: string | undefined) {
  const candidate = value?.trim();
  return candidate && allowedRuntimeRoles.has(candidate)
    ? (candidate as ServerErrorLogEvent["runtimeRole"])
    : "unknown";
}

function safeAppVersion(value: string | undefined) {
  const candidate = value?.trim();
  if (!candidate || candidate.length > 68) return "unknown";
  if (
    candidate.length <= 64 &&
    /^v?\d+\.\d+\.\d+(?:[-+][0-9a-z.-]+)?$/i.test(candidate)
  ) {
    return candidate;
  }
  if (/^git-[0-9a-f]{40,64}$/i.test(candidate)) return candidate;
  if (/^[0-9a-f]{7,64}$/i.test(candidate)) return candidate;
  return "unknown";
}

export function configuredAppVersion() {
  const configured = safeAppVersion(
    process.env.Q_ACADEMY_APP_VERSION ??
      process.env.NEXT_PUBLIC_APP_VERSION ??
      process.env.npm_package_version,
  );
  return configured === "unknown"
    ? safeAppVersion(packageMetadata.version)
    : configured;
}

function safeAction(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ACTION_LENGTH ||
    !actionPattern.test(value) ||
    uuidAnywherePattern.test(value) ||
    /(?:^|[._:-])\d{6,}(?:[._:-]|$)/.test(value)
  ) {
    return undefined;
  }
  return value;
}

function safeRequestId(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_REQUEST_ID_LENGTH ||
    (!uuidPattern.test(value) && !boundedRequestIdPattern.test(value))
  ) {
    return undefined;
  }
  if (
    /(?:bearer|password|secret|token|api[_-]?key|authorization|cookie|session)/i.test(
      value,
    ) ||
    /^eyJ[a-z0-9_-]*\.[a-z0-9_-]+\.[a-z0-9_-]+$/i.test(value)
  ) {
    return undefined;
  }
  return value;
}

function rawErrorMessage(error: unknown) {
  const message = property(error, "message");
  if (typeof message === "string") return message;
  if (typeof error === "string") return error;
  return "No error message available";
}

export function redactServerErrorMessage(value: string) {
  // Only the first line can be a message. Following lines commonly contain a stack.
  let message = value.slice(0, MAX_RAW_ERROR_MESSAGE_LENGTH).split(/\r?\n/, 1)[0];
  message = message
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[\u0080-\uffff]/g, "?")
    .replace(
      /\b[a-z][a-z0-9+.-]{1,31}:(?:\/\/)?[^\s"'<>]+/gi,
      "[redacted-url]",
    )
    .replace(/\bwww\.[^\s"'<>]+/gi, "[redacted-url]")
    .replace(jwtPattern, "[redacted-token]")
    .replace(/[^\s<>"']{1,128}@[^\s<>"']{1,255}/g, "[redacted-email]")
    .replace(
      /\b[a-z0-9._%+-]+@[a-z0-9.-]+\b/gi,
      "[redacted-email]",
    )
    .replace(
      /\b(?:[a-z0-9-]+\.)+(?:app|com|de|dev|io|local|net|org|test)(?::\d{1,5})?(?:\/[^\s"'<>]*)?/gi,
      "[redacted-url]",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[redacted-id]",
    )
    .replace(
      /\b(?:tenant|organization|org|user|member|account)[_. -]?id\s*[:=#]?\s*[a-z0-9._:-]+/gi,
      "[redacted-id]",
    )
    .replace(
      /\b(?:tenant|organization|org|user|member|account)\s*[:=#]\s*[a-z0-9._:-]+/gi,
      "[redacted-id]",
    )
    .replace(
      /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/gi,
      "[redacted-secret]",
    )
    .replace(
      /\b(?:qak_(?:live|test)|sk_(?:live|test)|sk-(?:proj-)?|gh[pousr]_|xox[baprs]-)[a-z0-9._-]+/gi,
      "[redacted-secret]",
    )
    .replace(
      /\b(?:password|passwd|secret|token|api[_. -]?key|authorization|cookie|session)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "[redacted-secret]",
    )
    .replace(
      /\b[a-z0-9_-]*(?:secret|password|token)[a-z0-9_-]*\b/gi,
      "[redacted-secret]",
    )
    .replace(
      /\b[a-z][a-z0-9_.-]{0,31}\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "[redacted-value]",
    )
    .replace(/(["'])[^"']+\1/g, "[redacted-value]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted-address]")
    .replace(/\b[a-f0-9]{16,}\b/gi, "[redacted-token]")
    .replace(/\b[a-z0-9_+/=-]{24,}\b/gi, "[redacted-token]")
    .replace(/\b\d{6,}\b/g, "[redacted-id]")
    .replace(/[a-z]:\\(?:[^\\\s]+\\)+[^\\\s]*/gi, "[redacted-path]")
    .replace(/\/(?:[a-z0-9._-]+\/)+[a-z0-9._-]+/gi, "[redacted-path]")
    .replace(/\s+/g, " ")
    .trim();

  if (!message) return "No error message available";
  if (message.length <= MAX_ERROR_MESSAGE_LENGTH) return message;
  return `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH - 3).trimEnd()}...`;
}

export function formatServerErrorForLog(
  error: unknown,
  context: ServerErrorLogContext = {},
  nodeEnvironment: string | undefined = process.env.NODE_ENV,
  now = new Date(),
): ServerErrorLogEvent {
  const action = safeAction(context.action);
  const requestId = safeRequestId(context.requestId);
  const errorCode =
    safeErrorCode(property(error, "code")) ??
    safeErrorCode(property(property(error, "cause"), "code"));

  return {
    timestamp: now.toISOString(),
    level: "error",
    event: "server.error",
    appVersion: configuredAppVersion(),
    environment: safeEnvironment(nodeEnvironment),
    runtimeRole: safeRuntimeRole(process.env.Q_ACADEMY_RUNTIME_ROLE),
    ...(requestId ? { requestId } : {}),
    ...(action ? { action } : {}),
    errorClass: safeErrorClass(error),
    ...(errorCode ? { errorCode } : {}),
    errorMessage: redactServerErrorMessage(rawErrorMessage(error)),
  };
}

export function logServerError(
  error: unknown,
  context: ServerErrorLogContext = {},
) {
  console.error(JSON.stringify(formatServerErrorForLog(error, context)));
}

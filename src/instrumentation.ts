import type { Instrumentation } from "next";

import { logServerError } from "@/lib/server-error-logging";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertRuntimeServerEnvironment } = await import(
    "@/lib/server-environment"
  );
  assertRuntimeServerEnvironment();
}

function methodClass(method: string) {
  const normalized = method.toUpperCase();
  if (normalized === "GET" || normalized === "HEAD") return "read";
  if (
    normalized === "POST" ||
    normalized === "PUT" ||
    normalized === "PATCH" ||
    normalized === "DELETE"
  ) {
    return "write";
  }
  if (normalized === "OPTIONS") return "preflight";
  return "other";
}

function routeCategory(
  routePath: string,
  routeType: "render" | "route" | "action" | "proxy",
) {
  if (routeType === "action") return "action";
  if (routeType === "proxy") return "proxy";

  const normalized = routePath.toLowerCase();
  if (routeType === "route") {
    if (normalized.includes("/health/")) return "health";
    if (
      normalized.includes("/auth/") ||
      normalized.includes("/oidc/") ||
      normalized.includes("/password/")
    ) {
      return "auth";
    }
    if (normalized.includes("/internal/")) return "internal_api";
    if (normalized.includes("/admin/")) return "admin_api";
    if (normalized.includes("/media")) return "media_api";
    return "api";
  }

  if (normalized.includes("(admin)") || normalized.includes("/admin/")) {
    return "admin_page";
  }
  if (normalized.includes("(academy)")) return "academy_page";
  if (
    normalized.includes("/login") ||
    normalized.includes("/password") ||
    normalized.includes("/oidc")
  ) {
    return "auth_page";
  }
  return "page";
}

function requestIdFromHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
) {
  const value = headers["x-request-id"];
  return typeof value === "string"
    ? value
    : Array.isArray(value) && value.length === 1
      ? value[0]
      : undefined;
}

export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  const category = routeCategory(context.routePath, context.routeType);
  const requestMethodClass = methodClass(request.method);
  logServerError(error, {
    action: `next.request_error.${category}.${requestMethodClass}`,
    requestId: requestIdFromHeaders(request.headers),
  });
};

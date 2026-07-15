import "server-only";

import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import type { CustomFetch, FetchBody } from "openid-client";
import { resolveSafeWebhookTarget } from "@/lib/api/webhook-security";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

async function requestBodyBuffer(body: FetchBody) {
  if (body == null) return null;
  let buffer: Buffer;
  if (typeof body === "string") buffer = Buffer.from(body, "utf8");
  else if (body instanceof URLSearchParams)
    buffer = Buffer.from(body.toString(), "utf8");
  else if (body instanceof Uint8Array) buffer = Buffer.from(body);
  else if (body instanceof ArrayBuffer) buffer = Buffer.from(body);
  else {
    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error("Die OIDC-Anfrage ist zu gross.");
      }
      chunks.push(Buffer.from(chunk.value));
    }
    buffer = Buffer.concat(chunks, size);
  }
  if (buffer.byteLength > MAX_REQUEST_BYTES) {
    throw new Error("Die OIDC-Anfrage ist zu gross.");
  }
  return buffer;
}

export const oidcCustomFetch: CustomFetch = async (value, options) => {
  let target;
  try {
    target = await resolveSafeWebhookTarget(value);
  } catch {
    throw new Error("Der OIDC-Endpunkt ist nicht sicher erreichbar.");
  }
  const selected = target.addresses[0];
  if (!selected) throw new Error("Der OIDC-Endpunkt ist nicht erreichbar.");
  const body = await requestBodyBuffer(options.body);
  const transport = target.url.protocol === "https:" ? requestHttps : requestHttp;

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    let receivedBytes = 0;
    const chunks: Buffer[] = [];
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      callback();
    };
    const request = transport(
      {
        protocol: target.url.protocol,
        hostname: target.url.hostname,
        port: target.url.port || undefined,
        method: options.method,
        path: `${target.url.pathname}${target.url.search}`,
        headers: {
          ...options.headers,
          ...(body && !Object.keys(options.headers).some(
            (name) => name.toLowerCase() === "content-length",
          )
            ? { "content-length": String(body.byteLength) }
            : {}),
        },
        ...(target.url.protocol === "https:" && isIP(target.url.hostname) === 0
          ? { servername: target.url.hostname }
          : {}),
        lookup: (_hostname, lookupOptions, callback) => {
          if (lookupOptions.all) {
            callback(null, [selected]);
            return;
          }
          callback(null, selected.address, selected.family);
        },
      },
      (response) => {
        const declaredLength = Number(response.headers["content-length"] ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
          const error = new Error("Die OIDC-Antwort ist zu gross.");
          response.destroy(error);
          settle(() => reject(error));
          return;
        }
        response.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.byteLength;
          if (receivedBytes > MAX_RESPONSE_BYTES) {
            response.destroy(new Error("Die OIDC-Antwort ist zu gross."));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.on("end", () => {
          if (receivedBytes > MAX_RESPONSE_BYTES) {
            settle(() => reject(new Error("Die OIDC-Antwort ist zu gross.")));
            return;
          }
          const headers = new Headers();
          for (const [name, rawValue] of Object.entries(response.headers)) {
            if (Array.isArray(rawValue)) {
              for (const entry of rawValue) headers.append(name, entry);
            } else if (rawValue !== undefined) {
              headers.set(name, String(rawValue));
            }
          }
          settle(() =>
            resolve(
              new Response(Buffer.concat(chunks, receivedBytes), {
                status: response.statusCode ?? 500,
                statusText: response.statusMessage,
                headers,
              }),
            ),
          );
        });
        response.on("aborted", () =>
          settle(() => reject(new Error("Die OIDC-Antwort wurde abgebrochen."))),
        );
        response.on("error", (error) => settle(() => reject(error)));
      },
    );
    const abort = () => {
      const error = new Error("Die OIDC-Anfrage wurde abgebrochen.");
      request.destroy(error);
      settle(() => reject(error));
    };
    const timeout = setTimeout(() => {
      const error = new Error("Das OIDC-Zeitlimit wurde ueberschritten.");
      request.destroy(error);
      settle(() => reject(error));
    }, REQUEST_TIMEOUT_MS);
    options.signal?.addEventListener("abort", abort, { once: true });
    request.on("error", (error) => settle(() => reject(error)));
    if (options.signal?.aborted) {
      abort();
      return;
    }
    request.end(body ?? undefined);
  });
};

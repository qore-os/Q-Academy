import "server-only";

import { connect as connectHttp2, constants as http2Constants } from "node:http2";
import { importPKCS8, SignJWT } from "jose";

import { resolveNativePushProviderConfiguration } from "@/lib/push/native-provider-config";

export type NativePushMessage = Readonly<{
  notificationId: string;
  title: string;
  body: string;
  href: string;
}>;

export type NativePushResult = Readonly<{
  status: number | null;
  delivered: boolean;
  permanent: boolean;
  expired: boolean;
  detail: string;
}>;

let fcmAccessTokenCache:
  | { identity: string; token: string; expiresAt: number }
  | undefined;
let apnsJwtCache:
  | { identity: string; token: string; expiresAt: number }
  | undefined;

function bounded(value: string, limit: number) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function result(
  status: number | null,
  detail: string,
  expiredStatuses: readonly number[] = [],
): NativePushResult {
  const delivered = status !== null && status >= 200 && status < 300;
  const expired = status !== null && expiredStatuses.includes(status);
  return {
    status,
    delivered,
    expired,
    permanent:
      expired ||
      (status !== null && [400, 401, 403, 404, 405, 410, 413].includes(status)),
    detail: bounded(detail, 240) || (delivered ? "Zugestellt" : "Nicht erreichbar"),
  };
}

async function fcmAccessToken(configuration: {
  clientEmail: string;
  privateKey: string;
}) {
  const identity = `${configuration.clientEmail}:${configuration.privateKey.slice(-32)}`;
  if (
    fcmAccessTokenCache?.identity === identity &&
    fcmAccessTokenCache.expiresAt > Date.now() + 60_000
  ) {
    return fcmAccessTokenCache.token;
  }
  const now = Math.floor(Date.now() / 1_000);
  const key = await importPKCS8(configuration.privateKey, "RS256");
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(configuration.clientEmail)
    .setSubject(configuration.clientEmail)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3_600)
    .sign(key);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => null)) as {
    access_token?: unknown;
    expires_in?: unknown;
  } | null;
  if (
    !response.ok ||
    typeof payload?.access_token !== "string" ||
    !payload.access_token ||
    typeof payload.expires_in !== "number"
  ) {
    throw new Error("FCM authentication failed.");
  }
  fcmAccessTokenCache = {
    identity,
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60, payload.expires_in) * 1_000,
  };
  return payload.access_token;
}

async function deliverFcm(token: string, message: NativePushMessage) {
  const configuration = resolveNativePushProviderConfiguration().android;
  if (!configuration) return result(null, "FCM ist nicht konfiguriert.");
  try {
    const accessToken = await fcmAccessToken(configuration);
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${configuration.projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: {
              title: bounded(message.title, 180),
              body: bounded(message.body, 500),
            },
            data: {
              notificationId: message.notificationId,
              href: message.href,
            },
            android: {
              priority: "normal",
              notification: { channel_id: "academy_updates" },
            },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const body = await response.text();
    const unregistered = /UNREGISTERED|registration-token-not-registered/i.test(body);
    return result(
      unregistered ? 410 : response.status,
      response.ok ? "FCM zugestellt." : `FCM HTTP ${response.status}.`,
      [410],
    );
  } catch {
    return result(null, "FCM war nicht erreichbar.");
  }
}

async function apnsJwt(configuration: {
  teamId: string;
  keyId: string;
  privateKey: string;
}) {
  const identity = `${configuration.teamId}:${configuration.keyId}:${configuration.privateKey.slice(-32)}`;
  if (
    apnsJwtCache?.identity === identity &&
    apnsJwtCache.expiresAt > Date.now() + 60_000
  ) {
    return apnsJwtCache.token;
  }
  const now = Math.floor(Date.now() / 1_000);
  const key = await importPKCS8(configuration.privateKey, "ES256");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: configuration.keyId })
    .setIssuer(configuration.teamId)
    .setIssuedAt(now)
    .sign(key);
  apnsJwtCache = {
    identity,
    token,
    expiresAt: Date.now() + 50 * 60_000,
  };
  return token;
}

async function apnsRequest(input: {
  origin: string;
  path: string;
  authorization: string;
  topic: string;
  collapseId: string;
  body: string;
}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const client = connectHttp2(input.origin);
    const timeout = setTimeout(() => {
      client.destroy(new Error("APNs request timed out."));
    }, 10_000);
    client.once("error", reject);
    const request = client.request({
      [http2Constants.HTTP2_HEADER_METHOD]: "POST",
      [http2Constants.HTTP2_HEADER_PATH]: input.path,
      authorization: `bearer ${input.authorization}`,
      "apns-topic": input.topic,
      "apns-push-type": "alert",
      "apns-priority": "5",
      "apns-expiration": String(Math.floor(Date.now() / 1_000) + 86_400),
      "apns-collapse-id": input.collapseId,
      "content-type": "application/json",
    });
    let status = 0;
    let body = "";
    request.setEncoding("utf8");
    request.on("response", (headers) => {
      status = Number(headers[http2Constants.HTTP2_HEADER_STATUS] ?? 0);
    });
    request.on("data", (chunk: string) => {
      if (body.length < 4_096) body += chunk.slice(0, 4_096 - body.length);
    });
    request.once("error", reject);
    request.once("end", () => {
      clearTimeout(timeout);
      client.close();
      resolve({ status, body });
    });
    request.end(input.body);
  });
}

async function deliverApns(token: string, message: NativePushMessage) {
  const configuration = resolveNativePushProviderConfiguration().ios;
  if (!configuration) return result(null, "APNs ist nicht konfiguriert.");
  try {
    const authorization = await apnsJwt(configuration);
    const response = await apnsRequest({
      origin: configuration.production
        ? "https://api.push.apple.com"
        : "https://api.sandbox.push.apple.com",
      path: `/3/device/${token.toLowerCase()}`,
      authorization,
      topic: configuration.bundleId,
      collapseId: message.notificationId.replaceAll("-", "").slice(0, 64),
      body: JSON.stringify({
        aps: {
          alert: {
            title: bounded(message.title, 180),
            body: bounded(message.body, 500),
          },
          sound: "default",
          "thread-id": "academy_updates",
        },
        notificationId: message.notificationId,
        href: message.href,
      }),
    });
    const expired =
      response.status === 410 || /BadDeviceToken|Unregistered/i.test(response.body);
    return result(
      expired ? 410 : response.status,
      response.status === 200 ? "APNs zugestellt." : `APNs HTTP ${response.status}.`,
      [410],
    );
  } catch {
    return result(null, "APNs war nicht erreichbar.");
  }
}

export async function deliverNativePush(input: {
  platform: "ios" | "android";
  token: string;
  message: NativePushMessage;
}) {
  return input.platform === "ios"
    ? deliverApns(input.token, input.message)
    : deliverFcm(input.token, input.message);
}

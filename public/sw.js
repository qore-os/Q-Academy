const CACHE_PREFIX = "q-academy-public-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const OFFLINE_URL = "/offline.html";
const VERSIONED_PUBLIC_ASSETS = new Set([
  "/pwa/q-academy-v1-192.svg",
  "/pwa/q-academy-v1-512.svg",
]);
const PRECACHE_URLS = [OFFLINE_URL, ...VERSIONED_PUBLIC_ASSETS];
const DEFAULT_PUSH_ICON = "/pwa/q-academy-v1-192.svg";
const DEFAULT_PUSH_TITLE = "Q-Academy";
const DEFAULT_PUSH_BODY = "Eine neue Benachrichtigung ist eingegangen.";

function anonymousRequest(url, cache = "no-cache") {
  return new Request(url, {
    method: "GET",
    credentials: "omit",
    cache,
    redirect: "follow",
  });
}

function isNextStaticCandidate(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
}

function isImmutableResponse(response) {
  return /(?:^|,)\s*immutable(?:,|$)/i.test(response.headers.get("cache-control") || "");
}

async function putPublicResponse(cache, request, response) {
  const headers = new Headers();
  for (const name of ["cache-control", "content-language", "content-type", "etag", "last-modified"]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }

  const sanitizedResponse = new Response(await response.clone().arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  await cache.put(request, sanitizedResponse);
}

async function precachePublicResources() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    PRECACHE_URLS.map(async (path) => {
      const request = anonymousRequest(new URL(path, self.location.origin), "reload");
      const response = await fetch(request);
      if (!response.ok || response.type !== "basic") {
        throw new Error(`Precache failed for ${path}`);
      }
      await putPublicResponse(cache, request, response);
    }),
  );
}

async function versionedAssetResponse(url) {
  const cache = await caches.open(CACHE_NAME);
  const request = anonymousRequest(url);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  const isVersionedPublicAsset = VERSIONED_PUBLIC_ASSETS.has(url.pathname);
  if (
    response.ok &&
    response.type === "basic" &&
    (isVersionedPublicAsset || isImmutableResponse(response))
  ) {
    await putPublicResponse(cache, request, response);
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(precachePublicResources().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (
          (await cache.match(anonymousRequest(new URL(OFFLINE_URL, self.location.origin)))) ||
          Response.error()
        );
      }),
    );
    return;
  }

  if (VERSIONED_PUBLIC_ASSETS.has(url.pathname) || isNextStaticCandidate(url)) {
    event.respondWith(versionedAssetResponse(url));
  }
});

function boundedPushText(value, fallback, maximumLength) {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return normalized ? normalized.slice(0, maximumLength) : fallback;
}

function sameOriginPushHref(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/academy";
  }
  try {
    const target = new URL(value, self.location.origin);
    return target.origin === self.location.origin
      ? `${target.pathname}${target.search}${target.hash}`
      : "/academy";
  } catch {
    return "/academy";
  }
}

function pushNotificationPayload(event) {
  let input = {};
  try {
    input = event.data?.json() ?? {};
  } catch {
    input = {};
  }
  const href = sameOriginPushHref(input.href);
  const notificationId = boundedPushText(input.notificationId, "", 64);
  return {
    title: boundedPushText(input.title, DEFAULT_PUSH_TITLE, 180),
    options: {
      body: boundedPushText(input.body, DEFAULT_PUSH_BODY, 500),
      icon: DEFAULT_PUSH_ICON,
      badge: DEFAULT_PUSH_ICON,
      tag: notificationId ? `notification:${notificationId}` : undefined,
      data: { href },
    },
  };
}

self.addEventListener("push", (event) => {
  const payload = pushNotificationPayload(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, payload.options),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = sameOriginPushHref(event.notification.data?.href);
  const targetUrl = new URL(href, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate(targetUrl);
        return;
      }
      await self.clients.openWindow(targetUrl);
    }),
  );
});

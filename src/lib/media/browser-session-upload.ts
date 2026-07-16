"use client";

import { browserUploadHeaders } from "@/lib/media/browser-upload";

type MediaAssetStatus =
  | "pending"
  | "uploaded"
  | "scanning"
  | "ready"
  | "quarantined"
  | "failed";

export type BrowserSessionMediaAsset = {
  id: string;
  purpose:
    | "submission"
    | "course_content"
    | "community"
    | "avatar"
    | "branding"
    | "profile";
  kind: "image" | "audio" | "video" | "document";
  status: MediaAssetStatus;
  originalFileName: string;
  safeFileName: string;
  declaredMimeType: string;
  declaredSizeBytes: number;
  actualSizeBytes: number | null;
  durationMilliseconds: number | null;
};

type UploadIntent = BrowserSessionMediaAsset & {
  statusUrl: string;
  completeUrl: string | null;
  upload: {
    transport: "s3" | "application";
    method: "PUT" | "POST";
    url: string;
    headers?: Record<string, string>;
    fields?: Record<string, string>;
  } | null;
};

export type BrowserSessionUploadStage =
  | "preparing"
  | "uploading"
  | "processing";

async function responseData<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | { data?: T; detail?: string }
    | null;
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.detail ?? "Die Datei konnte nicht verarbeitet werden.");
  }
  return payload.data;
}

function uploadFile(
  file: File,
  authorization: NonNullable<UploadIntent["upload"]>,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const target = new URL(authorization.url, window.location.origin);
    if (!["http:", "https:"].includes(target.protocol)) {
      reject(new Error("Die Upload-Adresse ist ungültig."));
      return;
    }
    xhr.open(authorization.method, target.href);
    if (authorization.method === "PUT") {
      for (const [name, value] of Object.entries(
        browserUploadHeaders(authorization.headers ?? {}),
      )) {
        xhr.setRequestHeader(name, value);
      }
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(
            Math.min(100, Math.round((event.loaded / event.total) * 100)),
          );
        }
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      }
      else reject(new Error("Der Datei-Upload wurde vom Speicher abgelehnt."));
    };
    xhr.onerror = () => reject(new Error("Der Datei-Upload ist fehlgeschlagen."));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    if (authorization.method === "POST") {
      if (!authorization.fields) {
        reject(new Error("Die Upload-Felder fehlen."));
        return;
      }
      const form = new FormData();
      for (const [name, value] of Object.entries(authorization.fields)) {
        form.append(name, value);
      }
      form.append("file", file);
      onProgress(0);
      // Do not attach an upload-progress listener or custom request headers:
      // either would turn this multipart POST into a CORS-preflight request,
      // which STRATO HiDrive Object Storage does not answer correctly.
      xhr.send(form);
      return;
    }
    xhr.send(file);
  });
}

function wait(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, delay);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Polling aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function sessionDataWithRetry<T>(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        credentials: "same-origin",
        signal,
      });
      const retryable =
        response.status === 429 ||
        (response.status >= 500 && response.status <= 599);
      if (!retryable || attempt === 3) return responseData<T>(response);
      await response.body?.cancel().catch(() => undefined);
      const retryAfter = Number(response.headers.get("retry-after"));
      await wait(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1_000, 10_000)
          : 500 * 2 ** attempt,
        signal,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      lastError = error;
      if (attempt === 3) throw error;
      await wait(500 * 2 ** attempt, signal);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Die Media-Anfrage ist fehlgeschlagen.");
}

export async function uploadBrowserSessionMedia(input: {
  file: File;
  purpose: BrowserSessionMediaAsset["purpose"];
  clientUploadId: string;
  signal: AbortSignal;
  onProgress?: (progress: number) => void;
  onStage?: (stage: BrowserSessionUploadStage) => void;
  onAssetCreated?: (asset: BrowserSessionMediaAsset) => void;
  ownerUserId?: string;
}) {
  input.onStage?.("preparing");
  const intent = await sessionDataWithRetry<UploadIntent>(
    "/api/media-assets",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        purpose: input.purpose,
        clientUploadId: input.clientUploadId,
        originalFileName: input.file.name,
        declaredMimeType: input.file.type,
        sizeBytes: input.file.size,
        ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
      }),
    },
    input.signal,
  );
  input.onAssetCreated?.(intent);

  if (intent.upload) {
    input.onStage?.("uploading");
    let recovered = false;
    try {
      await uploadFile(input.file, intent.upload, input.signal, (progress) =>
        input.onProgress?.(progress),
      );
    } catch (uploadError) {
      if (intent.completeUrl) {
        await sessionDataWithRetry(
          intent.completeUrl,
          { method: "POST" },
          input.signal,
        );
        recovered = true;
      } else {
        const status = await sessionDataWithRetry<BrowserSessionMediaAsset>(
          intent.statusUrl,
          { method: "GET", cache: "no-store" },
          input.signal,
        ).catch(() => null);
        if (!status || !["uploaded", "scanning", "ready"].includes(status.status)) {
          throw uploadError;
        }
        recovered = true;
      }
    }
    if (intent.completeUrl && !recovered) {
      await sessionDataWithRetry(
        intent.completeUrl,
        { method: "POST" },
        input.signal,
      );
    }
  }

  input.onStage?.("processing");
  input.onProgress?.(100);
  const deadline = Date.now() + 15 * 60_000;
  let pollDelay = 1_000;
  let transientFailures = 0;
  while (!input.signal.aborted && Date.now() < deadline) {
    let response: Response;
    try {
      response = await fetch(intent.statusUrl, {
        credentials: "same-origin",
        cache: "no-store",
        signal: input.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      transientFailures += 1;
      if (transientFailures > 8) {
        throw new Error("Der Scanstatus ist vorübergehend nicht erreichbar.");
      }
      await wait(pollDelay, input.signal);
      pollDelay = Math.min(5_000, pollDelay + 1_000);
      continue;
    }
    if (
      response.status === 429 ||
      (response.status >= 500 && response.status <= 599)
    ) {
      transientFailures += 1;
      if (transientFailures > 8) {
        throw new Error("Der Scanstatus ist vorübergehend nicht erreichbar.");
      }
      await response.body?.cancel().catch(() => undefined);
      const retryAfter = Number(response.headers.get("retry-after"));
      await wait(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1_000, 15_000)
          : pollDelay,
        input.signal,
      );
      pollDelay = Math.min(5_000, pollDelay + 1_000);
      continue;
    }
    const status = await responseData<BrowserSessionMediaAsset>(response);
    transientFailures = 0;
    if (status.status === "ready") return status;
    if (status.status === "quarantined") {
      throw new Error("Die Sicherheitsprüfung hat die Datei abgelehnt.");
    }
    if (status.status === "failed") {
      throw new Error("Die Sicherheitsprüfung konnte nicht abgeschlossen werden.");
    }
    await wait(pollDelay, input.signal);
    pollDelay = Math.min(5_000, pollDelay + 1_000);
  }
  input.signal.throwIfAborted();
  throw new Error("Die Sicherheitsprüfung hat zu lange gedauert.");
}

export async function deleteBrowserSessionMediaAsset(
  assetId: string,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/media-assets/${assetId}`, {
    method: "DELETE",
    credentials: "same-origin",
    signal,
  });
  if (response.status === 404) return;
  await responseData(response);
}

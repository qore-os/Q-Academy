"use client";

import { browserUploadHeaders } from "@/lib/media/browser-upload";

type MediaAssetStatus =
  "pending" | "uploaded" | "scanning" | "ready" | "quarantined" | "failed";

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
  completionPending?: boolean;
  upload:
    | {
        transport: "s3" | "application";
        method: "PUT" | "POST";
        url: string;
        headers?: Record<string, string>;
        fields?: Record<string, string>;
      }
    | {
        transport: "s3-multipart";
        statusUrl: string;
        partsUrl: string;
        partSizeBytes: number;
        partCount: number;
        concurrency: number;
      }
    | null;
};

class SessionMediaRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string | undefined,
    readonly retryAfterSeconds: number | undefined,
  ) {
    super(message);
    this.name = "SessionMediaRequestError";
  }
}

type MultipartUploadStatus = {
  partSizeBytes: number;
  partCount: number;
  uploadedParts: Array<{ partNumber: number; sizeBytes: number }>;
};

type MultipartPartAuthorization = {
  partNumber: number;
  sizeBytes: number;
  method: "PUT";
  url: string;
  headers: Record<string, string>;
};

export type BrowserSessionUploadStage =
  "preparing" | "uploading" | "processing";

const MAX_ACTIVE_MULTIPART_PARTS = 3;
const SINGLE_UPLOAD_TIMEOUT_MS = 6 * 60 * 60_000;
const MULTIPART_PART_STALL_TIMEOUT_MS = 5 * 60_000;
type MultipartSlotRelease = () => void;
type PendingMultipartSlot = {
  signal: AbortSignal;
  resolve: (release: MultipartSlotRelease) => void;
  reject: (error: unknown) => void;
  onAbort: () => void;
};
let activeMultipartParts = 0;
const pendingMultipartSlots: PendingMultipartSlot[] = [];

function drainMultipartSlots() {
  while (
    activeMultipartParts < MAX_ACTIVE_MULTIPART_PARTS &&
    pendingMultipartSlots.length > 0
  ) {
    const pending = pendingMultipartSlots.shift();
    if (!pending) return;
    pending.signal.removeEventListener("abort", pending.onAbort);
    if (pending.signal.aborted) {
      pending.reject(new DOMException("Upload aborted", "AbortError"));
      continue;
    }
    activeMultipartParts += 1;
    let released = false;
    pending.resolve(() => {
      if (released) return;
      released = true;
      activeMultipartParts -= 1;
      drainMultipartSlots();
    });
  }
}

function acquireMultipartSlot(signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.reject<MultipartSlotRelease>(
      new DOMException("Upload aborted", "AbortError"),
    );
  }
  return new Promise<MultipartSlotRelease>((resolve, reject) => {
    const pending: PendingMultipartSlot = {
      signal,
      resolve,
      reject,
      onAbort: () => undefined,
    };
    pending.onAbort = () => {
      const index = pendingMultipartSlots.indexOf(pending);
      if (index >= 0) pendingMultipartSlots.splice(index, 1);
      reject(new DOMException("Upload aborted", "AbortError"));
    };
    signal.addEventListener("abort", pending.onAbort, { once: true });
    pendingMultipartSlots.push(pending);
    drainMultipartSlots();
  });
}

async function responseData<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    detail?: string;
    errors?: unknown;
  } | null;
  if (!response.ok) {
    const details =
      payload?.errors && typeof payload.errors === "object"
        ? (payload.errors as Record<string, unknown>)
        : null;
    const retryAfterHeader = Number(response.headers.get("retry-after"));
    const retryAfterDetail = Number(details?.retryAfterSeconds);
    throw new SessionMediaRequestError(
      payload?.detail ?? "Die Datei konnte nicht verarbeitet werden.",
      response.status,
      typeof details?.reason === "string" ? details.reason : undefined,
      Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? retryAfterHeader
        : Number.isFinite(retryAfterDetail) && retryAfterDetail > 0
          ? retryAfterDetail
          : undefined,
    );
  }
  if (!payload || !("data" in payload)) {
    throw new SessionMediaRequestError(
      "Die Datei konnte nicht verarbeitet werden.",
      response.status,
      undefined,
      undefined,
    );
  }
  return payload.data as T;
}

function uploadFile(
  file: File,
  authorization: Extract<
    NonNullable<UploadIntent["upload"]>,
    { transport: "s3" | "application" }
  >,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Upload aborted", "AbortError"));
      return;
    }
    if (authorization.method === "POST" && !authorization.fields) {
      reject(new Error("Die Upload-Felder fehlen."));
      return;
    }
    const xhr = new XMLHttpRequest();
    const target = new URL(authorization.url, window.location.origin);
    if (!["http:", "https:"].includes(target.protocol)) {
      reject(new Error("Die Upload-Adresse ist ungültig."));
      return;
    }
    xhr.open(authorization.method, target.href);
    xhr.timeout = SINGLE_UPLOAD_TIMEOUT_MS;
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
    const abort = () => xhr.abort();
    const cleanup = () => signal.removeEventListener("abort", abort);
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else
        reject(new Error("Der Datei-Upload wurde vom Speicher abgelehnt."));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error("Der Datei-Upload ist fehlgeschlagen."));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new Error("Der Datei-Upload hat zu lange nicht geantwortet."));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("Upload aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (authorization.method === "POST") {
      const form = new FormData();
      for (const [name, value] of Object.entries(authorization.fields!)) {
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

function sha256Base64(blob: Blob) {
  return blob.arrayBuffer().then(async (bytes) => {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    let binary = "";
    for (const value of digest) binary += String.fromCharCode(value);
    return btoa(binary);
  });
}

function uploadMultipartPart(
  body: Blob,
  authorization: MultipartPartAuthorization,
  signal: AbortSignal,
  onProgress: (loadedBytes: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Upload aborted", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    const target = new URL(authorization.url, window.location.origin);
    if (!["http:", "https:"].includes(target.protocol)) {
      reject(new Error("Die Upload-Adresse ist ungueltig."));
      return;
    }
    xhr.open("PUT", target.href);
    for (const [name, value] of Object.entries(
      browserUploadHeaders(authorization.headers),
    )) {
      xhr.setRequestHeader(name, value);
    }
    let stallTimeout: ReturnType<typeof setTimeout> | undefined;
    let stalled = false;
    const abort = () => xhr.abort();
    const cleanup = () => {
      if (stallTimeout) clearTimeout(stallTimeout);
      signal.removeEventListener("abort", abort);
    };
    const armStallTimeout = () => {
      if (stallTimeout) clearTimeout(stallTimeout);
      stallTimeout = setTimeout(() => {
        stalled = true;
        cleanup();
        xhr.abort();
        reject(
          new Error(
            "Ein Teil des Datei-Uploads hat zu lange keine Daten uebertragen.",
          ),
        );
      }, MULTIPART_PART_STALL_TIMEOUT_MS);
    };
    xhr.upload.onprogress = (event) => {
      armStallTimeout();
      if (event.lengthComputable) {
        onProgress(Math.min(body.size, event.loaded));
      }
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(body.size);
        resolve();
      } else {
        reject(new Error("Ein Teil des Datei-Uploads wurde abgelehnt."));
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error("Ein Teil des Datei-Uploads ist fehlgeschlagen."));
    };
    xhr.onabort = () => {
      cleanup();
      if (!stalled) reject(new DOMException("Upload aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    armStallTimeout();
    xhr.send(body);
  });
}

function wait(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Polling aborted", "AbortError"));
      return;
    }
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Polling aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal.addEventListener("abort", abort, { once: true });
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
      if (error instanceof DOMException && error.name === "AbortError")
        throw error;
      if (error instanceof SessionMediaRequestError) throw error;
      lastError = error;
      if (attempt === 3) throw error;
      await wait(500 * 2 ** attempt, signal);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Die Media-Anfrage ist fehlgeschlagen.");
}

async function completeMultipartUploadWithRecovery(
  completeUrl: string,
  statusUrl: string,
  signal: AbortSignal,
) {
  const deadline = Date.now() + 32 * 60_000;
  let nextCompleteAttemptAt = 0;
  let lastError: unknown;
  while (!signal.aborted && Date.now() < deadline) {
    if (Date.now() >= nextCompleteAttemptAt) {
      try {
        const response = await fetch(completeUrl, {
          method: "POST",
          credentials: "same-origin",
          signal,
        });
        await responseData(response);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        const recoverable =
          !(error instanceof SessionMediaRequestError) ||
          error.status >= 500 ||
          error.status === 429 ||
          (error.status === 409 &&
            ["completion_in_progress", "completion_claim_lost"].includes(
              error.reason ?? "",
            ));
        if (!recoverable) throw error;
        lastError = error;
        const retryAfter =
          error instanceof SessionMediaRequestError
            ? error.retryAfterSeconds
            : undefined;
        nextCompleteAttemptAt =
          Date.now() +
          Math.max(6_000, Math.min(30_000, (retryAfter ?? 6) * 1_000));
      }
    }

    try {
      const asset = await sessionDataWithRetry<BrowserSessionMediaAsset>(
        statusUrl,
        { method: "GET", cache: "no-store" },
        signal,
      );
      if (asset.status !== "pending") return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        throw error;
      if (
        error instanceof SessionMediaRequestError &&
        [401, 403, 404].includes(error.status)
      ) {
        throw error;
      }
      lastError ??= error;
    }
    await wait(
      Math.max(1_000, Math.min(3_000, nextCompleteAttemptAt - Date.now())),
      signal,
    );
  }
  signal.throwIfAborted();
  throw lastError instanceof Error
    ? lastError
    : new Error("Der Upload-Abschluss hat zu lange gedauert.");
}

async function uploadMultipartFile(
  file: File,
  authorization: Extract<
    NonNullable<UploadIntent["upload"]>,
    { transport: "s3-multipart" }
  >,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
) {
  const transferController = new AbortController();
  const abortTransfer = () => transferController.abort();
  if (signal.aborted) abortTransfer();
  else signal.addEventListener("abort", abortTransfer, { once: true });
  const transferSignal = transferController.signal;

  try {
    const status = await sessionDataWithRetry<MultipartUploadStatus>(
      authorization.statusUrl,
      { method: "POST", cache: "no-store" },
      transferSignal,
    );
    if (
      status.partSizeBytes !== authorization.partSizeBytes ||
      status.partCount !== authorization.partCount ||
      status.partSizeBytes <= 0 ||
      status.partCount <= 0
    ) {
      throw new Error("Die Multipart-Upload-Sitzung ist ungueltig.");
    }

    const completedParts = new Set<number>();
    const loadedByPart = new Map<number, number>();
    for (const part of status.uploadedParts) {
      if (
        !Number.isInteger(part.partNumber) ||
        part.partNumber < 1 ||
        part.partNumber > status.partCount
      ) {
        throw new Error("Der gespeicherte Multipart-Status ist ungueltig.");
      }
      const expectedSize =
        part.partNumber === status.partCount
          ? file.size - status.partSizeBytes * (status.partCount - 1)
          : status.partSizeBytes;
      if (part.sizeBytes !== expectedSize || expectedSize <= 0) {
        throw new Error(
          "Ein gespeicherter Upload-Teil hat eine falsche Groesse.",
        );
      }
      completedParts.add(part.partNumber);
      loadedByPart.set(part.partNumber, part.sizeBytes);
    }

    const reportProgress = () => {
      const loaded = [...loadedByPart.values()].reduce(
        (total, value) => total + value,
        0,
      );
      onProgress(Math.min(100, Math.round((loaded / file.size) * 100)));
    };
    reportProgress();

    const pendingParts = Array.from(
      { length: status.partCount },
      (_, index) => index + 1,
    ).filter((partNumber) => !completedParts.has(partNumber));
    let cursor = 0;
    const worker = async () => {
      while (cursor < pendingParts.length) {
        transferSignal.throwIfAborted();
        const partNumber = pendingParts[cursor++];
        if (!partNumber) return;
        const start = (partNumber - 1) * status.partSizeBytes;
        const end = Math.min(file.size, start + status.partSizeBytes);
        const body = file.slice(start, end, file.type);
        if (body.size <= 0) {
          throw new Error("Ein Multipart-Upload-Teil ist leer.");
        }
        const releaseSlot = await acquireMultipartSlot(transferSignal);
        try {
          const checksumSha256 = await sha256Base64(body);
          transferSignal.throwIfAborted();
          let lastError: unknown;
          for (let attempt = 0; attempt < 5; attempt += 1) {
            try {
              loadedByPart.set(partNumber, 0);
              reportProgress();
              const signed =
                await sessionDataWithRetry<MultipartPartAuthorization>(
                  authorization.partsUrl,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ partNumber, checksumSha256 }),
                  },
                  transferSignal,
                );
              if (
                signed.partNumber !== partNumber ||
                signed.sizeBytes !== body.size ||
                signed.method !== "PUT"
              ) {
                throw new Error("Die signierte Upload-Freigabe ist ungueltig.");
              }
              await uploadMultipartPart(
                body,
                signed,
                transferSignal,
                (loadedBytes) => {
                  loadedByPart.set(partNumber, loadedBytes);
                  reportProgress();
                },
              );
              lastError = undefined;
              break;
            } catch (error) {
              if (
                error instanceof DOMException &&
                error.name === "AbortError"
              ) {
                throw error;
              }
              lastError = error;
              if (attempt < 4) {
                await wait(Math.min(8_000, 500 * 2 ** attempt), transferSignal);
              }
            }
          }
          if (lastError) throw lastError;
        } finally {
          releaseSlot();
        }
      }
    };

    let firstError: unknown;
    const workers = Array.from(
      {
        length: Math.min(
          Math.max(1, authorization.concurrency),
          pendingParts.length || 1,
        ),
      },
      () =>
        worker().catch((error) => {
          firstError ??= error;
          abortTransfer();
          throw error;
        }),
    );
    const results = await Promise.allSettled(workers);
    if (firstError !== undefined) throw firstError;
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejected) throw rejected.reason;
    onProgress(100);
  } finally {
    signal.removeEventListener("abort", abortTransfer);
  }
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

  if (intent.completionPending) {
    if (!intent.completeUrl) {
      throw new Error("Der Abschluss-Endpunkt fuer den Upload fehlt.");
    }
    await completeMultipartUploadWithRecovery(
      intent.completeUrl,
      intent.statusUrl,
      input.signal,
    );
  } else if (intent.upload) {
    input.onStage?.("uploading");
    if (intent.upload.transport === "s3-multipart") {
      await uploadMultipartFile(
        input.file,
        intent.upload,
        input.signal,
        (progress) => input.onProgress?.(progress),
      );
      if (!intent.completeUrl) {
        throw new Error("Der Abschluss-Endpunkt fuer den Upload fehlt.");
      }
      await completeMultipartUploadWithRecovery(
        intent.completeUrl,
        intent.statusUrl,
        input.signal,
      );
    } else {
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
          if (
            !status ||
            !["uploaded", "scanning", "ready"].includes(status.status)
          ) {
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
  }

  input.onStage?.("processing");
  input.onProgress?.(100);
  const deadline = Date.now() + 2 * 60 * 60_000;
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
      if (error instanceof DOMException && error.name === "AbortError")
        throw error;
      transientFailures += 1;
      if (transientFailures > 8) {
        throw new Error("Der Scanstatus ist vorübergehend nicht erreichbar.");
      }
      await wait(pollDelay, input.signal);
      pollDelay = Math.min(15_000, pollDelay + 1_000);
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
      pollDelay = Math.min(15_000, pollDelay + 1_000);
      continue;
    }
    const status = await responseData<BrowserSessionMediaAsset>(response);
    transientFailures = 0;
    if (status.status === "ready") return status;
    if (status.status === "quarantined") {
      throw new Error("Die Sicherheitsprüfung hat die Datei abgelehnt.");
    }
    if (status.status === "failed") {
      throw new Error(
        "Die Sicherheitsprüfung konnte nicht abgeschlossen werden.",
      );
    }
    await wait(pollDelay, input.signal);
    pollDelay = Math.min(15_000, pollDelay + 1_000);
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

export function discardBrowserSessionMediaAsset(assetId: string) {
  if (!assetId) return;
  void fetch(`/api/media-assets/${assetId}`, {
    method: "DELETE",
    credentials: "same-origin",
    keepalive: true,
  })
    .then((response) => response.body?.cancel())
    .catch(() => undefined);
}

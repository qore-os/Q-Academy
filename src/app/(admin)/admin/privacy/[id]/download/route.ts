import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { privacyExportArtifacts } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { handleSessionMediaRequest } from "@/lib/media/session-api";
import {
  claimPrivacyExportDownload,
  type PrivacyExportDownloadLease,
  PrivacyExportDownloadGuardError,
  releasePrivacyExportDownload,
} from "@/lib/privacy/export-download-guard";
import { createPrivacyExportDownloadStream } from "@/lib/privacy/export-download-stream";
import {
  PrivacyOwnerStepUpError,
  verifyPrivacyOwnerStepUp,
} from "@/lib/privacy/owner-step-up";
import { privacyStepUpPassword } from "@/lib/privacy/request-schemas";
import { readPrivacyExport } from "@/lib/privacy/export-storage";
import { logServerError } from "@/lib/server-error-logging";

export const dynamic = "force-dynamic";
// Leave a small platform margin after the application-enforced ten-minute
// response deadline so lease cleanup can finish before a host terminates work.
export const maxDuration = 610;

const downloadFormSchema = z.object({
  artifactId: z.string().uuid(),
  password: z.string().max(256),
});

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  return handleSessionMediaRequest(
    request,
    { mutation: true, action: "privacy.export.download" },
    async (user) => {
      if (user.role !== "owner") {
        throw new ApiError(
          403,
          "forbidden",
          "Der Export ist dem Organisations-Owner vorbehalten.",
        );
      }
      const contentLength = request.headers.get("content-length");
      if (
        !contentLength ||
        !/^\d+$/.test(contentLength) ||
        Number(contentLength) > 4_096
      ) {
        throw new ApiError(413, "bad_request", "Der Request-Body ist zu gross.");
      }
      const contentType = request.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (
        contentType !== "application/x-www-form-urlencoded" &&
        contentType !== "multipart/form-data"
      ) {
        throw new ApiError(400, "bad_request", "Der Form-Body ist ungueltig.");
      }
      const requestId = z.string().uuid().safeParse((await params).id);
      const form = await request.formData();
      const input = downloadFormSchema.safeParse({
        artifactId: form.get("artifactId"),
        password: privacyStepUpPassword(form),
      });
      if (!requestId.success || !input.success) {
        throw new ApiError(400, "bad_request", "Die Download-Anfrage ist ungueltig.");
      }
      try {
        await verifyPrivacyOwnerStepUp(user, input.data.password);
      } catch (error) {
        if (error instanceof PrivacyOwnerStepUpError) {
          throw new ApiError(
            error.code === "rate_limited" ? 429 : 403,
            error.code === "rate_limited"
              ? "rate_limit_exceeded"
              : "forbidden",
            error.message,
            error.retryAfter
              ? {
                  resetAt: new Date(
                    Date.now() + error.retryAfter * 1_000,
                  ).toISOString(),
                }
              : undefined,
          );
        }
        throw error;
      }

      const [artifact] = await db
        .select()
        .from(privacyExportArtifacts)
        .where(
          and(
            eq(privacyExportArtifacts.id, input.data.artifactId),
            eq(privacyExportArtifacts.requestId, requestId.data),
            eq(privacyExportArtifacts.organizationId, user.organizationId),
            eq(privacyExportArtifacts.status, "ready"),
            isNull(privacyExportArtifacts.deletedAt),
            gt(privacyExportArtifacts.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (
        !artifact ||
        !artifact.artifactSha256 ||
        !artifact.sizeBytes ||
        !Number.isSafeInteger(artifact.sizeBytes) ||
        ![
          "application/json; charset=utf-8",
          "application/zip",
        ].includes(artifact.contentType) ||
        !/^[a-z0-9][a-z0-9_-]{0,114}[.](json|zip)$/.test(
          artifact.safeFileName,
        )
      ) {
        throw new ApiError(
          404,
          "not_found",
          "Das Exportartefakt wurde nicht gefunden oder ist abgelaufen.",
        );
      }
      let lease: PrivacyExportDownloadLease;
      try {
        lease = await claimPrivacyExportDownload({
          organizationId: user.organizationId,
          userId: user.id,
        });
      } catch (error) {
        if (error instanceof PrivacyExportDownloadGuardError) {
          throw new ApiError(
            error.code === "unavailable" ? 503 : 429,
            error.code === "unavailable"
              ? "internal_error"
              : "rate_limit_exceeded",
            error.message,
            error.retryAfter
              ? {
                  resetAt: new Date(
                    Date.now() + error.retryAfter * 1_000,
                  ).toISOString(),
                }
              : undefined,
          );
        }
        throw error;
      }

      let plaintext: Buffer;
      try {
        plaintext = await readPrivacyExport({
          organizationId: user.organizationId,
          requestId: requestId.data,
          artifactId: artifact.id,
          storageKey: artifact.storageKey,
          storageDriver: artifact.storageDriver,
          storageVersionId: artifact.storageVersionId,
          storageEtag: artifact.storageEtag,
          expectedSha256: artifact.artifactSha256,
          expectedSizeBytes: artifact.sizeBytes,
        });
      } catch (error) {
        try {
          await releasePrivacyExportDownload(lease);
        } catch (releaseError) {
          logServerError(releaseError, {
            action: "privacy.export.download_concurrency_release",
          });
        }
        throw error;
      }
      const release = async () => {
        try {
          await releasePrivacyExportDownload(lease);
        } catch (error) {
          // A failed persistent release remains fail-closed until lease expiry.
          logServerError(error, {
            action: "privacy.export.download_concurrency_release",
          });
        }
      };
      const body = createPrivacyExportDownloadStream({
        bytes: plaintext,
        release,
      });
      try {
        return new Response(body.stream, {
          headers: {
            "Cache-Control": "private, no-store",
            "Content-Disposition": `attachment; filename="${artifact.safeFileName}"`,
            "Content-Length": String(plaintext.byteLength),
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Content-Type": artifact.contentType,
            "Cross-Origin-Resource-Policy": "same-origin",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (error) {
        await body.abort(error);
        throw error;
      }
    },
  );
}

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/db";
import {
  customDomainClaims,
  organizations,
  platformSettings,
} from "@/db/schema";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { organizationUpdateSchema } from "@/lib/api/schemas";
import {
  tenantBrandingPatchSchema,
  tenantLoginHostnameSchema,
} from "@/lib/branding";
import { BRANDING_CACHE_TAG } from "@/lib/branding-model";
import {
  assertReadyBrandingMediaAssets,
  BrandingMediaBindingError,
} from "@/lib/branding-media";
import {
  safeBrandFaviconSource,
  safePublicBrandImageSource,
  safePublicBrandPreviewSource,
} from "@/lib/branding-asset-policy";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    { scopes: ["organization:read"], action: "organization.read", resourceType: "organization" },
    async (context) => {
      const [organization] = await db.select().from(organizations).where(eq(organizations.id, context.organizationId)).limit(1);
      const settings = await db
        .select({ key: platformSettings.key, value: platformSettings.value, updatedAt: platformSettings.updatedAt })
        .from(platformSettings)
        .where(eq(platformSettings.organizationId, context.organizationId));
      return { data: { ...organization, settings: Object.fromEntries(settings.map((item) => [item.key, item.value])) } };
    },
  );
}

export async function PATCH(request: Request) {
  return handleApi(
    request,
    { scopes: ["organization:write"], action: "organization.update", resourceType: "organization", idempotent: true },
    async (context) => {
      const input = await parseJson(request, organizationUpdateSchema);
      const { settings, ...organizationInput } = input;
      let validatedSettings = settings;
      if (settings?.design) {
        const design = tenantBrandingPatchSchema.safeParse(settings.design);
        if (!design.success) {
          throw new ApiError(
            422,
            "validation_error",
            design.error.issues[0]?.message ??
              "Die Branding-Einstellungen sind ungueltig.",
          );
        }
        const managedImageSources = [
          ["logoUrl", safePublicBrandImageSource],
          ["logoLightUrl", safePublicBrandImageSource],
          ["logoDarkUrl", safePublicBrandImageSource],
          ["faviconUrl", safeBrandFaviconSource],
          ["socialPreviewImageUrl", safePublicBrandPreviewSource],
          ["loginBackgroundUrl", safePublicBrandImageSource],
        ] as const;
        const unsafeSource = managedImageSources.find(
          ([field, validator]) =>
            Object.hasOwn(design.data, field) &&
            design.data[field] !== null &&
            !validator(design.data[field]),
        );
        if (unsafeSource) {
          throw new ApiError(
            422,
            "validation_error",
            `${unsafeSource[0]} muss ein verwaltetes Media-Asset oder ein deploytes /images/-Bild verwenden.`,
          );
        }
        validatedSettings = { ...settings, design: design.data };
      }
      const organization = await db.transaction(async (tx) => {
        const design = validatedSettings?.design;
        if (design) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext('tenant-branding-login-hostname'))`,
          );
          try {
            await assertReadyBrandingMediaAssets(
              tx,
              context.organizationId,
              design,
            );
          } catch (error) {
            if (error instanceof BrandingMediaBindingError) {
              throw new ApiError(422, "validation_error", error.message);
            }
            throw error;
          }
        }
        if (design && Object.hasOwn(design, "loginHostname")) {
          const hostname = tenantLoginHostnameSchema.safeParse(
            design.loginHostname ?? null,
          );
          if (!hostname.success) {
            throw new ApiError(
              422,
              "validation_error",
              "Der Login-Hostname ist ungueltig.",
            );
          }
          if (hostname.data) {
            const [verifiedClaim] = await tx
              .select({ id: customDomainClaims.id })
              .from(customDomainClaims)
              .where(
                and(
                  eq(
                    customDomainClaims.organizationId,
                    context.organizationId,
                  ),
                  eq(customDomainClaims.hostname, hostname.data),
                  eq(customDomainClaims.status, "verified"),
                  isNull(customDomainClaims.revokedAt),
                ),
              )
              .limit(1);
            if (!verifiedClaim) {
              throw new ApiError(
                422,
                "validation_error",
                "Der Login-Hostname besitzt keinen aktiven verifizierten Domain-Claim.",
              );
            }
          }
        }
        let updated = await tx.select().from(organizations).where(eq(organizations.id, context.organizationId)).limit(1).then((rows) => rows[0]);
        if (Object.keys(organizationInput).length) {
          [updated] = await tx.update(organizations).set({ ...organizationInput, updatedAt: new Date() }).where(eq(organizations.id, context.organizationId)).returning();
        }
        if (validatedSettings) {
          for (const [key, value] of Object.entries(validatedSettings)) {
            await tx
              .insert(platformSettings)
              .values({ organizationId: context.organizationId, key, value })
              .onConflictDoUpdate({
                target: [platformSettings.organizationId, platformSettings.key],
                set: { value, updatedAt: new Date() },
              });
          }
        }
        return updated;
      });
      revalidateTag(BRANDING_CACHE_TAG, { expire: 0 });
      return { data: organization, resourceId: context.organizationId };
    },
  );
}

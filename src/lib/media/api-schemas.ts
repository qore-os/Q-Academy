import { z } from "zod";

import { MEDIA_PURPOSES } from "@/lib/media/mime-policy";

export const mediaAssetCreateSchema = z
  .object({
    purpose: z.enum(MEDIA_PURPOSES),
    originalFileName: z.string().trim().min(1).max(255),
    declaredMimeType: z.string().trim().min(3).max(180),
    sizeBytes: z.number().int().positive(),
    ownerUserId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const mediaMultipartPartAuthorizationSchema = z
  .object({
    partNumber: z.number().int().min(1).max(10_000),
    checksumSha256: z.string().regex(/^[a-z0-9+/]{43}=$/i),
  })
  .strict();

export type MediaAssetCreateInput = z.infer<typeof mediaAssetCreateSchema>;

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

export type MediaAssetCreateInput = z.infer<typeof mediaAssetCreateSchema>;

import { z } from "zod";

export const sessionCourseMediaListSchema = z
  .object({
    kind: z.enum(["image", "video", "audio", "document"]),
    search: z.string().trim().max(100).default(""),
    limit: z.coerce.number().int().min(1).max(50).default(30),
  })
  .strict();

export type SessionCourseMediaListInput = z.infer<
  typeof sessionCourseMediaListSchema
>;

export function escapeCourseMediaLibrarySearch(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

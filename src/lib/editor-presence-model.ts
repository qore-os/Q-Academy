import { z } from "zod";

export const EDITOR_PRESENCE_HEARTBEAT_MS = 25_000;
export const EDITOR_PRESENCE_TTL_MS = 75_000;

export const editorPresenceHeartbeatSchema = z
  .object({
    clientId: z.string().uuid(),
    lessonId: z.string().uuid().nullable().default(null),
    pageId: z.string().uuid().nullable().default(null),
    leave: z.boolean().default(false),
  })
  .strict()
  .refine((input) => input.pageId === null || input.lessonId !== null, {
    path: ["pageId"],
    message: "Eine Seite benoetigt eine Lektion.",
  });

export type EditorPresenceHeartbeat = z.infer<
  typeof editorPresenceHeartbeatSchema
>;

export type PublicEditorPresence = Readonly<{
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  lessonId: string | null;
  pageId: string | null;
  expiresAt: string;
}>;

export function presenceExpiry(now: Date) {
  return new Date(now.getTime() + EDITOR_PRESENCE_TTL_MS);
}

export function collapseEditorPresences(
  rows: readonly PublicEditorPresence[],
) {
  const byUser = new Map<string, PublicEditorPresence>();
  for (const row of rows) {
    const current = byUser.get(row.userId);
    if (!current || row.expiresAt > current.expiresAt) byUser.set(row.userId, row);
  }
  return [...byUser.values()].sort(
    (left, right) =>
      left.displayName.localeCompare(right.displayName, "de") ||
      left.userId.localeCompare(right.userId),
  );
}

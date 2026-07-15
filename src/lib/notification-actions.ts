"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { requireUser } from "@/lib/auth";

const notificationIdSchema = z.string().uuid();

export type NotificationMutationResult =
  | { ok: true; affected: number }
  | { ok: false; error: "invalid" | "notFound" };

export async function markNotificationReadAction(
  notificationId: string,
): Promise<NotificationMutationResult> {
  const user = await requireUser();
  const parsedId = notificationIdSchema.safeParse(notificationId);
  if (!parsedId.success) {
    return { ok: false, error: "invalid" };
  }

  const updated = await db
    .update(notifications)
    .set({ read: true })
    .where(
      and(
        eq(notifications.id, parsedId.data),
        eq(notifications.userId, user.id),
      ),
    )
    .returning({ id: notifications.id });

  if (!updated.length) {
    return { ok: false, error: "notFound" };
  }
  return { ok: true, affected: updated.length };
}

export async function markAllNotificationsReadAction(): Promise<NotificationMutationResult> {
  const user = await requireUser();
  const updated = await db
    .update(notifications)
    .set({ read: true })
    .where(
      and(eq(notifications.userId, user.id), eq(notifications.read, false)),
    )
    .returning({ id: notifications.id });

  return { ok: true, affected: updated.length };
}

export async function deleteNotificationAction(
  notificationId: string,
): Promise<NotificationMutationResult> {
  const user = await requireUser();
  const parsedId = notificationIdSchema.safeParse(notificationId);
  if (!parsedId.success) {
    return { ok: false, error: "invalid" };
  }

  const deleted = await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.id, parsedId.data),
        eq(notifications.userId, user.id),
      ),
    )
    .returning({ id: notifications.id });

  if (!deleted.length) {
    return { ok: false, error: "notFound" };
  }
  return { ok: true, affected: deleted.length };
}

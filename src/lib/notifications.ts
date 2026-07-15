import "server-only";

import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { PLATFORM_TIME_ZONE } from "@/lib/utils";

export type NotificationCenterItem = {
  id: string;
  title: string;
  body: string;
  type: string;
  category: string;
  href: string | null;
  read: boolean;
  createdAt: string;
  createdAtLabel: string;
};

export type NotificationCenterData = {
  notifications: NotificationCenterItem[];
  unreadCount: number;
};

function internalHref(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export async function getCurrentUserNotificationData(
  locale: AppLocale,
  requestedLimit = 20,
): Promise<NotificationCenterData> {
  const user = await requireUser();
  const limit = Math.min(50, Math.max(1, Math.trunc(requestedLimit)));
  const dateTimeFormatter = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: PLATFORM_TIME_ZONE,
  });

  const [rows, unread] = await Promise.all([
    db
      .select({
        id: notifications.id,
        title: notifications.title,
        body: notifications.body,
        type: notifications.type,
        category: notifications.category,
        href: notifications.href,
        read: notifications.read,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .innerJoin(
        users,
        and(
          eq(users.id, notifications.userId),
          eq(users.organizationId, user.organizationId),
        ),
      )
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit),
    db
      .select({ value: count() })
      .from(notifications)
      .innerJoin(
        users,
        and(
          eq(users.id, notifications.userId),
          eq(users.organizationId, user.organizationId),
        ),
      )
      .where(
        and(eq(notifications.userId, user.id), eq(notifications.read, false)),
      ),
  ]);

  return {
    notifications: rows.map((notification) => ({
      ...notification,
      href: internalHref(notification.href),
      createdAt: notification.createdAt.toISOString(),
      createdAtLabel: dateTimeFormatter.format(notification.createdAt),
    })),
    unreadCount: Number(unread[0]?.value ?? 0),
  };
}

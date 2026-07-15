import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { userNotificationPreferences } from "@/db/schema";
import {
  CONFIGURABLE_NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPreferenceDto,
} from "@/lib/notification-preference-model";

type NotificationPreferenceReader = Pick<typeof db, "select">;

export async function usersWithEmailNotificationsDisabled(
  reader: NotificationPreferenceReader,
  input: {
    organizationId: string;
    userIds: string[];
    category: NotificationCategory;
  },
) {
  if (input.category === "system" || input.userIds.length === 0) {
    return new Set<string>();
  }
  const rows = await reader
    .select({ userId: userNotificationPreferences.userId })
    .from(userNotificationPreferences)
    .where(
      and(
        eq(
          userNotificationPreferences.organizationId,
          input.organizationId,
        ),
        inArray(userNotificationPreferences.userId, input.userIds),
        eq(userNotificationPreferences.category, input.category),
        eq(userNotificationPreferences.emailEnabled, false),
      ),
    );
  return new Set(rows.map(({ userId }) => userId));
}

export async function getNotificationPreferences(input: {
  userId: string;
  organizationId: string;
}): Promise<NotificationPreferenceDto[]> {
  const rows = await db
    .select({
      category: userNotificationPreferences.category,
      emailEnabled: userNotificationPreferences.emailEnabled,
      pushEnabled: userNotificationPreferences.pushEnabled,
    })
    .from(userNotificationPreferences)
    .where(
      and(
        eq(userNotificationPreferences.userId, input.userId),
        eq(userNotificationPreferences.organizationId, input.organizationId),
        inArray(
          userNotificationPreferences.category,
          CONFIGURABLE_NOTIFICATION_CATEGORIES,
        ),
      ),
    );
  const stored = new Map(rows.map((row) => [row.category, row]));
  return CONFIGURABLE_NOTIFICATION_CATEGORIES.map((category) => ({
    category,
    emailEnabled: stored.get(category)?.emailEnabled ?? true,
    pushEnabled: stored.get(category)?.pushEnabled ?? true,
  }));
}

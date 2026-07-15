export const NOTIFICATION_CATEGORIES = [
  "learning",
  "community",
  "events",
  "feedback",
  "announcements",
  "system",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const CONFIGURABLE_NOTIFICATION_CATEGORIES = [
  "learning",
  "community",
  "events",
  "feedback",
  "announcements",
] as const satisfies readonly NotificationCategory[];

export type ConfigurableNotificationCategory =
  (typeof CONFIGURABLE_NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CATEGORY_LABELS: Record<
  ConfigurableNotificationCategory,
  string
> = {
  learning: "Lernen und Kurse",
  community: "Community",
  events: "Events",
  feedback: "Feedback und Abgaben",
  announcements: "Ankuendigungen",
};

export type NotificationPreferenceDto = Readonly<{
  category: ConfigurableNotificationCategory;
  emailEnabled: boolean;
  pushEnabled: boolean;
}>;

export function isConfigurableNotificationCategory(
  value: string,
): value is ConfigurableNotificationCategory {
  return CONFIGURABLE_NOTIFICATION_CATEGORIES.some(
    (category) => category === value,
  );
}

export function categoryForEmailEvent(event: string): NotificationCategory {
  if (event === "lesson.available") return "learning";
  if (event === "feedback.reply") return "feedback";
  if (event === "event.rescheduled" || event === "event.cancelled") {
    return "events";
  }
  return "system";
}

export function categoryForNotificationType(type: string): NotificationCategory {
  const normalized = type.trim().toLowerCase();
  if (normalized === "community") return "community";
  if (normalized === "announcement") return "announcements";
  if (normalized === "event" || normalized.startsWith("event.")) return "events";
  if (
    normalized === "feedback" ||
    normalized === "submission" ||
    normalized.startsWith("feedback.") ||
    normalized.startsWith("submission.")
  ) {
    return "feedback";
  }
  if (
    normalized === "learning" ||
    normalized === "course" ||
    normalized === "lesson" ||
    normalized === "certificate" ||
    normalized.startsWith("course.") ||
    normalized.startsWith("lesson.")
  ) {
    return "learning";
  }
  return "system";
}


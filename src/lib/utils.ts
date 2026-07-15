import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  DEFAULT_LOCALE,
  intlLocale,
  type AppLocale,
} from "@/lib/i18n/model";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

const durationUnits: Record<
  AppLocale,
  { hours: string; minutes: string; seconds: string }
> = {
  de: { hours: "Std.", minutes: "Min.", seconds: "Sek." },
  en: { hours: "hr", minutes: "min", seconds: "sec" },
  it: { hours: "h", minutes: "min", seconds: "sec" },
  es: { hours: "h", minutes: "min", seconds: "s" },
  fr: { hours: "h", minutes: "min", seconds: "s" },
};

export function formatDuration(
  minutes: number,
  locale: AppLocale = DEFAULT_LOCALE,
) {
  const units = durationUnits[locale];
  if (minutes < 60) return `${minutes} ${units.minutes}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder
    ? `${hours} ${units.hours} ${remainder} ${units.minutes}`
    : `${hours} ${units.hours}`;
}

export function formatLearningTime(
  seconds: number,
  locale: AppLocale = DEFAULT_LOCALE,
) {
  const units = durationUnits[locale];
  const bounded = Math.max(0, Math.floor(seconds));
  if (bounded < 60) return `${bounded} ${units.seconds}`;
  const minutes = Math.floor(bounded / 60);
  const remainingSeconds = bounded % 60;
  if (minutes < 60) {
    return remainingSeconds
      ? `${minutes} ${units.minutes} ${remainingSeconds} ${units.seconds}`
      : `${minutes} ${units.minutes}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes
    ? `${hours} ${units.hours} ${remainingMinutes} ${units.minutes}`
    : `${hours} ${units.hours}`;
}

export const PLATFORM_TIME_ZONE = "Europe/Berlin";

export function formatDate(
  date: Date | string,
  options?: Intl.DateTimeFormatOptions,
  locale: AppLocale = DEFAULT_LOCALE,
) {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    ...(options ?? { day: "2-digit", month: "short", year: "numeric" }),
    timeZone: options?.timeZone ?? PLATFORM_TIME_ZONE,
  }).format(
    typeof date === "string" ? new Date(date) : date,
  );
}

export function formatDateTime(
  date: Date | string,
  locale: AppLocale = DEFAULT_LOCALE,
  timeZone: string = PLATFORM_TIME_ZONE,
) {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(typeof date === "string" ? new Date(date) : date);
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export const courseStatusLabels = {
  draft: "Entwurf",
  published: "Live",
  archived: "Archiviert",
} as const;

export const submissionStatusLabels = {
  open: "Offen",
  in_review: "In Pruefung",
  revision: "Ueberarbeitung",
  approved: "Bewertet",
} as const;

export const roleLabels = {
  owner: "Inhaber",
  admin: "Admin",
  trainer: "Trainer",
  member: "Mitglied",
} as const;

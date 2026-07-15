import { z } from "zod";

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((value) => value.toLowerCase());

function relativeLuminance(color: string) {
  const channels = [1, 3, 5].map(
    (index) => Number.parseInt(color.slice(index, index + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function eventCalendarContrastRatio(left: string, right: string) {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  return (
    (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05)
  );
}

export function eventCalendarReadableTextColor(background: string) {
  return eventCalendarContrastRatio("#ffffff", background) >=
    eventCalendarContrastRatio("#000000", background)
    ? "#ffffff"
    : "#000000";
}

export const eventCalendarThemeSchema = z
  .object({
    backgroundColor: colorSchema,
    surfaceColor: colorSchema,
    borderColor: colorSchema,
    headingColor: colorSchema,
    bodyColor: colorSchema,
    accentColor: colorSchema,
    liveColor: colorSchema,
    cancelledColor: colorSchema,
    density: z.enum(["compact", "comfortable"]),
    cardRadius: z.number().int().min(0).max(8),
  })
  .strict()
  .superRefine((theme, context) => {
    for (const [path, foreground, background] of [
      ["headingColor", theme.headingColor, theme.surfaceColor],
      ["headingColor", theme.headingColor, theme.backgroundColor],
      ["bodyColor", theme.bodyColor, theme.surfaceColor],
      ["bodyColor", theme.bodyColor, theme.backgroundColor],
      ["accentColor", theme.accentColor, theme.surfaceColor],
      ["accentColor", theme.accentColor, theme.backgroundColor],
      ["liveColor", "#ffffff", theme.liveColor],
      ["cancelledColor", "#ffffff", theme.cancelledColor],
    ] as const) {
      if (eventCalendarContrastRatio(foreground, background) < 4.5) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: "Der Farbkontrast muss mindestens WCAG AA (4.5:1) erreichen.",
        });
      }
    }
  });

export type EventCalendarTheme = z.infer<typeof eventCalendarThemeSchema>;

export const DEFAULT_EVENT_CALENDAR_THEME: EventCalendarTheme = {
  backgroundColor: "#f7f9fb",
  surfaceColor: "#ffffff",
  borderColor: "#dfe4e8",
  headingColor: "#243444",
  bodyColor: "#66727f",
  accentColor: "#167e74",
  liveColor: "#b84e42",
  cancelledColor: "#8c3f35",
  density: "comfortable",
  cardRadius: 6,
};

export const EVENT_CALENDAR_THEME_PRESETS = {
  clear: DEFAULT_EVENT_CALENDAR_THEME,
  contrast: {
    backgroundColor: "#f3f5f6",
    surfaceColor: "#ffffff",
    borderColor: "#9aa6af",
    headingColor: "#102a43",
    bodyColor: "#425466",
    accentColor: "#00695c",
    liveColor: "#a12f25",
    cancelledColor: "#7f1d1d",
    density: "compact",
    cardRadius: 2,
  },
  warm: {
    backgroundColor: "#faf8f4",
    surfaceColor: "#ffffff",
    borderColor: "#ded8cf",
    headingColor: "#2f3b45",
    bodyColor: "#655f58",
    accentColor: "#287f77",
    liveColor: "#bd4f3d",
    cancelledColor: "#8d3b32",
    density: "comfortable",
    cardRadius: 8,
  },
} satisfies Record<string, EventCalendarTheme>;

export function resolveEventCalendarTheme(value: unknown): EventCalendarTheme {
  const parsed = eventCalendarThemeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_EVENT_CALENDAR_THEME;
}

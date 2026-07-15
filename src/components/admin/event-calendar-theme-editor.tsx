"use client";

import { Check, LoaderCircle, Palette } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  updateEventCalendarThemeAdminAction,
  type EventCalendarThemeActionState,
} from "@/lib/admin/event-actions";
import {
  EVENT_CALENDAR_THEME_PRESETS,
  eventCalendarThemeSchema,
  type EventCalendarTheme,
} from "@/lib/event-calendar-theme";
import { getEventCalendarCopy } from "@/lib/i18n/event-calendar";
import type { AppLocale } from "@/lib/i18n/model";

const initialState: EventCalendarThemeActionState = { ok: null, message: "" };

type ColorFieldName =
  | "backgroundColor"
  | "surfaceColor"
  | "borderColor"
  | "headingColor"
  | "bodyColor"
  | "accentColor"
  | "liveColor"
  | "cancelledColor";

function ColorField({
  name,
  label,
  value,
  onChange,
}: {
  name: ColorFieldName;
  label: string;
  value: string;
  onChange: (name: ColorFieldName, value: string) => void;
}) {
  return (
    <label className="flex min-h-10 items-center justify-between gap-3 border-b border-[#edf0f2] py-2 last:border-b-0">
      <span className="text-xs font-semibold text-[#52606d]">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase text-[#7a8690]">{value}</span>
        <input
          name={name}
          type="color"
          value={value}
          onChange={(event) => onChange(name, event.target.value)}
          aria-label={label}
          className="focus-ring size-8 cursor-pointer rounded border border-[#dce1e5] bg-white p-1"
        />
      </span>
    </label>
  );
}

export function EventCalendarThemeEditor({
  theme: initialTheme,
  locale,
}: {
  theme: EventCalendarTheme;
  locale: AppLocale;
}) {
  const copy = getEventCalendarCopy(locale);
  const [theme, setTheme] = useState(initialTheme);
  const [state, formAction, pending] = useActionState(
    updateEventCalendarThemeAdminAction,
    initialState,
  );
  const themeValid = eventCalendarThemeSchema.safeParse(theme).success;

  useEffect(() => {
    if (state.ok === true) toast.success(copy.saved);
    if (state.ok === false) toast.error(copy.failed);
  }, [copy.failed, copy.saved, state]);

  const setColor = (name: ColorFieldName, value: string) => {
    setTheme((current) => ({ ...current, [name]: value }));
  };

  return (
    <section className="overflow-hidden rounded-md border border-[#dfe4e8] bg-white" aria-labelledby="event-calendar-design-title">
      <header className="flex items-start gap-3 border-b border-[#e8ebee] px-4 py-3 sm:px-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#e9f8f6] text-[#167e74]">
          <Palette className="size-4" />
        </span>
        <div>
          <h2 id="event-calendar-design-title" className="text-sm font-bold text-[#2b3a48]">
            {copy.designTitle}
          </h2>
          <p className="mt-0.5 text-[11px] leading-5 text-[#71808b]">
            {copy.designDescription}
          </p>
        </div>
      </header>
      <form action={formAction} className="grid lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <div className="space-y-5 border-b border-[#e8ebee] p-4 sm:p-5 lg:border-b-0 lg:border-r">
          <fieldset>
            <legend className="mb-2 text-xs font-semibold text-[#52606d]">{copy.presets}</legend>
            <div className="inline-flex max-w-full overflow-x-auto rounded-md border border-[#dce1e5] p-1">
              {(
                [
                  ["clear", copy.clear],
                  ["contrast", copy.contrast],
                  ["warm", copy.warm],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTheme(EVENT_CALENDAR_THEME_PRESETS[key])}
                  className="focus-ring h-8 shrink-0 rounded px-3 text-[11px] font-semibold text-[#52606d] hover:bg-[#f1f4f5]"
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-x-5 sm:grid-cols-2">
            <div>
              <ColorField name="backgroundColor" label={copy.background} value={theme.backgroundColor} onChange={setColor} />
              <ColorField name="surfaceColor" label={copy.surface} value={theme.surfaceColor} onChange={setColor} />
              <ColorField name="borderColor" label={copy.border} value={theme.borderColor} onChange={setColor} />
              <ColorField name="headingColor" label={copy.heading} value={theme.headingColor} onChange={setColor} />
            </div>
            <div>
              <ColorField name="bodyColor" label={copy.body} value={theme.bodyColor} onChange={setColor} />
              <ColorField name="accentColor" label={copy.accent} value={theme.accentColor} onChange={setColor} />
              <ColorField name="liveColor" label={copy.live} value={theme.liveColor} onChange={setColor} />
              <ColorField name="cancelledColor" label={copy.cancelled} value={theme.cancelledColor} onChange={setColor} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset>
              <legend className="mb-2 text-xs font-semibold text-[#52606d]">{copy.density}</legend>
              <div className="inline-flex rounded-md border border-[#dce1e5] p-1">
                {(["comfortable", "compact"] as const).map((density) => (
                  <label
                    key={density}
                    className={`focus-within:ring-2 focus-within:ring-[#2b9188] focus-within:ring-offset-1 cursor-pointer rounded px-3 py-1.5 text-[11px] font-semibold ${theme.density === density ? "bg-[#17324d] text-white" : "text-[#52606d]"}`}
                  >
                    <input
                      type="radio"
                      name="density"
                      value={density}
                      checked={theme.density === density}
                      onChange={() => setTheme((current) => ({ ...current, density }))}
                      className="sr-only"
                    />
                    {density === "comfortable" ? copy.comfortable : copy.compact}
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              <span className="flex items-center justify-between text-xs font-semibold text-[#52606d]">
                {copy.radius}
                <span className="font-mono text-[10px] text-[#7a8690]">{theme.cardRadius}px</span>
              </span>
              <input
                name="cardRadius"
                type="range"
                min={0}
                max={8}
                step={1}
                value={theme.cardRadius}
                onChange={(event) => setTheme((current) => ({ ...current, cardRadius: Number(event.target.value) }))}
                className="mt-3 w-full accent-[#2b9188]"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-col justify-between p-4 sm:p-5" style={{ backgroundColor: theme.backgroundColor }}>
          <div>
            <p className="mb-3 text-[10px] font-bold uppercase" style={{ color: theme.bodyColor }}>{copy.preview}</p>
            <div
              className={theme.density === "compact" ? "border p-3" : "border p-5"}
              style={{
                backgroundColor: theme.surfaceColor,
                borderColor: theme.borderColor,
                borderRadius: theme.cardRadius,
              }}
            >
              <span className="inline-flex rounded px-2 py-1 text-[9px] font-bold text-white" style={{ backgroundColor: theme.liveColor }}>
                LIVE
              </span>
              <h3 className="mt-3 text-sm font-bold" style={{ color: theme.headingColor }}>{copy.previewTitle}</h3>
              <p className="mt-1 text-[11px] leading-5" style={{ color: theme.bodyColor }}>{copy.previewBody}</p>
              <span className="mt-3 block h-1 w-16 rounded" style={{ backgroundColor: theme.accentColor }} />
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <p
              aria-live="polite"
              className="mr-auto max-w-56 self-center text-[11px] leading-4 text-[#8c3f35]"
            >
              {themeValid ? null : copy.contrastError}
            </p>
            <Button type="submit" disabled={pending || !themeValid}>
              {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
              {pending ? copy.saving : copy.save}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}

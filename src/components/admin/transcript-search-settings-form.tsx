"use client";

import { Captions, LoaderCircle, Save, X } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { getSettingsAdminCopy } from "@/lib/i18n/settings-admin";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import {
  updateTranscriptSearchSettingsAction,
  type TranscriptSearchSettingsActionState,
} from "@/lib/transcript-search-settings-actions";
import {
  MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERMS,
  MAX_EXCLUDED_TRANSCRIPT_SEARCH_TEXT_LENGTH,
  normalizeTranscriptSearchText,
  transcriptSearchSettingsTextSchema,
  type TranscriptSearchSettings,
} from "@/lib/transcript-search-settings-model";

const initialState: TranscriptSearchSettingsActionState = {};

export function TranscriptSearchSettingsForm({
  defaults,
  locale,
}: {
  defaults: TranscriptSearchSettings;
  locale: AppLocale;
}) {
  const [state, action, pending] = useActionState(
    updateTranscriptSearchSettingsAction,
    initialState,
  );
  const copy = getSettingsAdminCopy(locale);
  const [value, setValue] = useState(defaults.excludedSearchTerms.join("\n"));
  const normalizedTerms = useMemo(
    () => [
      ...new Set(
        value
          .replace(/\r\n?/g, "\n")
          .split("\n")
          .map(normalizeTranscriptSearchText)
          .filter(Boolean),
      ),
    ],
    [value],
  );
  const parsedValue = useMemo(
    () => transcriptSearchSettingsTextSchema.safeParse(value),
    [value],
  );
  const currentValue = parsedValue.success ? parsedValue.data.join("\n") : null;
  const savedValue = (state.excludedSearchTerms ?? defaults.excludedSearchTerms).join("\n");
  const message = state.code
    ? state.code === "transcriptSaved"
      ? copy.messages.transcriptSaved(
          new Intl.NumberFormat(intlLocale(locale)).format(state.excludedSearchTerms?.length ?? normalizedTerms.length),
        )
      : copy.messages[state.code]
    : "";

  const removeTerm = (term: string) => {
    setValue(normalizedTerms.filter((candidate) => candidate !== term).join("\n"));
  };

  return (
    <form
      id="transkripte"
      action={action}
      className="panel scroll-mt-24 overflow-hidden"
    >
      <header className="border-b border-[#edf0f2] px-5 py-4">
        <div className="flex items-center gap-2">
          <Captions className="size-4 text-[var(--brand-accent)]" />
          <h2 className="text-base font-bold text-[#243444]">
            {copy.transcript.title}
          </h2>
        </div>
        <p className="mt-1 text-xs leading-5 text-[#6c7882]">
          {copy.transcript.description}
        </p>
      </header>

      <div className="space-y-4 p-5">
        <label className="block" htmlFor="excluded-transcript-search-terms">
          <span className="mb-1.5 flex items-center justify-between gap-3 text-xs font-semibold text-[#52606d]">
            <span>{copy.transcript.excluded}</span>
            <span className="font-medium tabular-nums text-[#7b8791]">
              {copy.transcript.count(
                new Intl.NumberFormat(intlLocale(locale)).format(normalizedTerms.length),
                new Intl.NumberFormat(intlLocale(locale)).format(MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERMS),
              )}
            </span>
          </span>
          <textarea
            id="excluded-transcript-search-terms"
            name="excludedSearchTerms"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={MAX_EXCLUDED_TRANSCRIPT_SEARCH_TEXT_LENGTH}
            rows={7}
            placeholder={copy.transcript.placeholder}
            className="focus-ring brand-radius min-h-40 w-full resize-y border border-[#dce1e5] bg-white p-3 font-mono text-sm leading-6 text-[#243444] placeholder:text-[var(--theme-muted-text)]"
          />
          <span className="mt-1.5 block text-[11px] leading-4 text-[#7b8791]">
            {copy.transcript.hint}
          </span>
        </label>

        {normalizedTerms.length ? (
          <div
            className="flex max-h-40 flex-wrap gap-2 overflow-y-auto border-y border-[#edf0f2] py-3"
            aria-label={copy.transcript.normalized}
          >
            {normalizedTerms.slice(0, MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERMS).map((term) => (
              <span
                key={term}
                className="flex min-w-0 max-w-full items-center gap-1 rounded-md bg-[#eef3f5] py-1 pl-2.5 pr-1 text-xs font-semibold text-[#354555]"
              >
                <span className="truncate">{term}</span>
                <button
                  type="button"
                  onClick={() => removeTerm(term)}
                  aria-label={copy.transcript.removeNamed(term)}
                  title={copy.common.remove}
                  className="focus-ring grid size-6 shrink-0 place-items-center rounded text-[#71808b] hover:bg-white"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div aria-live="polite" className="min-h-5 text-xs">
            {state.code === "transcriptInvalid" || state.code === "transcriptFailed" ? (
              <span role="alert" className="text-[#a94339]">
                {message}
              </span>
            ) : state.code === "transcriptSaved" || state.code === "noChanges" ? (
              <span className="text-[#167e74]">{message}</span>
            ) : (
              <span className="text-[#7b8791]">
                {copy.transcript.blockedHint}
              </span>
            )}
          </div>
          <Button
            type="submit"
            disabled={
              pending ||
              currentValue === savedValue ||
              normalizedTerms.length > MAX_EXCLUDED_TRANSCRIPT_SEARCH_TERMS
            }
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {pending ? copy.common.saving : copy.transcript.save}
          </Button>
        </div>
      </div>
    </form>
  );
}

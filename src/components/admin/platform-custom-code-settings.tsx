"use client";

import { Code2, LoaderCircle, Save, ShieldCheck } from "lucide-react";
import { useActionState, useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { PlatformCustomCodeSlot } from "@/components/shared/platform-custom-code-slot";
import {
  savePlatformCustomCodeAction,
  type PlatformCustomCodeActionState,
} from "@/lib/platform-custom-code-actions";
import { getPlatformCustomCodeCopy } from "@/lib/i18n/platform-custom-code";
import type { AppLocale } from "@/lib/i18n/model";
import {
  PLATFORM_CUSTOM_CODE_MAX_HEIGHT,
  PLATFORM_CUSTOM_CODE_MAX_LENGTH,
  normalizePlatformCustomCodeValue,
  parsePlatformCustomCodeOrigins,
  type PlatformCustomCodeConfiguration,
} from "@/lib/platform-custom-code";

const initialState: PlatformCustomCodeActionState = { ok: null };
const inputClassName =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444] disabled:bg-[#f4f6f7] disabled:text-[#7a8690]";

type EditableConfiguration = Omit<
  PlatformCustomCodeConfiguration,
  "version" | "revision"
>;

function editableConfigurationFromFormData(formData: FormData) {
  return {
    enabled: formData.get("enabled") === "on",
    headerCode: normalizePlatformCustomCodeValue(formData.get("headerCode")),
    headerHeight: Number(formData.get("headerHeight")),
    footerCode: normalizePlatformCustomCodeValue(formData.get("footerCode")),
    footerHeight: Number(formData.get("footerHeight")),
    allowedNetworkOrigins: [
      ...new Set(
        parsePlatformCustomCodeOrigins(formData.get("allowedNetworkOrigins")),
      ),
    ],
  } satisfies EditableConfiguration;
}

function CodeSlotFields({
  slot,
  code,
  setCode,
  height,
  setHeight,
  disabled,
  locale,
  sandboxNonce,
  previewConfiguration,
}: {
  slot: "header" | "footer";
  code: string;
  setCode: (value: string) => void;
  height: number;
  setHeight: (value: number) => void;
  disabled: boolean;
  locale: AppLocale;
  sandboxNonce: string | null;
  previewConfiguration: PlatformCustomCodeConfiguration;
}) {
  const copy = getPlatformCustomCodeCopy(locale);
  const title = slot === "header" ? copy.header : copy.footer;
  return (
    <section className="border-t border-[#edf0f2] px-5 py-5">
      <h3 className="text-sm font-bold text-[#354555]">{title}</h3>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <div className="space-y-4">
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.code}
            </span>
            <textarea
              name={`${slot}Code`}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={PLATFORM_CUSTOM_CODE_MAX_LENGTH}
              disabled={disabled}
              spellCheck={false}
              className="focus-ring min-h-56 w-full resize-y rounded-md border border-[#dce1e5] bg-[#111b25] p-3 font-mono text-xs leading-5 text-[#e8f0f4] disabled:opacity-60"
            />
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.height}
            </span>
            <input
              name={`${slot}Height`}
              type="number"
              min={0}
              max={PLATFORM_CUSTOM_CODE_MAX_HEIGHT}
              step={1}
              value={height}
              onChange={(event) => setHeight(Number(event.target.value))}
              disabled={disabled}
              className={inputClassName}
            />
            <span className="mt-1 block text-[10px] text-[#71808b]">
              {copy.hiddenHeight}
            </span>
          </label>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-[#52606d]">
            {copy.preview}
          </p>
          <div
            className="min-h-20 overflow-hidden rounded-md border border-[#dce1e5] bg-white"
            style={{ minHeight: Math.max(80, height) }}
          >
            <PlatformCustomCodeSlot
              configuration={previewConfiguration}
              slot={slot}
              locale={locale}
              nonce={sandboxNonce}
              preview
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export function PlatformCustomCodeSettings({
  configuration,
  locale,
  canManage,
  sandboxNonce,
}: {
  configuration: PlatformCustomCodeConfiguration;
  locale: AppLocale;
  canManage: boolean;
  sandboxNonce: string | null;
}) {
  const copy = getPlatformCustomCodeCopy(locale);
  const [revision, setRevision] = useState(configuration.revision);
  const [enabled, setEnabled] = useState(configuration.enabled);
  const [headerCode, setHeaderCode] = useState(configuration.headerCode);
  const [headerHeight, setHeaderHeight] = useState(configuration.headerHeight);
  const [footerCode, setFooterCode] = useState(configuration.footerCode);
  const [footerHeight, setFooterHeight] = useState(configuration.footerHeight);
  const [origins, setOrigins] = useState(
    configuration.allowedNetworkOrigins.join("\n"),
  );
  const [baseline, setBaseline] = useState<EditableConfiguration>({
    enabled: configuration.enabled,
    headerCode: configuration.headerCode,
    headerHeight: configuration.headerHeight,
    footerCode: configuration.footerCode,
    footerHeight: configuration.footerHeight,
    allowedNetworkOrigins: configuration.allowedNetworkOrigins,
  });
  const submitConfiguration = useCallback(
    async (state: PlatformCustomCodeActionState, formData: FormData) => {
      const result = await savePlatformCustomCodeAction(state, formData);
      if (result.ok === true && result.revision !== undefined) {
        setRevision(result.revision);
        setBaseline(editableConfigurationFromFormData(formData));
      }
      return result;
    },
    [],
  );
  const [state, action, pending] = useActionState(
    submitConfiguration,
    initialState,
  );
  const normalizedOrigins = useMemo(
    () =>
      origins
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    [origins],
  );
  const dirty =
    enabled !== baseline.enabled ||
    headerCode !== baseline.headerCode ||
    headerHeight !== baseline.headerHeight ||
    footerCode !== baseline.footerCode ||
    footerHeight !== baseline.footerHeight ||
    normalizedOrigins.join("\n") !==
      baseline.allowedNetworkOrigins.join("\n");
  const previewConfiguration = useMemo<PlatformCustomCodeConfiguration>(
    () => ({
      version: 1,
      revision: configuration.revision,
      enabled: true,
      headerCode,
      headerHeight,
      footerCode,
      footerHeight,
      allowedNetworkOrigins: normalizedOrigins,
    }),
    [
      configuration.revision,
      footerCode,
      footerHeight,
      headerCode,
      headerHeight,
      normalizedOrigins,
    ],
  );
  const message = state.code ? copy.messages[state.code] : null;
  const disabled = pending || !canManage;

  return (
    <form
      action={action}
      className="panel scroll-mt-24 overflow-hidden"
      id="custom-code"
    >
      <input type="hidden" name="revision" value={revision} />
      <header className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]">
            <Code2 className="size-4" />
          </span>
          <div>
            <h2 className="text-base font-bold text-[#243444]">{copy.title}</h2>
            <p className="mt-1 text-xs leading-5 text-[#71808b]">
              {copy.description}
            </p>
          </div>
        </div>
        <Button type="submit" disabled={disabled || !dirty}>
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {pending ? copy.saving : copy.save}
        </Button>
      </header>

      <div className="border-t border-[#edf0f2] px-5 py-4">
        <label className="flex items-center gap-3 text-xs font-semibold text-[#354555]">
          <input
            name="enabled"
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            disabled={disabled}
            className="focus-ring size-4 accent-[#2bb7a9]"
          />
          {copy.enabled}
        </label>
        {!canManage ? (
          <p className="mt-3 text-xs text-[#815953]">{copy.ownerOnly}</p>
        ) : null}
      </div>

      <CodeSlotFields
        slot="header"
        code={headerCode}
        setCode={setHeaderCode}
        height={headerHeight}
        setHeight={setHeaderHeight}
        disabled={disabled}
        locale={locale}
        sandboxNonce={sandboxNonce}
        previewConfiguration={previewConfiguration}
      />
      <CodeSlotFields
        slot="footer"
        code={footerCode}
        setCode={setFooterCode}
        height={footerHeight}
        setHeight={setFooterHeight}
        disabled={disabled}
        locale={locale}
        sandboxNonce={sandboxNonce}
        previewConfiguration={previewConfiguration}
      />

      <div className="border-t border-[#edf0f2] px-5 py-5">
        <label>
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.origins}
          </span>
          <textarea
            name="allowedNetworkOrigins"
            value={origins}
            onChange={(event) => setOrigins(event.target.value)}
            placeholder={copy.originsPlaceholder}
            disabled={disabled}
            spellCheck={false}
            className="focus-ring min-h-24 w-full resize-y rounded-md border border-[#dce1e5] bg-white p-3 font-mono text-xs leading-5 text-[#243444] disabled:bg-[#f4f6f7]"
          />
        </label>
        <div className="mt-3 flex gap-2 rounded-md border border-[#cfe4df] bg-[#f1faf8] p-3 text-xs leading-5 text-[#35635e]">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          <p>{copy.isolation}</p>
        </div>
        {message ? (
          <p
            aria-live="polite"
            className={`mt-3 rounded-md p-3 text-xs ${state.ok ? "bg-[#e9f8f6] text-[#167e74]" : "bg-[#fdf0ee] text-[#a94339]"}`}
          >
            {message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

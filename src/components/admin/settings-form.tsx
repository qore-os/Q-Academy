"use client";

import { useActionState, useMemo, useState } from "react";
import {
  ImageIcon,
  LayoutDashboard,
  LoaderCircle,
  LogIn,
  Monitor,
  Moon,
  Save,
  ShieldCheck,
  Smartphone,
  Sun,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageAssetUploadField } from "@/components/media/image-asset-upload-field";
import { updateDesignAction, type ActionState } from "@/lib/actions";
import {
  BRAND_FONT_OPTIONS,
  BRAND_RADIUS_OPTIONS,
  BRAND_COLOR_MODE_OPTIONS,
  brandingCssVariables,
  type BrandFont,
  type BrandRadius,
  type BrandColorMode,
  type TenantBranding,
} from "@/lib/branding-model";
import {
  brandLogoSource,
} from "@/lib/branding-asset-policy";
import { getSettingsAdminCopy } from "@/lib/i18n/settings-admin";
import type { AppLocale } from "@/lib/i18n/model";
import { useHydrated } from "@/lib/use-hydrated";

const initialState: ActionState = {};
const inputClass =
  "focus-ring brand-radius h-10 w-full border border-[#dce1e5] bg-white px-3 text-sm text-[#243444] placeholder:text-[var(--theme-muted-text)]";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
      {children}
    </span>
  );
}

export function SettingsForm({ defaults, locale }: { defaults: TenantBranding; locale: AppLocale }) {
  const copy = getSettingsAdminCopy(locale);
  const hydrated = useHydrated();
  const [platformName, setPlatformName] = useState(defaults.platformName);
  const [primaryColor, setPrimaryColor] = useState(defaults.primaryColor);
  const [accentColor, setAccentColor] = useState(defaults.accentColor);
  const [logoUrl, setLogoUrl] = useState<string | null>(defaults.logoUrl);
  const [logoLightUrl, setLogoLightUrl] = useState<string | null>(
    defaults.logoLightUrl,
  );
  const [logoDarkUrl, setLogoDarkUrl] = useState<string | null>(
    defaults.logoDarkUrl,
  );
  const [socialPreviewImageUrl, setSocialPreviewImageUrl] = useState<string | null>(
    defaults.socialPreviewImageUrl,
  );
  const [faviconUrl, setFaviconUrl] = useState<string | null>(
    defaults.faviconUrl === "/favicon.ico" ? null : defaults.faviconUrl,
  );
  const [emailSenderName, setEmailSenderName] = useState(
    defaults.emailSenderName,
  );
  const [fontFamily, setFontFamily] = useState<BrandFont>(defaults.fontFamily);
  const [cornerRadius, setCornerRadius] = useState<BrandRadius>(
    defaults.cornerRadius,
  );
  const [colorMode, setColorMode] = useState<BrandColorMode>(
    defaults.colorMode,
  );
  const [loginEyebrow, setLoginEyebrow] = useState(defaults.loginEyebrow);
  const [loginTitle, setLoginTitle] = useState(defaults.loginTitle);
  const [loginDescription, setLoginDescription] = useState(
    defaults.loginDescription,
  );
  const [loginBackgroundUrl, setLoginBackgroundUrl] = useState<string | null>(
    defaults.loginBackgroundUrl,
  );
  const [loginBackgroundColor, setLoginBackgroundColor] = useState(
    defaults.loginBackgroundColor,
  );
  const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState(defaults.privacyPolicyUrl ?? "");
  const [aiTransparencyUrl, setAiTransparencyUrl] = useState(defaults.aiTransparencyUrl ?? "");
  const [previewMode, setPreviewMode] = useState<"dashboard" | "login">(
    "dashboard",
  );
  const previewBranding = useMemo<TenantBranding>(
    () => ({
      ...defaults,
      platformName,
      primaryColor,
      accentColor,
      logoUrl,
      logoLightUrl,
      logoDarkUrl,
      socialPreviewImageUrl,
      emailSenderName: emailSenderName.trim() || platformName,
      fontFamily,
      cornerRadius,
      colorMode,
      loginEyebrow,
      loginTitle,
      loginDescription,
      loginBackgroundUrl,
      loginBackgroundColor,
    }),
    [
      accentColor,
      cornerRadius,
      colorMode,
      defaults,
      fontFamily,
      emailSenderName,
      logoDarkUrl,
      logoLightUrl,
      logoUrl,
      loginBackgroundColor,
      loginBackgroundUrl,
      loginDescription,
      loginEyebrow,
      loginTitle,
      platformName,
      primaryColor,
      socialPreviewImageUrl,
    ],
  );
  const previewLightLogo = brandLogoSource(previewBranding, "light");
  const currentSignature = JSON.stringify({
    platformName,
    primaryColor,
    accentColor,
    logoUrl,
    logoLightUrl,
    logoDarkUrl,
    faviconUrl,
    socialPreviewImageUrl,
    emailSenderName,
    fontFamily,
    cornerRadius,
    colorMode,
    loginEyebrow,
    loginTitle,
    loginDescription,
    loginBackgroundUrl,
    loginBackgroundColor,
    privacyPolicyUrl,
    aiTransparencyUrl,
  });
  const [savedSignature, setSavedSignature] = useState(currentSignature);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const submittedSignature = currentSignature;
      const result = await updateDesignAction(previous, formData);
      if (result.settingsMessageCode === "designSaved") {
        setSavedSignature(submittedSignature);
      }
      return result;
    },
    initialState,
  );
  const message = state.settingsMessageCode
    ? copy.messages[state.settingsMessageCode]
    : "";

  return (
    <form
      action={action}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]"
      style={brandingCssVariables(previewBranding)}
      data-color-mode={colorMode}
    >
      <section className="panel overflow-hidden">
        <div className="border-b border-[#edf0f2] px-5 py-4">
          <h2 className="text-base font-bold text-[#243444]">
            {copy.design.title}
          </h2>
          <p className="mt-1 text-xs leading-5 text-[#6c7882]">
            {copy.design.description}
          </p>
        </div>

        <div className="space-y-7 p-5">
          <section>
            <div className="mb-4 flex items-center gap-2 text-sm font-bold text-[#243444]">
              <ImageIcon className="size-4 text-[var(--brand-accent)]" />
              {copy.design.brand}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <FieldLabel>{copy.design.platformName}</FieldLabel>
                <input
                  name="platformName"
                  value={platformName}
                  onChange={(event) => setPlatformName(event.target.value)}
                  className={inputClass}
                  maxLength={120}
                  required
                />
              </label>
              <div className="sm:col-span-2">
                <ImageAssetUploadField
                  name="logoAssetId"
                  label={copy.design.standardLogo}
                  purpose="branding"
                  locale={locale}
                  initialAssetId={defaults.logoAssetId}
                  initialSource={defaults.logoUrl}
                  disabled={pending}
                  onSourceChange={setLogoUrl}
                />
              </div>
              <div className="sm:col-span-2">
                <ImageAssetUploadField
                  name="logoLightAssetId"
                  label={copy.design.lightLogo}
                  purpose="branding"
                  locale={locale}
                  initialAssetId={defaults.logoLightAssetId}
                  initialSource={defaults.logoLightUrl}
                  disabled={pending}
                  onSourceChange={setLogoLightUrl}
                />
              </div>
              <div className="sm:col-span-2">
                <ImageAssetUploadField
                  name="logoDarkAssetId"
                  label={copy.design.darkLogo}
                  purpose="branding"
                  locale={locale}
                  initialAssetId={defaults.logoDarkAssetId}
                  initialSource={defaults.logoDarkUrl}
                  disabled={pending}
                  onSourceChange={setLogoDarkUrl}
                />
              </div>
              <div className="sm:col-span-2">
                <ImageAssetUploadField
                  name="faviconAssetId"
                  label={copy.design.favicon}
                  purpose="branding"
                  locale={locale}
                  initialAssetId={defaults.faviconAssetId}
                  initialSource={
                    defaults.faviconUrl === "/favicon.ico"
                      ? null
                      : defaults.faviconUrl
                  }
                  allowIcon
                  disabled={pending}
                  onSourceChange={setFaviconUrl}
                />
              </div>
              <div className="sm:col-span-2">
                <ImageAssetUploadField
                  name="socialPreviewImageAssetId"
                  label={copy.design.socialPreview}
                  purpose="branding"
                  locale={locale}
                  initialAssetId={defaults.socialPreviewImageAssetId}
                  initialSource={defaults.socialPreviewImageUrl}
                  disabled={pending}
                  onSourceChange={setSocialPreviewImageUrl}
                />
              </div>
              <label className="sm:col-span-2">
                <FieldLabel>{copy.design.senderName}</FieldLabel>
                <input
                  name="emailSenderName"
                  value={emailSenderName}
                  onChange={(event) => setEmailSenderName(event.target.value)}
                  className={inputClass}
                  minLength={2}
                  maxLength={120}
                  required
                />
              </label>
              <label>
                <FieldLabel>{copy.design.primaryColor}</FieldLabel>
                <span className="brand-radius flex h-10 items-center gap-2 border border-[#dce1e5] px-2">
                  <input
                    name="primaryColor"
                    type="color"
                    value={primaryColor}
                    onChange={(event) => setPrimaryColor(event.target.value)}
                    className="size-7 cursor-pointer border-0 bg-transparent p-0"
                  />
                  <span className="min-w-0 flex-1 font-mono text-xs text-[#52606d]">
                    {primaryColor}
                  </span>
                </span>
              </label>
              <label>
                <FieldLabel>{copy.design.accentColor}</FieldLabel>
                <span className="brand-radius flex h-10 items-center gap-2 border border-[#dce1e5] px-2">
                  <input
                    name="accentColor"
                    type="color"
                    value={accentColor}
                    onChange={(event) => setAccentColor(event.target.value)}
                    className="size-7 cursor-pointer border-0 bg-transparent p-0"
                  />
                  <span className="min-w-0 flex-1 font-mono text-xs text-[#52606d]">
                    {accentColor}
                  </span>
                </span>
              </label>
              <fieldset className="sm:col-span-2">
                <legend>
                  <FieldLabel>{copy.design.colorScheme}</FieldLabel>
                </legend>
                <div
                  className="brand-radius grid grid-cols-3 gap-1 border border-[#dce1e5] bg-[#f5f7f8] p-1"
                  role="radiogroup"
                  aria-label={copy.design.colorScheme}
                >
                  {BRAND_COLOR_MODE_OPTIONS.map((option) => {
                    const Icon =
                      option.value === "light"
                        ? Sun
                        : option.value === "dark"
                          ? Moon
                          : Monitor;
                    return (
                      <label
                        key={option.value}
                        className={`focus-within:focus-ring brand-radius flex min-h-10 cursor-pointer items-center justify-center gap-2 px-2 text-xs font-semibold ${
                          colorMode === option.value
                            ? "bg-white text-[#243444] shadow-sm"
                            : "text-[#6c7882]"
                        }`}
                      >
                        <input
                          type="radio"
                          name="colorMode"
                          value={option.value}
                          checked={colorMode === option.value}
                          onChange={() => setColorMode(option.value)}
                          className="sr-only"
                        />
                        <Icon className="size-4" />
                        {copy.design.colorModes[option.value]}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          </section>

          <section className="border-t border-[#edf0f2] pt-6">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold text-[#243444]">
              <Type className="size-4 text-[var(--brand-accent)]" />
              {copy.design.appearance}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <FieldLabel>{copy.design.fontFamily}</FieldLabel>
                <select
                  name="fontFamily"
                  value={fontFamily}
                  onChange={(event) =>
                    setFontFamily(event.target.value as BrandFont)
                  }
                  className={inputClass}
                >
                  {BRAND_FONT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <FieldLabel>{copy.design.corners}</FieldLabel>
                <select
                  name="cornerRadius"
                  value={cornerRadius}
                  onChange={(event) =>
                    setCornerRadius(Number(event.target.value) as BrandRadius)
                  }
                  className={inputClass}
                >
                  {BRAND_RADIUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {`${copy.design.radii[option.value]} (${option.value}px)`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="border-t border-[#edf0f2] pt-6">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold text-[#243444]">
              <LogIn className="size-4 text-[var(--brand-accent)]" />
              {copy.design.login}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <FieldLabel>{copy.design.eyebrow}</FieldLabel>
                <input
                  name="loginEyebrow"
                  value={loginEyebrow}
                  onChange={(event) => setLoginEyebrow(event.target.value)}
                  className={inputClass}
                  minLength={2}
                  maxLength={60}
                  required
                />
              </label>
              <label>
                <FieldLabel>{copy.design.backgroundColor}</FieldLabel>
                <span className="brand-radius flex h-10 items-center gap-2 border border-[#dce1e5] px-2">
                  <input
                    name="loginBackgroundColor"
                    type="color"
                    value={loginBackgroundColor}
                    onChange={(event) =>
                      setLoginBackgroundColor(event.target.value)
                    }
                    className="size-7 cursor-pointer border-0 bg-transparent p-0"
                  />
                  <span className="min-w-0 flex-1 font-mono text-xs text-[#52606d]">
                    {loginBackgroundColor}
                  </span>
                </span>
              </label>
              <label className="sm:col-span-2">
                <FieldLabel>{copy.design.titleLabel}</FieldLabel>
                <input
                  name="loginTitle"
                  value={loginTitle}
                  onChange={(event) => setLoginTitle(event.target.value)}
                  className={inputClass}
                  minLength={3}
                  maxLength={100}
                  required
                />
              </label>
              <label className="sm:col-span-2">
                <FieldLabel>{copy.design.descriptionLabel}</FieldLabel>
                <textarea
                  name="loginDescription"
                  value={loginDescription}
                  onChange={(event) => setLoginDescription(event.target.value)}
                  className="focus-ring brand-radius min-h-24 w-full resize-y border border-[#dce1e5] bg-white p-3 text-sm leading-6 text-[#243444]"
                  minLength={10}
                  maxLength={300}
                  required
                />
              </label>
              <div className="sm:col-span-2">
                <ImageAssetUploadField
                  name="loginBackgroundAssetId"
                  label={copy.design.loginBackground}
                  purpose="branding"
                  locale={locale}
                  initialAssetId={defaults.loginBackgroundAssetId}
                  initialSource={defaults.loginBackgroundUrl}
                  disabled={pending}
                  onSourceChange={setLoginBackgroundUrl}
                />
              </div>
            </div>
          </section>

          <section
            id="datenschutz"
            className="scroll-mt-24 border-t border-[#edf0f2] pt-6"
          >
            <div className="mb-4 flex items-center gap-2 text-sm font-bold text-[#243444]">
              <ShieldCheck className="size-4 text-[var(--brand-accent)]" />
              {copy.design.privacy}
            </div>
            <div className="grid gap-4">
              <label>
                <FieldLabel>{copy.design.privacyUrl}</FieldLabel>
                <input
                  name="privacyPolicyUrl"
                  type="url"
                  value={privacyPolicyUrl}
                  onChange={(event) => setPrivacyPolicyUrl(event.target.value)}
                  className={inputClass}
                  placeholder={copy.design.privacyPlaceholder}
                  maxLength={2000}
                  inputMode="url"
                  autoCapitalize="none"
                />
              </label>
              <label>
                <FieldLabel>{copy.design.transparencyUrl}</FieldLabel>
                <input
                  name="aiTransparencyUrl"
                  type="url"
                  value={aiTransparencyUrl}
                  onChange={(event) => setAiTransparencyUrl(event.target.value)}
                  className={inputClass}
                  placeholder={copy.design.transparencyPlaceholder}
                  maxLength={2000}
                  inputMode="url"
                  autoCapitalize="none"
                />
              </label>
            </div>
          </section>

          {state.settingsMessageCode && state.settingsMessageCode !== "designSaved" ? (
            <p role="alert" className="brand-radius bg-[#fdf0ee] p-3 text-xs text-[#a94339]">
              {message}
            </p>
          ) : null}
          {state.settingsMessageCode === "designSaved" ? (
            <p className="brand-radius bg-[#e9f8f6] p-3 text-xs text-[#167e74]">
              {message}
            </p>
          ) : null}
          <Button
            type="submit"
            disabled={!hydrated || pending || currentSignature === savedSignature}
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {pending ? copy.common.saving : copy.design.save}
          </Button>
        </div>
      </section>

      <aside className="panel h-fit overflow-hidden lg:sticky lg:top-24">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8ebee] px-4 py-3">
          <div>
            <p className="text-xs font-bold text-[#243444]">{copy.design.preview}</p>
            <p className="text-[10px] text-[#7a8690]">
              {previewMode === "dashboard" ? copy.design.memberArea : copy.design.loginPreview}
            </p>
          </div>
          <div
            className="brand-radius flex border border-[#dce1e5] bg-[#f5f7f8] p-0.5"
            role="group"
            aria-label={copy.design.previewMode}
          >
            <button
              type="button"
              onClick={() => setPreviewMode("dashboard")}
              className={`focus-ring brand-radius flex h-7 items-center gap-1.5 px-2 text-[10px] font-semibold ${
                previewMode === "dashboard"
                  ? "bg-white text-[#243444] shadow-sm"
                  : "text-[#74818c]"
              }`}
              aria-pressed={previewMode === "dashboard"}
            >
              <LayoutDashboard className="size-3" /> {copy.design.dashboard}
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode("login")}
              className={`focus-ring brand-radius flex h-7 items-center gap-1.5 px-2 text-[10px] font-semibold ${
                previewMode === "login"
                  ? "bg-white text-[#243444] shadow-sm"
                  : "text-[#74818c]"
              }`}
              aria-pressed={previewMode === "login"}
            >
              <LogIn className="size-3" /> {copy.design.loginMode}
            </button>
          </div>
        </div>
        <div className="bg-[#eef1f3] p-5">
          {previewMode === "dashboard" ? (
            <div className="brand-radius overflow-hidden border border-[#d5dbe0] bg-white shadow-lg">
              <div className="flex h-12 items-center border-b border-[#edf0f2] px-3">
                {previewLightLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Previewing a validated same-origin asset or compatible legacy logo.
                  <img
                    src={previewLightLogo}
                    alt={copy.design.logoPreview}
                    className="h-7 w-auto max-w-24 object-contain object-left"
                  />
                ) : (
                  <span className="brand-radius grid size-7 place-items-center bg-[var(--brand-primary)] text-xs font-bold text-white">
                    {previewBranding.logoMark}
                  </span>
                )}
                <span className="ml-2 max-w-40 truncate text-xs font-bold text-[var(--brand-primary)]">
                  {platformName || copy.design.academyFallback}
                </span>
                <Smartphone className="ml-auto size-4 text-[#8a949d]" />
              </div>
              <div className="p-4">
                <div className="brand-radius bg-[var(--brand-primary)] p-4 text-white">
                  <p className="text-[9px] text-white/70">{copy.design.welcomeBack}</p>
                  <p className="mt-1 text-sm font-bold">{copy.design.learningPath}</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/20">
                    <div className="h-full w-2/3 rounded-full bg-[var(--brand-accent)]" />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="brand-radius h-20 bg-[#edf3f7] p-2">
                    <div className="h-2 w-12 rounded bg-[var(--brand-primary)] opacity-25" />
                    <div className="mt-2 h-2 w-20 rounded bg-[var(--brand-primary)] opacity-10" />
                  </div>
                  <div className="brand-radius h-20 bg-[#f6f2e9] p-2">
                    <div className="h-2 w-12 rounded bg-[var(--brand-accent)] opacity-35" />
                    <div className="mt-2 h-2 w-20 rounded bg-[var(--brand-accent)] opacity-15" />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div
              className="brand-radius relative min-h-[360px] overflow-hidden border border-[#d5dbe0] shadow-lg"
              style={{ backgroundColor: loginBackgroundColor }}
            >
              <div className="absolute inset-0 opacity-45">
                {/* eslint-disable-next-line @next/next/no-img-element -- Previewing a validated tenant-managed HTTP(S) asset. */}
                <img
                  src={
                    previewBranding.loginBackgroundUrl ??
                    "/images/courses/workflows.webp"
                  }
                  alt={copy.design.backgroundPreview}
                  className="size-full object-cover"
                />
              </div>
              <div className="absolute inset-0 bg-[#0f263c]/25" />
              <div className="relative m-4 flex min-h-[328px] flex-col bg-white p-4 shadow-lg">
                <div className="flex items-center gap-2">
                  {previewLightLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Previewing a validated same-origin asset or compatible legacy logo.
                    <img
                      src={previewLightLogo}
                      alt={copy.design.logoPreview}
                      className="h-7 w-auto max-w-24 object-contain object-left"
                    />
                  ) : (
                    <span className="brand-radius grid size-7 place-items-center bg-[var(--brand-primary)] text-xs font-bold text-white">
                      {previewBranding.logoMark}
                    </span>
                  )}
                  <span className="max-w-48 truncate text-xs font-bold text-[var(--brand-primary)]">
                    {platformName || copy.design.academyFallback}
                  </span>
                </div>
                <div className="my-auto py-5">
                  <p className="text-[8px] font-bold uppercase text-[var(--theme-teal-text)]">
                    {loginEyebrow || copy.design.welcomeFallback}
                  </p>
                  <p className="mt-1 text-lg font-bold leading-tight text-[#17212b]">
                    {loginTitle || copy.design.signInFallback}
                  </p>
                  <p className="mt-1.5 line-clamp-3 text-[9px] leading-4 text-[#66727f]">
                    {loginDescription}
                  </p>
                  <div className="mt-4 space-y-2">
                    <div className="brand-radius h-8 border border-[#dce1e5] bg-[#fafbfb]" />
                    <div className="brand-radius h-8 border border-[#dce1e5] bg-[#fafbfb]" />
                    <div className="brand-radius h-8 bg-[var(--brand-accent)]" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </form>
  );
}

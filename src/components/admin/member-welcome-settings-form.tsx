"use client";

import { useActionState, useMemo, useState } from "react";
import {
  CircleUserRound,
  ImagePlus,
  LoaderCircle,
  MessageSquareText,
  PlayCircle,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  updateMemberWelcomeSettingsAction,
  type MemberWelcomeSettingsActionState,
} from "@/lib/member-welcome-actions";
import type { MemberWelcomeSettingsView } from "@/lib/member-welcome-model";
import { getSettingsAdminCopy } from "@/lib/i18n/settings-admin";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";

const initialState: MemberWelcomeSettingsActionState = {};
const inputClassName =
  "focus-ring brand-radius h-10 w-full border border-[#dce1e5] bg-white px-3 text-sm text-[#243444] placeholder:text-[var(--theme-muted-text)]";

function Toggle({
  name,
  label,
  description,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 border-t border-[#edf0f2] py-4 first:border-t-0">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="focus-ring mt-0.5 size-4 accent-[var(--brand-accent)]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[#243444]">
          {label}
        </span>
        <span className="mt-0.5 block text-xs leading-5 text-[#71808b]">
          {description}
        </span>
      </span>
    </label>
  );
}

export function MemberWelcomeSettingsForm({
  defaults,
  locale,
}: {
  defaults: MemberWelcomeSettingsView;
  locale: AppLocale;
}) {
  const copy = getSettingsAdminCopy(locale);
  const [dirty, setDirty] = useState(false);
  const [enabled, setEnabled] = useState(defaults.enabled);
  const [title, setTitle] = useState(defaults.title);
  const [welcomeText, setWelcomeText] = useState(defaults.welcomeText);
  const [videoUrl, setVideoUrl] = useState(defaults.videoUrl ?? "");
  const [promptProfileImage, setPromptProfileImage] = useState(
    defaults.promptProfileImage,
  );
  const [promptProfileCompletion, setPromptProfileCompletion] = useState(
    defaults.promptProfileCompletion,
  );
  const [state, action, pending] = useActionState(
    async (previous: MemberWelcomeSettingsActionState, formData: FormData) => {
      const result = await updateMemberWelcomeSettingsAction(previous, formData);
      if (result.code === "welcomeSaved" || result.code === "noChanges") {
        setDirty(false);
      }
      return result;
    },
    initialState,
  );
  const previewVideoUrl = useMemo(() => {
    try {
      const parsed = new URL(videoUrl);
      return parsed.protocol === "https:" ? parsed.toString() : null;
    } catch {
      return null;
    }
  }, [videoUrl]);
  const displayedVersion = state.version ?? defaults.version;
  const formattedVersion = new Intl.NumberFormat(intlLocale(locale)).format(displayedVersion);
  const message = state.code
    ? state.code === "welcomeSaved"
      ? copy.messages.welcomeSaved(formattedVersion)
      : copy.messages[state.code]
    : "";

  return (
    <form
      id="willkommen"
      action={action}
      onReset={(event) => event.preventDefault()}
      className="scroll-mt-24 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]"
    >
      <section className="panel overflow-hidden">
        <header className="flex flex-col gap-4 border-b border-[#edf0f2] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <MessageSquareText className="size-4 text-[var(--brand-accent)]" />
              <h2 className="text-base font-bold text-[#243444]">
                {copy.welcome.title}
              </h2>
            </div>
            <p className="mt-1 text-xs leading-5 text-[#6c7882]">
              {copy.welcome.description}
            </p>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-semibold text-[#52606d]">
            <input
              type="checkbox"
              name="enabled"
              checked={enabled}
              onChange={(event) => { setEnabled(event.target.checked); setDirty(true); }}
              className="focus-ring size-4 accent-[var(--brand-accent)]"
            />
            {copy.common.active}
          </label>
        </header>

        <div className="space-y-5 p-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.welcome.titleLabel}
            </span>
            <input
              name="title"
              value={title}
              onChange={(event) => { setTitle(event.target.value); setDirty(true); }}
              minLength={1}
              maxLength={160}
              required
              className={inputClassName}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.welcome.textLabel}
            </span>
            <textarea
              name="welcomeText"
              value={welcomeText}
              onChange={(event) => { setWelcomeText(event.target.value); setDirty(true); }}
              minLength={1}
              maxLength={5000}
              required
              className="focus-ring brand-radius min-h-32 w-full resize-y border border-[#dce1e5] bg-white p-3 text-sm leading-6 text-[#243444]"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#52606d]">
              <PlayCircle className="size-3.5" /> {copy.welcome.videoUrl}
            </span>
            <input
              name="videoUrl"
              type="url"
              inputMode="url"
              value={videoUrl}
              onChange={(event) => { setVideoUrl(event.target.value); setDirty(true); }}
              maxLength={2000}
              placeholder={copy.welcome.videoPlaceholder}
              className={inputClassName}
            />
            <span className="mt-1.5 block text-[11px] leading-4 text-[#7b8791]">
              {copy.welcome.videoHint}
            </span>
          </label>

          <div className="border-y border-[#edf0f2]">
            <Toggle
              name="promptProfileImage"
              label={copy.welcome.profileImage}
              description={copy.welcome.profileImageHint}
              checked={promptProfileImage}
              onChange={(checked) => { setPromptProfileImage(checked); setDirty(true); }}
            />
            <Toggle
              name="promptProfileCompletion"
              label={copy.welcome.profileCompletion}
              description={copy.welcome.profileCompletionHint}
              checked={promptProfileCompletion}
              onChange={(checked) => { setPromptProfileCompletion(checked); setDirty(true); }}
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div aria-live="polite" className="min-h-5 text-xs">
              {state.code === "welcomeInvalid" || state.code === "welcomeVideoInvalid" || state.code === "welcomeFailed" ? (
                <span role="alert" className="text-[#a94339]">
                  {message}
                </span>
              ) : state.code === "welcomeSaved" || state.code === "noChanges" ? (
                <span className="text-[#167e74]">{message}</span>
              ) : (
                <span className="text-[#7b8791]">
                  {displayedVersion > 0
                    ? copy.welcome.version(formattedVersion)
                    : copy.welcome.notConfigured}
                </span>
              )}
            </div>
            <Button type="submit" disabled={pending || !dirty}>
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {pending ? copy.common.saving : copy.welcome.save}
            </Button>
          </div>
        </div>
      </section>

      <aside className="panel h-fit overflow-hidden lg:sticky lg:top-24">
        <div className="border-b border-[#edf0f2] px-4 py-3">
          <p className="text-xs font-bold text-[#243444]">{copy.welcome.preview}</p>
          <p className="mt-0.5 text-[10px] text-[#7a8690]">
            {copy.welcome.memberView}
          </p>
        </div>
        {previewVideoUrl ? (
          <video
            key={previewVideoUrl}
            src={previewVideoUrl}
            controls
            preload="metadata"
            className="aspect-video w-full bg-black object-contain"
          />
        ) : (
          <div className="grid aspect-video place-items-center bg-[#eef3f5] text-[#81909a]">
            <PlayCircle className="size-8" aria-hidden="true" />
          </div>
        )}
        <div className="p-5">
          <p className="text-[10px] font-bold uppercase text-[#2b9188]">
            {copy.welcome.previewEyebrow}
          </p>
          <h3 className="mt-2 text-lg font-bold text-[#243444]">
            {title || copy.welcome.previewTitle}
          </h3>
          <p className="mt-2 whitespace-pre-line text-xs leading-5 text-[#65727d]">
            {welcomeText || copy.welcome.previewText}
          </p>
          {promptProfileImage || promptProfileCompletion ? (
            <div className="mt-4 flex flex-wrap gap-3 text-[#52606d]">
              {promptProfileImage ? (
                <span className="flex items-center gap-1 text-[11px]">
                  <ImagePlus className="size-3.5" /> {copy.welcome.profileImageShort}
                </span>
              ) : null}
              {promptProfileCompletion ? (
                <span className="flex items-center gap-1 text-[11px]">
                  <CircleUserRound className="size-3.5" /> {copy.welcome.profileShort}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
    </form>
  );
}

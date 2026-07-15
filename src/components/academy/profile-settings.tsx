"use client";

import {
  Fingerprint,
  KeyRound,
  Laptop,
  LoaderCircle,
  LogOut,
  Save,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { ImageAssetUploadField } from "@/components/media/image-asset-upload-field";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  changeOwnPasswordAction,
  revokeOwnSessionAction,
  updateOwnProfileAction,
  updateOwnNotificationPreferencesAction,
  type ProfileActionState,
} from "@/lib/profile-actions";
import {
  type NotificationPreferenceDto,
} from "@/lib/notification-preference-model";
import { getMemberExperienceCopy } from "@/lib/i18n/member-experience";
import type { AppLocale } from "@/lib/i18n/model";
import { cn, formatDateTime } from "@/lib/utils";

type ProfileUser = {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string | null;
  department: string | null;
  phone: string | null;
  bio: string | null;
  avatarUrl: string | null;
  avatarAssetId: string | null;
};

type SessionRow = {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastSeenAt: Date;
  expiresAt: Date;
  createdAt: Date;
  authenticatedAt: Date;
  authMethod: "password" | "oidc";
  current: boolean;
};

type SsoAccount = {
  displayName: string;
  identityEmail: string | null;
  lastLoginAt: Date | null;
  currentAuthMethod: "password" | "oidc" | null;
  authenticatedAt: Date | null;
};

const initialState: ProfileActionState = { ok: null, message: "" };
const inputClassName =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444]";
const labelClassName = "mb-1.5 block text-xs font-semibold text-[#52606d]";

function ActionMessage({ state }: { state: ProfileActionState }) {
  if (!state.message) return null;
  return (
    <p
      aria-live="polite"
      className={`rounded-md p-3 text-xs ${state.ok ? "bg-[#e9f8f6] text-[#167e74]" : "bg-[#fdf0ee] text-[#a94339]"}`}
    >
      {state.message}
    </p>
  );
}

function deviceLabel(
  userAgent: string | null,
  copy: ReturnType<typeof getMemberExperienceCopy>["profile"],
) {
  if (!userAgent) return copy.unknownDevice;
  const browser = userAgent.includes("Edg/")
    ? "Edge"
    : userAgent.includes("Firefox/")
      ? "Firefox"
      : userAgent.includes("Chrome/")
        ? "Chrome"
        : userAgent.includes("Safari/")
          ? "Safari"
          : "Browser";
  const device = /Android|iPhone|Mobile/i.test(userAgent)
    ? copy.mobile
    : copy.desktop;
  return copy.browserOnDevice(browser, device);
}

export function ProfileDetailsForm({
  user,
  locale,
  communityRequiredFields = [],
}: {
  user: ProfileUser;
  locale: AppLocale;
  communityRequiredFields?: string[];
}) {
  const copy = getMemberExperienceCopy(locale).profile;
  const [state, action, pending] = useActionState(updateOwnProfileAction, initialState);
  const [avatarSource, setAvatarSource] = useState(user.avatarUrl);
  const communityRequired = new Set(communityRequiredFields);
  const requiredMarker = (
    <span className="ml-1.5 text-[9px] font-bold text-[#9b6415]">
      {copy.communityRequired}
    </span>
  );
  return (
    <form action={action} className="panel overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-[#e8ebee] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {avatarSource?.startsWith("blob:") ? (
            <span className="size-11 overflow-hidden rounded-full bg-[#eef3f9]">
              {/* eslint-disable-next-line @next/next/no-img-element -- Local object URL for the file selected in this browser. */}
              <img
                src={avatarSource}
                alt={copy.avatarPreview}
                className="size-full object-cover"
              />
            </span>
          ) : (
            <Avatar
              firstName={user.firstName}
              lastName={user.lastName}
              src={avatarSource}
              size="lg"
            />
          )}
          <div>
            <h2 className="text-base font-bold text-[#243444]">{copy.personalDetails}</h2>
            <p className="mt-0.5 text-xs text-[#71808b]">{user.email}</p>
          </div>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          {copy.saveProfile}
        </Button>
      </header>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <label>
          <span className={labelClassName}>{copy.firstName}</span>
          <input name="firstName" required maxLength={100} defaultValue={user.firstName} className={inputClassName} />
        </label>
        <label>
          <span className={labelClassName}>{copy.lastName}</span>
          <input name="lastName" required maxLength={100} defaultValue={user.lastName} className={inputClassName} />
        </label>
        <label
          id="community-field-job_title"
          className={cn(
            communityRequired.has("job_title") &&
              "rounded-md border border-[#edcf9f] bg-[#fffaf1] p-3",
          )}
        >
          <span className={labelClassName}>
            {copy.jobTitle}
            {communityRequired.has("job_title") ? requiredMarker : null}
          </span>
          <input name="jobTitle" maxLength={180} required={communityRequired.has("job_title")} defaultValue={user.jobTitle ?? ""} className={inputClassName} />
        </label>
        <label
          id="community-field-department"
          className={cn(
            communityRequired.has("department") &&
              "rounded-md border border-[#edcf9f] bg-[#fffaf1] p-3",
          )}
        >
          <span className={labelClassName}>
            {copy.department}
            {communityRequired.has("department") ? requiredMarker : null}
          </span>
          <input name="department" maxLength={120} required={communityRequired.has("department")} defaultValue={user.department ?? ""} className={inputClassName} />
        </label>
        <label>
          <span className={labelClassName}>{copy.phone}</span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={64}
            placeholder={copy.phonePlaceholder}
            defaultValue={user.phone ?? ""}
            className={inputClassName}
          />
        </label>
        <div
          id="community-field-avatar"
          className={cn(
            "sm:col-span-2",
            communityRequired.has("avatar") &&
              "rounded-md border border-[#edcf9f] bg-[#fffaf1] p-3",
          )}
        >
          {communityRequired.has("avatar") ? (
            <p className="mb-2 text-[9px] font-bold text-[#9b6415]">
              {copy.communityRequired}
            </p>
          ) : null}
          <ImageAssetUploadField
            name="avatarAssetId"
            label={copy.avatar}
            locale={locale}
            purpose="avatar"
            initialAssetId={user.avatarAssetId}
            initialSource={user.avatarUrl}
            disabled={pending}
            previewClassName="rounded-full"
            onSourceChange={setAvatarSource}
          />
        </div>
        <label
          id="community-field-bio"
          className={cn(
            "sm:col-span-2",
            communityRequired.has("bio") &&
              "rounded-md border border-[#edcf9f] bg-[#fffaf1] p-3",
          )}
        >
          <span className={labelClassName}>
            {copy.bio}
            {communityRequired.has("bio") ? requiredMarker : null}
          </span>
          <textarea
            name="bio"
            required={communityRequired.has("bio")}
            maxLength={5000}
            defaultValue={user.bio ?? ""}
            className="focus-ring min-h-28 w-full resize-y rounded-md border border-[#dce1e5] bg-white p-3 text-sm text-[#243444]"
          />
        </label>
        <div className="sm:col-span-2">
          <ActionMessage state={state} />
        </div>
      </div>
    </form>
  );
}

export function NotificationPreferencesForm({
  preferences,
  locale,
}: {
  preferences: NotificationPreferenceDto[];
  locale: AppLocale;
}) {
  const copy = getMemberExperienceCopy(locale).profile;
  const [state, action, pending] = useActionState(
    updateOwnNotificationPreferencesAction,
    initialState,
  );
  return (
    <form action={action} className="panel overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-[#e8ebee] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-[#243444]">{copy.notifications}</h2>
          <p className="mt-0.5 text-xs text-[#71808b]">
            {copy.notificationHelp}
          </p>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          {copy.saveNotifications}
        </Button>
      </header>
      <fieldset className="p-5">
        <legend className="sr-only">{copy.deliveryChannels}</legend>
        <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_3.5rem] items-center gap-x-2 text-center text-[10px] font-bold uppercase text-[#71808b] sm:grid-cols-[minmax(12rem,1fr)_5rem_5rem_5rem]">
          <span className="text-left">{copy.category}</span>
          <span>{copy.inApp}</span>
          <span>{copy.email}</span>
          <span>{copy.push}</span>
          {preferences.map((preference) => (
            <div key={preference.category} className="contents">
              <span className="min-w-0 border-t border-[#edf0f2] py-3 pr-2 text-left text-xs font-semibold normal-case text-[#344454]">
                {copy.notificationCategories[preference.category]}
              </span>
              <label className="grid min-h-11 place-items-center border-t border-[#edf0f2]">
                <span className="sr-only">{copy.channelLabel(copy.notificationCategories[preference.category], copy.inApp)}</span>
                <input type="checkbox" checked disabled className="size-4 accent-[#2b9188]" />
              </label>
              <label className="grid min-h-11 place-items-center border-t border-[#edf0f2]">
                <span className="sr-only">{copy.channelLabel(copy.notificationCategories[preference.category], copy.email)}</span>
                <input
                  type="checkbox"
                  name={`email:${preference.category}`}
                  defaultChecked={preference.emailEnabled}
                  disabled={pending}
                  className="size-4 accent-[#2b9188]"
                />
              </label>
              <label className="grid min-h-11 place-items-center border-t border-[#edf0f2]">
                <span className="sr-only">{copy.channelLabel(copy.notificationCategories[preference.category], copy.push)}</span>
                <input
                  type="checkbox"
                  name={`push:${preference.category}`}
                  defaultChecked={preference.pushEnabled}
                  disabled={pending}
                  className="size-4 accent-[#2b9188]"
                />
              </label>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <ActionMessage state={state} />
        </div>
      </fieldset>
    </form>
  );
}

export function PasswordForm({ locale }: { locale: AppLocale }) {
  const copy = getMemberExperienceCopy(locale).profile;
  const [state, action, pending] = useActionState(changeOwnPasswordAction, initialState);
  return (
    <form action={action} className="panel overflow-hidden">
      <header className="flex items-center gap-3 border-b border-[#e8ebee] px-5 py-4">
        <span className="grid size-9 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]">
          <KeyRound className="size-4" />
        </span>
        <div>
          <h2 className="text-base font-bold text-[#243444]">{copy.password}</h2>
          <p className="mt-0.5 text-xs text-[#71808b]">{copy.passwordHelp}</p>
        </div>
      </header>
      <div className="grid gap-4 p-5">
        <label>
          <span className={labelClassName}>{copy.currentPassword}</span>
          <input name="currentPassword" type="password" autoComplete="current-password" minLength={8} required className={inputClassName} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className={labelClassName}>{copy.newPassword}</span>
            <input name="newPassword" type="password" autoComplete="new-password" minLength={10} maxLength={200} required className={inputClassName} />
          </label>
          <label>
            <span className={labelClassName}>{copy.confirmPassword}</span>
            <input name="confirmation" type="password" autoComplete="new-password" minLength={10} maxLength={200} required className={inputClassName} />
          </label>
        </div>
        <ActionMessage state={state} />
        <div>
          <Button type="submit" variant="navy" disabled={pending}>
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            {copy.changePassword}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function SsoAccountStatus({
  account,
  locale,
}: {
  account: SsoAccount;
  locale: AppLocale;
}) {
  const copy = getMemberExperienceCopy(locale).profile;
  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center gap-3 border-b border-[#e8ebee] px-5 py-4">
        <span className="grid size-9 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]">
          <Fingerprint className="size-4" />
        </span>
        <div>
          <h2 className="text-base font-bold text-[#243444]">{copy.companyLogin}</h2>
          <p className="mt-0.5 text-xs text-[#71808b]">{account.displayName}</p>
        </div>
      </header>
      <dl className="divide-y divide-[#edf0f2] px-5">
        <div className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between">
          <dt className="text-xs font-semibold text-[#52606d]">{copy.loginMode}</dt>
          <dd className="text-sm font-semibold text-[#167e74]">{copy.ssoOnly}</dd>
        </div>
        <div className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between">
          <dt className="text-xs font-semibold text-[#52606d]">{copy.linkedIdentity}</dt>
          <dd className="break-all text-sm text-[#344454]">
            {account.identityEmail ?? copy.noLinkedIdentity}
          </dd>
        </div>
        <div className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between">
          <dt className="text-xs font-semibold text-[#52606d]">{copy.currentSession}</dt>
          <dd className="text-right text-sm text-[#344454]">
            <span className="block font-semibold">
              {account.currentAuthMethod === "oidc"
                ? copy.signedInWithSso
                : copy.existingSession}
            </span>
            {account.authenticatedAt ? (
              <span className="mt-0.5 block text-[10px] text-[#7a8690]">
                {copy.confirmedAt(formatDateTime(account.authenticatedAt, locale))}
              </span>
            ) : null}
          </dd>
        </div>
        {account.lastLoginAt ? (
          <div className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between">
            <dt className="text-xs font-semibold text-[#52606d]">{copy.lastProviderLogin}</dt>
            <dd className="text-sm text-[#344454]">
              {formatDateTime(account.lastLoginAt, locale)}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

export function SessionManager({
  sessions,
  locale,
}: {
  sessions: SessionRow[];
  locale: AppLocale;
}) {
  const copy = getMemberExperienceCopy(locale).profile;
  const [pending, startTransition] = useTransition();
  function revoke(session: SessionRow) {
    startTransition(async () => {
      const result = await revokeOwnSessionAction(session.id);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center gap-3 border-b border-[#e8ebee] px-5 py-4">
        <span className="grid size-9 place-items-center rounded-md bg-[#e9f8f6] text-[#167e74]">
          <Laptop className="size-4" />
        </span>
        <div>
          <h2 className="text-base font-bold text-[#243444]">{copy.activeSessions}</h2>
          <p className="mt-0.5 text-xs text-[#71808b]">{copy.signedInDevices(sessions.length)}</p>
        </div>
      </header>
      <div className="divide-y divide-[#edf0f2]">
        {sessions.map((session) => {
          const mobile = /Android|iPhone|Mobile/i.test(session.userAgent ?? "");
          const Icon = mobile ? Smartphone : Laptop;
          return (
            <div key={session.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#f1f4f6] text-[#52606d]">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-[#354555]">{deviceLabel(session.userAgent, copy)}</p>
                  {session.current ? (
                    <span className="rounded bg-[#e9f8f6] px-2 py-0.5 text-[9px] font-bold uppercase text-[#167e74]">{copy.current}</span>
                  ) : null}
                  <span className="rounded bg-[#eef3f9] px-2 py-0.5 text-[9px] font-bold uppercase text-[#365f8d]">
                    {session.authMethod === "oidc" ? "SSO" : copy.passwordMethod}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-[#7a8690]">
                  {session.ipAddress ?? copy.ipUnavailable} - {copy.lastSeen(formatDateTime(session.lastSeenAt, locale))}
                </p>
              </div>
              <Button
                variant={session.current ? "danger" : "secondary"}
                size="sm"
                disabled={pending}
                onClick={() => revoke(session)}
              >
                {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
                {session.current ? copy.signOut : copy.endSession}
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

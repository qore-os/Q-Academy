"use client";

import { Award, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import {
  saveBadgeGroupAdminAction,
  saveCommunityBadgeAdminAction,
  setManualCommunityBadgeAdminAction,
  type CommunityBadgeActionState,
} from "@/lib/community-badge-actions";
import type { getCommunityBadgeAdminData } from "@/lib/community-badge-admin";
import {
  getCommunityAdminCopy,
  localizeCommunityAdminAction,
} from "@/lib/i18n/community-admin";
import type { AppLocale } from "@/lib/i18n/model";

type Data = Awaited<ReturnType<typeof getCommunityBadgeAdminData>>;
const initial: CommunityBadgeActionState = { ok: null, message: "" };
const inputClass =
  "h-9 w-full rounded-md border border-[#dfe4e8] bg-white px-2.5 text-xs text-[#344454] outline-none focus:border-[#2b9188]";

function Message({
  state,
  locale,
}: {
  state: CommunityBadgeActionState;
  locale: AppLocale;
}) {
  if (state.ok === null) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-xs text-[#237d73]" : "text-xs text-[#b84e42]"}>
      {localizeCommunityAdminAction(locale, state)}
    </p>
  );
}

function GroupForm({
  group,
  locale,
}: {
  group?: Data["groups"][number];
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale).badge;
  const [state, action, pending] = useActionState(saveBadgeGroupAdminAction, initial);
  return (
    <form action={action} className="grid gap-3 py-3 sm:grid-cols-2 xl:grid-cols-6">
      <input type="hidden" name="id" value={group?.id ?? ""} />
      <input name="name" defaultValue={group?.name ?? ""} placeholder={copy.groupName} required maxLength={160} className={`${inputClass} xl:col-span-2`} />
      <input name="description" defaultValue={group?.description ?? ""} placeholder={copy.description} maxLength={2000} className={`${inputClass} xl:col-span-2`} />
      <select
        name="displayMode"
        defaultValue={group?.displayMode ?? "all"}
        className={inputClass}
        aria-label={`${copy.groups}: ${group?.name ?? copy.groupName}`}
      >
        <option value="all">{copy.displayAll}</option>
        <option value="highest">{copy.displayHighest}</option>
      </select>
      <input name="sortOrder" type="number" min={0} max={1000} defaultValue={group?.sortOrder ?? 0} aria-label={copy.sortOrder} className={inputClass} />
      <label className="flex h-9 items-center gap-2 text-xs font-semibold text-[#52606d]">
        <input name="active" type="checkbox" defaultChecked={group?.active ?? true} className="size-4 accent-[#2b9188]" /> {copy.active}
      </label>
      <div className="flex items-center gap-3 sm:col-span-2 xl:col-span-5">
        <Message state={state} locale={locale} />
        <Button type="submit" size="sm" className="ml-auto" disabled={pending}>
          {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          {copy.save}
        </Button>
      </div>
    </form>
  );
}

function BadgeForm({ badge, groups, locale }: { badge?: Data["badges"][number]; groups: Data["groups"]; locale: AppLocale }) {
  const copy = getCommunityAdminCopy(locale).badge;
  const [state, action, pending] = useActionState(saveCommunityBadgeAdminAction, initial);
  return (
    <form action={action} className="grid gap-3 py-3 sm:grid-cols-2 xl:grid-cols-8">
      <input type="hidden" name="id" value={badge?.id ?? ""} />
      <input name="name" defaultValue={badge?.name ?? ""} placeholder={copy.badgeName} required minLength={2} maxLength={160} className={`${inputClass} xl:col-span-2`} />
      <input name="description" defaultValue={badge?.description ?? ""} placeholder={copy.description} required minLength={3} maxLength={5000} className={`${inputClass} xl:col-span-2`} />
      <select
        name="groupId"
        defaultValue={badge?.groupId ?? ""}
        className={inputClass}
        aria-label={`${copy.groups}: ${badge?.name ?? copy.badgeName}`}
      >
        <option value="">{copy.noGroup}</option>
        {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select>
      <input name="pointsThreshold" type="number" min={0} max={10_000_000} defaultValue={badge?.pointsThreshold ?? ""} placeholder={copy.pointsOptional} className={inputClass} />
      <input name="sortOrder" type="number" min={0} max={1000} defaultValue={badge?.sortOrder ?? 0} aria-label={copy.sortOrder} className={inputClass} />
      <label className="flex h-9 items-center gap-2 text-xs font-semibold text-[#52606d]">
        <input name="color" type="color" defaultValue={badge?.color ?? "#d6a536"} className="size-7 rounded border-0 bg-transparent" aria-label={copy.color} />
        {copy.color}
      </label>
      <input type="hidden" name="icon" value={badge?.icon ?? "award"} />
      <label className="flex h-9 items-center gap-2 text-xs font-semibold text-[#52606d]">
        <input name="active" type="checkbox" defaultChecked={badge?.active ?? true} className="size-4 accent-[#2b9188]" /> {copy.active}
      </label>
      <div className="flex items-center gap-3 sm:col-span-2 xl:col-span-7">
        <Message state={state} locale={locale} />
        <Button type="submit" size="sm" className="ml-auto" disabled={pending}>
          {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          {copy.save}
        </Button>
      </div>
    </form>
  );
}

function AssignmentForm({ data, locale }: { data: Data; locale: AppLocale }) {
  const copy = getCommunityAdminCopy(locale).badge;
  const [state, action, pending] = useActionState(setManualCommunityBadgeAdminAction, initial);
  return (
    <form action={action} className="grid gap-3 py-3 sm:grid-cols-[1fr_1fr_auto]">
      <input type="hidden" name="awarded" value="true" />
      <select
        name="userId"
        required
        className={inputClass}
        defaultValue=""
        aria-label={copy.selectMember}
      >
        <option value="" disabled>{copy.selectMember}</option>
        {data.members.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName} ({member.email})</option>)}
      </select>
      <select
        name="badgeId"
        required
        className={inputClass}
        defaultValue=""
        aria-label={copy.selectBadge}
      >
        <option value="" disabled>{copy.selectBadge}</option>
        {data.badges.filter((badge) => badge.active).map((badge) => <option key={badge.id} value={badge.id}>{badge.name}</option>)}
      </select>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        {copy.award}
      </Button>
      <div className="sm:col-span-3"><Message state={state} locale={locale} /></div>
    </form>
  );
}

function RevokeAward({ award, data, locale }: { award: Data["awards"][number]; data: Data; locale: AppLocale }) {
  const copy = getCommunityAdminCopy(locale).badge;
  const [state, action, pending] = useActionState(setManualCommunityBadgeAdminAction, initial);
  const member = data.members.find((entry) => entry.id === award.userId);
  const badge = data.badges.find((entry) => entry.id === award.badgeId);
  if (!member || !badge) return null;
  const automatic = /^points:[0-9]+$/.test(award.source ?? "");
  return (
    <form action={action} className="flex min-h-10 flex-wrap items-center gap-2 py-2">
      <input type="hidden" name="userId" value={award.userId} />
      <input type="hidden" name="badgeId" value={award.badgeId} />
      <input type="hidden" name="awarded" value="false" />
      <Award className="size-3.5" style={{ color: badge.color }} />
      <span className="text-xs font-semibold text-[#344454]">{badge.name}</span>
      <span className="text-[10px] text-[#71808b]">{member.firstName} {member.lastName}</span>
      {automatic ? <span className="ml-auto text-[10px] text-[#71808b]">{copy.automatic}</span> : (
        <Button type="submit" size="icon" variant="ghost" className="ml-auto" disabled={pending} title={copy.revoke} aria-label={copy.revokeNamed(badge.name)}>
          {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </Button>
      )}
      <Message state={state} locale={locale} />
    </form>
  );
}

export function CommunityBadgeManager({ data, locale }: { data: Data; locale: AppLocale }) {
  const copy = getCommunityAdminCopy(locale).badge;
  return (
    <section className="panel min-w-0 overflow-hidden" aria-labelledby="community-badges-heading">
      <header className="flex items-center gap-2 border-b border-[#e8ebee] px-4 py-3 sm:px-5">
        <Award className="size-4 text-[#b07c14]" />
        <h2 id="community-badges-heading" className="text-sm font-bold text-[#243444]">{copy.heading}</h2>
      </header>
      <div className="divide-y divide-[#e8ebee] px-4 sm:px-5">
        <div>
          <p className="pt-4 text-[11px] font-bold uppercase text-[#71808b]">{copy.groups}</p>
          {data.groups.map((group) => <GroupForm key={group.id} group={group} locale={locale} />)}
          <GroupForm locale={locale} />
        </div>
        <div>
          <p className="pt-4 text-[11px] font-bold uppercase text-[#71808b]">{copy.badges}</p>
          {data.badges.map((badge) => <BadgeForm key={badge.id} badge={badge} groups={data.groups} locale={locale} />)}
          <BadgeForm groups={data.groups} locale={locale} />
        </div>
        <div>
          <p className="pt-4 text-[11px] font-bold uppercase text-[#71808b]">{copy.manualAssignment}</p>
          <AssignmentForm data={data} locale={locale} />
          <div className="divide-y divide-[#edf0f2] pb-3">
            {data.awards.map((award) => <RevokeAward key={award.id} award={award} data={data} locale={locale} />)}
          </div>
        </div>
      </div>
    </section>
  );
}

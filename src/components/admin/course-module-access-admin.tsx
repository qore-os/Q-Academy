"use client";

import { useActionState, useState } from "react";
import {
  Check,
  Clock3,
  LoaderCircle,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  decideCourseModuleAccessRequestAction,
  deleteCourseModuleAccessOverrideAction,
  saveCourseModuleAccessOverrideAction,
  type CourseModuleAccessActionState,
} from "@/lib/course-module-access-actions";
import type {
  CourseModuleAccessOverrideView,
  CourseModuleAccessRequestView,
} from "@/lib/course-module-access-service";
import { PLATFORM_TIME_ZONE } from "@/lib/utils";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";

const initialState: CourseModuleAccessActionState = { ok: null, message: "" };
export type CourseModuleAccessAdminProps = {
  courseId: string;
  moduleId: string;
  moduleTitle: string;
  requests: CourseModuleAccessRequestView[];
  overrides: CourseModuleAccessOverrideView[];
  members: Array<{ id: string; name: string; email: string }>;
  locale: AppLocale;
};

function StateMessage({ state }: { state: CourseModuleAccessActionState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={`text-xs ${state.ok ? "text-[#167e74]" : "text-[#b8493e]"}`}
    >
      {state.message}
    </p>
  );
}

function DecisionForm({
  request,
  decision,
  locale,
}: {
  request: CourseModuleAccessRequestView;
  decision: "approved" | "rejected";
  locale: AppLocale;
}) {
  const copy = getCourseSupportCopy(locale).access;
  const action = decideCourseModuleAccessRequestAction.bind(
    null,
    request.id,
    decision,
  );
  const [state, submit, pending] = useActionState(action, initialState);
  return (
    <form action={submit} className="space-y-2">
      <input type="hidden" name="locale" value={locale} />
      <textarea
        name="decisionNote"
        maxLength={1_000}
        rows={2}
        placeholder={decision === "approved" ? copy.approvalNote : copy.rejectionNote}
        className="focus-ring w-full resize-y rounded-md border border-[#dfe4e8] bg-white p-2 text-xs text-[#243444]"
      />
      {decision === "approved" ? (
        <label className="block text-[11px] font-medium text-[#62717d]">
          {copy.accessUntil}
          <input
            name="expiresAt"
            type="datetime-local"
            className="focus-ring mt-1 block h-9 w-full rounded-md border border-[#dfe4e8] bg-white px-2 text-xs"
          />
        </label>
      ) : null}
      <Button
        type="submit"
        size="sm"
        variant={decision === "approved" ? "primary" : "danger"}
        disabled={pending}
      >
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : decision === "approved" ? (
          <Check className="size-4" />
        ) : (
          <X className="size-4" />
        )}
        {decision === "approved" ? copy.approve : copy.reject}
      </Button>
      <StateMessage state={state} />
    </form>
  );
}

function OverrideDelete({
  override,
  locale,
}: {
  override: CourseModuleAccessOverrideView;
  locale: AppLocale;
}) {
  const copy = getCourseSupportCopy(locale).access;
  const action = deleteCourseModuleAccessOverrideAction.bind(
    null,
    override.courseId,
    override.moduleId,
    override.userId,
  );
  const [state, submit, pending] = useActionState(action, initialState);
  return (
    <form action={submit} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Trash2 className="size-4" />
        )}
        {copy.remove}
      </Button>
      <StateMessage state={state} />
    </form>
  );
}

function ManualOverrideForm({
  courseId,
  moduleId,
  members,
  locale,
}: Pick<CourseModuleAccessAdminProps, "courseId" | "moduleId" | "members" | "locale">) {
  const copy = getCourseSupportCopy(locale).access;
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const action = saveCourseModuleAccessOverrideAction.bind(
    null,
    courseId,
    moduleId,
    memberId,
  );
  const [state, submit, pending] = useActionState(action, initialState);

  if (!members.length) return <p className="text-xs text-[#71808b]">{copy.noLearners}</p>;
  return (
    <form action={submit} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <input type="hidden" name="locale" value={locale} />
      <label className="text-xs font-medium text-[#52616d]">
        {copy.learner}
        <select
          value={memberId}
          onChange={(event) => setMemberId(event.target.value)}
          className="focus-ring mt-1.5 h-10 w-full rounded-md border border-[#dfe4e8] bg-white px-2 text-sm"
        >
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name} ({member.email})
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-[#52616d]">
        {copy.state}
        <select
          name="state"
          defaultValue="available"
          className="focus-ring mt-1.5 h-10 w-full rounded-md border border-[#dfe4e8] bg-white px-2 text-sm"
        >
          <option value="available">{copy.states.available}</option>
          <option value="read_only">{copy.states.read_only}</option>
          <option value="locked">{copy.states.locked}</option>
          <option value="hidden">{copy.states.hidden}</option>
        </select>
      </label>
      <label className="text-xs font-medium text-[#52616d]">
        {copy.expiresAt}
        <input
          name="expiresAt"
          type="datetime-local"
          className="focus-ring mt-1.5 h-10 w-full rounded-md border border-[#dfe4e8] bg-white px-2 text-sm"
        />
      </label>
      <label className="text-xs font-medium text-[#52616d]">
        {copy.reason}
        <input
          name="reason"
          maxLength={500}
          className="focus-ring mt-1.5 h-10 w-full rounded-md border border-[#dfe4e8] bg-white px-3 text-sm"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2 xl:col-span-4">
        <Button type="submit" size="sm" disabled={pending || !memberId}>
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {copy.saveOverride}
        </Button>
        <StateMessage state={state} />
      </div>
    </form>
  );
}

export function CourseModuleAccessAdmin({
  courseId,
  moduleId,
  moduleTitle,
  requests,
  overrides,
  members,
  locale,
}: CourseModuleAccessAdminProps) {
  const copy = getCourseSupportCopy(locale).access;
  const numberFormatter = new Intl.NumberFormat(intlLocale(locale));
  const dateTimeFormatter = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: PLATFORM_TIME_ZONE,
  });
  const pendingRequests = requests.filter((request) => request.status === "pending");
  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e3e7ea] pb-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[#243444]">
            <ShieldCheck className="size-5 text-[#167e74]" />
            {copy.title}
          </h2>
          <p className="mt-1 truncate text-xs text-[#71808b]">{moduleTitle}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#52616d]">
          <Clock3 className="size-4" />
          {copy.openCount(numberFormatter.format(pendingRequests.length))}
        </span>
      </header>

      <div>
        <h3 className="text-sm font-semibold text-[#243444]">{copy.openRequests}</h3>
        {pendingRequests.length ? (
          <div className="mt-3 divide-y divide-[#e5e9ec] border-y border-[#e5e9ec]">
            {pendingRequests.map((request) => (
              <article key={request.id} className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)_minmax(15rem,0.8fr)]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#243444]">
                    {request.memberFirstName} {request.memberLastName}
                  </p>
                  <p className="truncate text-xs text-[#71808b]">{request.memberEmail}</p>
                  <p className="mt-2 text-xs leading-5 text-[#52616d]">
                    {request.message || copy.noMessage}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--theme-muted-text)]">
                    {dateTimeFormatter.format(request.requestedAt)}
                  </p>
                </div>
                <DecisionForm request={request} decision="approved" locale={locale} />
                <DecisionForm request={request} decision="rejected" locale={locale} />
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-[#71808b]">{copy.noRequests}</p>
        )}
      </div>

      <div className="border-t border-[#e3e7ea] pt-5">
        <h3 className="text-sm font-semibold text-[#243444]">{copy.setOverride}</h3>
        <div className="mt-3">
          <ManualOverrideForm courseId={courseId} moduleId={moduleId} members={members} locale={locale} />
        </div>
      </div>

      <div className="border-t border-[#e3e7ea] pt-5">
        <h3 className="text-sm font-semibold text-[#243444]">{copy.activeOverrides}</h3>
        {overrides.length ? (
          <div className="mt-3 divide-y divide-[#e5e9ec] border-y border-[#e5e9ec]">
            {overrides.map((override) => (
              <div key={override.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#243444]">
                    {override.memberFirstName} {override.memberLastName}
                  </p>
                  <p className="text-xs text-[#71808b]">
                    {copy.states[override.state]}
                    {override.expiresAt
                      ? ` ${copy.until(dateTimeFormatter.format(override.expiresAt))}`
                      : ` ${copy.noExpiry}`}
                  </p>
                </div>
                <OverrideDelete override={override} locale={locale} />
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-[#71808b]">{copy.noOverrides}</p>
        )}
      </div>
    </section>
  );
}

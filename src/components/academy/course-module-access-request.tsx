"use client";

import { useActionState } from "react";
import { Clock3, LoaderCircle, LockKeyhole, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  requestCourseModuleAccessAction,
  withdrawCourseModuleAccessRequestAction,
  type CourseModuleAccessActionState,
} from "@/lib/course-module-access-actions";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import type { AppLocale } from "@/lib/i18n/model";

const initialState: CourseModuleAccessActionState = { ok: null, message: "" };

export type CourseModuleAccessRequestProps = {
  courseId: string;
  moduleId: string;
  moduleTitle: string;
  access: {
    state: "available" | "read_only" | "upcoming" | "coming_soon" | "locked" | "hidden";
    listed: boolean;
    requestable: boolean;
    requestStatus: "pending" | "approved" | "rejected" | "cancelled" | null;
  };
  pendingRequest?: { id: string } | null;
  locale: AppLocale;
};

function ResultMessage({ state }: { state: CourseModuleAccessActionState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={`text-xs leading-5 ${state.ok ? "text-[#167e74]" : "text-[#b8493e]"}`}
    >
      {state.message}
    </p>
  );
}

export function CourseModuleAccessRequest({
  courseId,
  moduleId,
  moduleTitle,
  access,
  pendingRequest,
  locale,
}: CourseModuleAccessRequestProps) {
  const copy = getMainPageDictionary(locale).academy.courseDetail;
  const requestAction = requestCourseModuleAccessAction.bind(
    null,
    courseId,
    moduleId,
  );
  const withdrawAction = pendingRequest
    ? withdrawCourseModuleAccessRequestAction.bind(null, pendingRequest.id)
    : null;
  const [requestState, submitRequest, requestPending] = useActionState(
    requestAction,
    initialState,
  );
  const [withdrawState, submitWithdraw, withdrawPending] = useActionState(
    withdrawAction ?? withdrawCourseModuleAccessRequestAction.bind(null, ""),
    initialState,
  );

  if (!access.listed || access.state !== "locked") return null;

  if (access.requestStatus === "pending") {
    return (
      <section className="border-l-2 border-[#d6a536] bg-[#fffbef] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-[#4f4935]">
              <Clock3 className="size-4 shrink-0 text-[#b48616]" />
              {copy.accessRequested}
            </p>
            <p className="mt-1 truncate text-xs text-[#766f5c]">{moduleTitle}</p>
          </div>
          {pendingRequest && withdrawAction ? (
            <form action={submitWithdraw}>
              <Button type="submit" size="sm" variant="secondary" disabled={withdrawPending}>
                {withdrawPending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <X className="size-4" />
                )}
                {copy.withdrawRequest}
              </Button>
            </form>
          ) : null}
        </div>
        <div className="mt-2">
          <ResultMessage state={withdrawState} />
        </div>
      </section>
    );
  }

  if (!access.requestable) return null;

  return (
    <section className="border-l-2 border-[#8fa5b5] bg-[#f7f9fa] px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-[#243444]">
        <LockKeyhole className="size-4 text-[#526b7d]" />
        {copy.requestAccess}
      </div>
      <form action={submitRequest} className="mt-3 space-y-3">
        <label className="block text-xs font-medium text-[#52616d]">
          {copy.message}
          <textarea
            name="message"
            maxLength={1_000}
            rows={3}
            placeholder={copy.requestMessagePlaceholder}
            className="focus-ring mt-1.5 w-full resize-y rounded-md border border-[#d9e0e5] bg-white p-2.5 text-sm text-[#243444]"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={requestPending}>
            {requestPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            {copy.sendRequest}
          </Button>
          <ResultMessage state={requestState} />
        </div>
      </form>
    </section>
  );
}

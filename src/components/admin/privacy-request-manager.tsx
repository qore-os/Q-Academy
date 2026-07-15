"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Clock3,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import {
  createPrivacyRequestOwnerAction,
  type PrivacyOwnerActionState,
} from "@/lib/privacy/owner-actions";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import {
  getPrivacyAdminCopy,
  type PrivacyAdminCopy,
} from "@/lib/i18n/privacy-admin";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

type PrivacyRequestRow = {
  id: string;
  clientRequestId: string;
  type: "access_export" | "erasure";
  status:
    | "received"
    | "identity_verified"
    | "approved"
    | "processing"
    | "blocked"
    | "completed"
    | "rejected"
    | "cancelled"
    | "failed";
  statusReason: string | null;
  dueAt: string;
  createdAt: string;
  updatedAt: string;
  subject: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  } | null;
};

type MemberOption = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
};

const initialState: PrivacyOwnerActionState = { ok: null, message: "" };

const statusTones: Record<
  PrivacyRequestRow["status"],
  "neutral" | "teal" | "coral" | "amber" | "blue" | "navy"
> = {
  received: "blue",
  identity_verified: "navy",
  approved: "teal",
  processing: "blue",
  blocked: "amber",
  completed: "teal",
  rejected: "coral",
  cancelled: "neutral",
  failed: "coral",
};

function NewPrivacyRequestDialog({
  members,
  referenceTime,
  onClose,
  copy,
}: {
  members: MemberOption[];
  referenceTime: string;
  onClose: () => void;
  copy: PrivacyAdminCopy;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    createPrivacyRequestOwnerAction,
    initialState,
  );
  useEffect(() => {
    if (state.ok && state.resourceId) {
      router.push(`/admin/privacy/${state.resourceId}`);
    }
  }, [router, state.ok, state.resourceId]);

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-[#0f263c]/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-request-dialog-title"
    >
      <div className="w-full max-w-xl rounded-md bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e5e9ec] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase text-[#2b9188]">
              {copy.manager.eyebrow}
            </p>
            <h2
              id="privacy-request-dialog-title"
              className="mt-1 text-lg font-bold text-[#243444]"
            >
              {copy.manager.newTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring grid size-9 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3]"
            aria-label={copy.common.closeDialog}
          >
            <X className="size-5" />
          </button>
        </div>
        <form action={action} className="space-y-4 p-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.manager.subject}
            </span>
            <select
              name="subjectUserId"
              required
              defaultValue=""
              className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
            >
              <option value="" disabled>
                {copy.manager.selectMember}
              </option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.lastName}, {member.firstName} / {member.email}
                  {member.status === "active"
                    ? ""
                    : ` / ${copy.memberStatuses[
                        member.status as keyof typeof copy.memberStatuses
                      ] ?? copy.memberStatuses.disabled}`}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.manager.type}
              </span>
              <select
                name="type"
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
              >
                <option value="access_export">{copy.types.access_export}</option>
                <option value="erasure">{copy.types.erasure}</option>
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.manager.externalId}
              </span>
              <input
                name="clientRequestId"
                required
                minLength={4}
                maxLength={180}
                defaultValue={`DSAR-${referenceTime.slice(0, 10)}-`}
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
              />
            </label>
          </div>
          {state.message ? (
            <p
              role="status"
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                state.ok
                  ? "border-[#b9e8e3] bg-[#e9f8f6] text-[#167e74]"
                  : "border-[#f4c8c2] bg-[#fdf0ee] text-[#a9473d]",
              )}
            >
              {state.code
                ? copy.messages[state.code]
                : copy.messages.createFailed}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-4">
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              {copy.common.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {copy.manager.create}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function PrivacyRequestManager({
  requests,
  members,
  referenceTime,
  locale,
}: {
  requests: PrivacyRequestRow[];
  members: MemberOption[];
  referenceTime: string;
  locale: AppLocale;
}) {
  const copy = getPrivacyAdminCopy(locale);
  const localeTag = intlLocale(locale);
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(localeTag),
    [localeTag],
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(localeTag);
    return requests.filter((request) => {
      const subject = request.subject
        ? `${request.subject.firstName} ${request.subject.lastName} ${request.subject.email}`
        : copy.manager.pseudonymized;
      return (
        (type === "all" || request.type === type) &&
        (status === "all" || request.status === status) &&
        (!needle || `${request.clientRequestId} ${subject}`.toLocaleLowerCase(localeTag).includes(needle))
      );
    });
  }, [copy.manager.pseudonymized, localeTag, requests, search, status, type]);

  return (
    <>
      <section className="overflow-hidden rounded-md border border-[#e1e5e8] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#e8ecef] p-4 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8a949d]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={copy.manager.search}
              aria-label={copy.manager.searchAria}
              className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] pl-9 pr-3 text-sm lg:max-w-md"
            />
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
              aria-label={copy.manager.typeFilter}
              className="focus-ring h-10 min-w-40 rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
            >
              <option value="all">{copy.manager.allTypes}</option>
              <option value="access_export">{copy.types.access_export}</option>
              <option value="erasure">{copy.types.erasure}</option>
            </select>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              aria-label={copy.manager.statusFilter}
              className="focus-ring h-10 min-w-40 rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
            >
              <option value="all">{copy.manager.allStatuses}</option>
              {Object.entries(copy.statuses).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
               {copy.manager.newCase}
            </Button>
          </div>
        </div>

        <div
          className="focus-ring overflow-x-auto"
          role="region"
          aria-label={copy.manager.tableRegion}
          tabIndex={0}
        >
          <table className="w-full min-w-[960px] border-collapse text-left">
            <thead className="bg-[#f7f8f9] text-[10px] font-bold uppercase text-[#687582]">
              <tr>
                <th className="px-4 py-3">{copy.manager.columnCase}</th>
                <th className="px-4 py-3">{copy.manager.columnSubject}</th>
                <th className="px-4 py-3">{copy.manager.columnType}</th>
                <th className="px-4 py-3">{copy.manager.columnStatus}</th>
                <th className="px-4 py-3">{copy.manager.columnDue}</th>
                <th className="px-4 py-3">{copy.manager.columnUpdated}</th>
                <th className="w-14 px-4 py-3"><span className="sr-only">{copy.manager.open}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0f2]">
              {filtered.map((request) => {
                const overdue =
                  new Date(request.dueAt).getTime() < new Date(referenceTime).getTime() &&
                  !["completed", "rejected", "cancelled"].includes(request.status);
                return (
                  <tr key={request.id} className="group hover:bg-[#fafbfb]">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/privacy/${request.id}`}
                        className="focus-ring font-mono text-xs font-semibold text-[#17324d] hover:text-[#167e74]"
                      >
                        {request.clientRequestId}
                      </Link>
                      <p className="mt-1 text-[11px] text-[#8a949d]">
                        {formatDateTime(request.createdAt, locale)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-sm text-[#344454]">
                      {request.subject ? (
                        <>
                          <p className="font-semibold text-[#243444]">
                            {request.subject.firstName} {request.subject.lastName}
                          </p>
                          <p className="mt-0.5 text-xs text-[#66727f]">{request.subject.email}</p>
                        </>
                      ) : (
                        <span className="text-[#66727f]">{copy.manager.pseudonymized}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-[#52606d]">
                      {copy.types[request.type]}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTones[request.status]}>{copy.statuses[request.status]}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 text-sm font-semibold",
                          overdue ? "text-[#b84e42]" : "text-[#52606d]",
                        )}
                      >
                        <Clock3 className="size-3.5" />
                        {formatDate(request.dueAt, undefined, locale)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#687582]">
                      {formatDateTime(request.updatedAt, locale)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/privacy/${request.id}`}
                        aria-label={copy.manager.openCase(request.clientRequestId)}
                        className={buttonClassName({ variant: "ghost", size: "icon", className: "size-8" })}
                      >
                        <ArrowRight className="size-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 ? (
          <div className="grid min-h-52 place-items-center px-4 py-10 text-center">
            <div>
              <ShieldCheck className="mx-auto size-7 text-[#8ba6a3]" />
              <p className="mt-3 text-sm font-semibold text-[#344454]">{copy.manager.empty}</p>
            </div>
          </div>
        ) : null}
        <div className="border-t border-[#edf0f2] px-4 py-3 text-xs text-[#66727f]">
          {copy.common.cases(
            numberFormatter.format(filtered.length),
            numberFormatter.format(requests.length),
          )}
        </div>
      </section>
      {createOpen ? (
        <NewPrivacyRequestDialog
          members={members}
          referenceTime={referenceTime}
          onClose={() => setCreateOpen(false)}
          copy={copy}
        />
      ) : null}
    </>
  );
}

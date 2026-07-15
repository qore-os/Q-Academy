"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import {
  Download,
  FileSpreadsheet,
  LoaderCircle,
  Plus,
  Power,
  Search,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  exportMembersCsvAdminAction,
  importMembersCsvAdminAction,
  setMemberStatusAdminAction,
  type MemberImportIssue,
  type MemberImportState,
  type MemberStatusResult,
} from "@/lib/admin/member-actions";
import { createMemberAction, type ActionState } from "@/lib/actions";
import { formatDate } from "@/lib/utils";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import {
  getMainPageDictionary,
  type MainPageDictionary,
} from "@/lib/i18n/main-pages";
import type { AppLocale } from "@/lib/i18n/model";
import {
  getMemberAdminActionCopy,
  type MemberAdminActionCopy,
} from "@/lib/i18n/member-admin-actions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

type MemberRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "owner" | "admin" | "trainer" | "member";
  status: "active" | "invited" | "disabled";
  department: string | null;
  jobTitle: string | null;
  points: number;
  lastLoginAt: Date | null;
  createdAt: Date;
  groupCount: number;
  courseCount: number;
  averageProgress: number;
};

type RoleFilter = "all" | MemberRow["role"];
type StatusFilter = "all" | MemberRow["status"];

const initialInviteState: ActionState = {};
const initialImportState: MemberImportState = { ok: null };
const csvHeader = "email,first_name,last_name,role,status,job_title,department";
const csvTemplate = `${csvHeader}\r\nmax@example.com,Max,Mustermann,member,invited,Product Manager,Produkt\r\n`;

function downloadFile(filename: string, content: string) {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

type MemberCopy = MainPageDictionary["admin"]["members"];

function inviteActionMessage(
  state: ActionState,
  copy: MemberAdminActionCopy,
) {
  switch (state.memberMessageCode) {
    case "inviteInvalid":
      return copy.invite.invalid;
    case "inviteDuplicate":
      return copy.invite.duplicate;
    case "inviteCapacity":
      return state.memberLimit
        ? copy.invite.capacity(state.memberLimit)
        : copy.invite.failed;
    case "inviteCreated":
      return copy.invite.created;
    case "inviteFailed":
    default:
      return copy.invite.failed;
  }
}

function importActionMessage(
  state: MemberImportState,
  copy: MemberAdminActionCopy,
) {
  switch (state.code) {
    case "fileRequired":
      return copy.import.fileRequired;
    case "csvRequired":
      return copy.import.csvRequired;
    case "fileTooLarge":
      return copy.import.fileTooLarge;
    case "invalidFile":
      return copy.import.invalidFile;
    case "invalidHeader":
      return copy.import.invalidHeader(state.expectedHeader ?? csvHeader);
    case "noRows":
      return copy.import.noRows;
    case "tooManyRows":
      return copy.import.tooManyRows(state.limit ?? 250);
    case "parseFailed":
      return copy.import.parseFailed;
    case "complete":
      return state.summary
        ? copy.import.complete(
            state.summary.imported,
            state.summary.skipped,
            state.summary.failed,
          )
        : copy.import.parseFailed;
    default:
      return null;
  }
}

function importIssueMessage(
  issue: MemberImportIssue,
  copy: MemberAdminActionCopy,
) {
  switch (issue.code) {
    case "invalidField":
      return copy.import.invalidField(
        copy.import.fields[issue.field ?? "row"],
      );
    case "capacity":
      return issue.limit
        ? copy.import.capacity(issue.limit)
        : copy.import.recordFailed;
    default:
      return copy.import[issue.code];
  }
}

function memberStatusMessage(
  result: MemberStatusResult,
  copy: MemberAdminActionCopy,
) {
  if (result.ok) {
    return copy.status[result.code](result.memberName);
  }
  if (result.code === "capacity") {
    return result.limit
      ? copy.status.capacity(result.limit)
      : copy.status.failed;
  }
  return copy.status[result.code];
}

function InviteDialog({
  onClose,
  copy,
  actionCopy,
}: {
  onClose: () => void;
  copy: MemberCopy;
  actionCopy: MemberAdminActionCopy;
}) {
  const [state, action, pending] = useActionState(
    createMemberAction,
    initialInviteState,
  );
  const message =
    state.error || state.success
      ? inviteActionMessage(state, actionCopy)
      : null;

  useEffect(() => {
    if (state.error && message) toast.error(message);
    if (state.success && message) toast.success(message);
  }, [message, state.error, state.success]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, pending]);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-[#0f263c]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-member-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        className="my-4 flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col rounded-md bg-white shadow-2xl"
        data-testid="invite-member-panel"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#e8ebee] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase text-[#2b9188]">
              {copy.management}
            </p>
            <h2
              id="invite-member-title"
              className="mt-0.5 text-lg font-bold text-[#243444]"
            >
              {copy.invite}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={pending}
            className="focus-ring grid size-9 place-items-center rounded-md hover:bg-[#edf1f3] disabled:opacity-50"
            aria-label={copy.closeDialog}
          >
            <X className="size-5" />
          </button>
        </div>
        <form
          action={action}
          className="grid min-h-0 gap-4 overflow-y-auto p-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.firstName}
              </span>
              <input
                name="firstName"
                autoFocus
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
                required
              />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.lastName}
              </span>
              <input
                name="lastName"
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
                required
              />
            </label>
          </div>
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.email}
            </span>
            <input
              name="email"
              type="email"
              className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
              required
            />
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.department}
            </span>
            <input
              name="department"
              className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
              placeholder={copy.departmentPlaceholder}
            />
          </label>
          {state.error ? (
            <p
              className="rounded-md bg-[#fdf0ee] p-3 text-xs text-[#a94339]"
              aria-live="polite"
            >
              {message}
            </p>
          ) : null}
          {state.success ? (
            <p
              className="rounded-md bg-[#e9f8f6] p-3 text-xs text-[#167e74]"
              aria-live="polite"
            >
              {message}
              {state.inviteLink ? (
                <a
                  href={state.inviteLink}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block break-all font-semibold underline"
                >
                  {copy.openInviteLink}
                </a>
              ) : null}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={pending}
            >
              {copy.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {pending ? copy.creating : copy.createInvitation}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ImportDialog({
  onClose,
  copy,
  actionCopy,
}: {
  onClose: () => void;
  copy: MemberCopy;
  actionCopy: MemberAdminActionCopy;
}) {
  const [fileName, setFileName] = useState("");
  const [state, action, pending] = useActionState(
    importMembersCsvAdminAction,
    initialImportState,
  );
  const message = importActionMessage(state, actionCopy);

  useEffect(() => {
    if (state.ok === null || !message) return;
    if (!state.summary) {
      toast.error(message);
    } else if (state.summary.failed > 0 || state.summary.skipped > 0) {
      toast.warning(message);
    } else {
      toast.success(message);
    }
  }, [message, state.ok, state.summary]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, pending]);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-[#0f263c]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-members-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div className="my-4 w-full max-w-2xl rounded-md bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e8ebee] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase text-[#2b9188]">
              {copy.management}
            </p>
            <h2
              id="import-members-title"
              className="mt-0.5 text-lg font-bold text-[#243444]"
            >
              {copy.importMembers}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={pending}
            className="focus-ring grid size-9 place-items-center rounded-md hover:bg-[#edf1f3] disabled:opacity-50"
            aria-label={copy.closeDialog}
          >
            <X className="size-5" />
          </button>
        </div>

        <form action={action} className="grid min-h-0 gap-4 overflow-y-auto p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.csvFile}
              </span>
              <input
                id="member-csv-file"
                name="file"
                type="file"
                accept=".csv,text/csv"
                className="peer sr-only"
                onChange={(event) =>
                  setFileName(event.currentTarget.files?.[0]?.name ?? "")
                }
                required
              />
              <label
                htmlFor="member-csv-file"
                className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-md border border-[#dce1e5] bg-white px-3 text-xs font-semibold text-[#243444] hover:bg-[#f7f9fa] peer-focus-visible:ring-2 peer-focus-visible:ring-[#2bb7a9]/35 peer-focus-visible:ring-offset-2"
              >
                <Upload aria-hidden="true" className="size-4 shrink-0 text-[#2b9188]" />
                <span className="min-w-0 truncate">
                  {fileName || copy.chooseCsv}
                </span>
              </label>
              <p className="mt-1 text-[10px] text-[#7a8690]" aria-live="polite">
                {fileName ? copy.fileSelected : copy.noFileSelected}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                downloadFile("mitglieder-vorlage.csv", csvTemplate)
              }
            >
              <FileSpreadsheet className="size-4" />
              {copy.csvTemplate}
            </Button>
          </div>

          {message ? (
            <p
              className={`rounded-md p-3 text-xs ${
                state.summary && state.summary.failed === 0
                  ? "bg-[#e9f8f6] text-[#167e74]"
                  : "bg-[#fdf0ee] text-[#a94339]"
              }`}
              aria-live="polite"
            >
              {message}
            </p>
          ) : null}

          {state.summary ? (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  [copy.total, state.summary.total],
                  [copy.invited, state.summary.imported],
                  [copy.skipped, state.summary.skipped],
                  [copy.errors, state.summary.failed],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-md border border-[#e1e5e8] px-3 py-2.5"
                  >
                    <p className="text-[10px] font-bold uppercase text-[#7c8790]">
                      {label}
                    </p>
                    <p className="mt-1 text-lg font-bold text-[#243444]">
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              {state.summary.issues.length > 0 ? (
                <div className="max-h-56 overflow-auto rounded-md border border-[#e1e5e8]">
                  <table className="w-full min-w-[520px] text-left">
                    <thead className="sticky top-0 bg-[#f7f8f9] text-[10px] font-bold uppercase text-[#7c8790]">
                      <tr>
                        <th className="px-3 py-2">{copy.row}</th>
                        <th className="px-3 py-2">{copy.email}</th>
                        <th className="px-3 py-2">{copy.notice}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#edf0f2]">
                      {state.summary.issues.map((issue, index) => (
                        <tr key={`${issue.row}-${issue.email}-${index}`}>
                          <td className="px-3 py-2 text-xs font-semibold text-[#354555]">
                            {issue.row}
                          </td>
                          <td className="px-3 py-2 text-xs text-[#52606d]">
                            {issue.email}
                          </td>
                          <td className="px-3 py-2 text-xs text-[#66727f]">
                            {importIssueMessage(issue, actionCopy)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={pending}
            >
              {copy.close}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {pending ? copy.importing : copy.importCsv}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function MemberTable({
  members,
  canManageMembers,
  currentUserId,
  locale,
}: {
  members: MemberRow[];
  canManageMembers: boolean;
  currentUserId: string;
  locale: AppLocale;
}) {
  const dictionary = getMainPageDictionary(locale);
  const copy = dictionary.admin.members;
  const actionCopy = getMemberAdminActionCopy(locale);
  const roleCopy = getCoreDictionary(locale).navigation.roles;
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportPending, startExport] = useTransition();
  const [statusPending, startStatusChange] = useTransition();
  const [statusPendingId, setStatusPendingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return members.filter((member) => {
      const matchesSearch =
        `${member.firstName} ${member.lastName} ${member.email} ${member.department ?? ""} ${member.jobTitle ?? ""}`
          .toLowerCase()
          .includes(normalizedSearch);
      return (
        matchesSearch &&
        (roleFilter === "all" || member.role === roleFilter) &&
        (statusFilter === "all" || member.status === statusFilter)
      );
    });
  }, [members, roleFilter, search, statusFilter]);

  const exportMembers = () => {
    startExport(async () => {
      try {
        const result = await exportMembersCsvAdminAction();
        if (!result.ok) {
          toast.error(copy.exportFailed);
          return;
        }
        downloadFile(result.filename, result.csv);
        toast.success(copy.exported(members.length));
      } catch {
        toast.error(copy.exportFailed);
      }
    });
  };

  const changeStatus = (member: MemberRow) => {
    const targetStatus = member.status === "disabled" ? "active" : "disabled";
    setStatusPendingId(member.id);
    startStatusChange(async () => {
      try {
        const result = await setMemberStatusAdminAction(
          member.id,
          targetStatus,
        );
        const message = memberStatusMessage(result, actionCopy);
        if (result.ok) toast.success(message);
        else toast.error(message);
      } catch {
        toast.error(copy.statusFailed);
      } finally {
        setStatusPendingId(null);
      }
    });
  };

  return (
    <>
      <div className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#e8ebee] p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#84909a]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="focus-ring h-10 w-full rounded-md border border-[#dfe4e8] bg-[#f8f9fa] pl-9 pr-3 text-sm"
                placeholder={copy.search(members.length)}
              />
            </div>
            <select
              value={roleFilter}
              onChange={(event) =>
                setRoleFilter(event.target.value as RoleFilter)
              }
              className="focus-ring h-10 min-w-36 rounded-md border border-[#dfe4e8] bg-white px-3 text-xs font-semibold text-[#52606d]"
              aria-label={copy.roleFilter}
            >
              <option value="all">{copy.allRoles}</option>
              <option value="owner">{roleCopy.owner}</option>
              <option value="admin">{roleCopy.admin}</option>
              <option value="trainer">{roleCopy.trainer}</option>
              <option value="member">{roleCopy.member}</option>
            </select>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
              className="focus-ring h-10 min-w-36 rounded-md border border-[#dfe4e8] bg-white px-3 text-xs font-semibold text-[#52606d]"
              aria-label={copy.statusFilter}
            >
              <option value="all">{copy.allStatuses}</option>
              <option value="active">{copy.active}</option>
              <option value="invited">{copy.invited}</option>
              <option value="disabled">{copy.disabled}</option>
            </select>
          </div>
          {canManageMembers ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={exportMembers}
                disabled={exportPending}
              >
                {exportPending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                {copy.export}
              </Button>
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <Upload className="size-4" />
                {copy.import}
              </Button>
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus className="size-4" />
                {copy.invite}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="table-scroll overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-left">
            <thead>
              <tr className="bg-[#f7f8f9] text-[10px] font-bold uppercase text-[#7c8790]">
                <th className="px-4 py-3">{copy.member}</th>
                <th className="px-4 py-3">{copy.area}</th>
                <th className="px-4 py-3">{copy.role}</th>
                <th className="px-4 py-3">{copy.access}</th>
                <th className="px-4 py-3">{copy.average}</th>
                <th className="px-4 py-3">{copy.lastLogin}</th>
                <th className="px-4 py-3">{copy.status}</th>
                {canManageMembers ? (
                  <th className="px-4 py-3 text-right">{copy.action}</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0f2]">
              {filtered.map((member) => (
                <tr key={member.id} className="hover:bg-[#fafbfb]">
                  <td className="px-4 py-3">
                    {canManageMembers ? (
                      <Link
                        href={`/admin/members/${member.id}`}
                        className="focus-ring group flex w-fit max-w-full items-center gap-3 rounded-md"
                      >
                        <Avatar
                          firstName={member.firstName}
                          lastName={member.lastName}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-[#2b3a48] group-hover:text-[#167e74]">
                            {member.firstName} {member.lastName}
                          </span>
                          <span className="mt-0.5 block max-w-56 truncate text-[11px] text-[#7a8690]">
                            {member.email}
                          </span>
                        </span>
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3">
                        <Avatar
                          firstName={member.firstName}
                          lastName={member.lastName}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#2b3a48]">
                            {member.firstName} {member.lastName}
                          </p>
                          <p className="mt-0.5 max-w-56 truncate text-[11px] text-[#7a8690]">
                            {member.email}
                          </p>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs font-medium text-[#52606d]">
                      {member.department ?? "-"}
                    </p>
                    <p className="mt-0.5 max-w-40 truncate text-[10px] text-[#8a949d]">
                      {member.jobTitle ?? "-"}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={
                        member.role === "owner" || member.role === "admin"
                          ? "blue"
                          : member.role === "trainer"
                            ? "amber"
                            : "neutral"
                      }
                    >
                      {roleCopy[member.role]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#52606d]">
                    {member.courseCount} {copy.courses} | {member.groupCount} {copy.groups}
                  </td>
                  <td className="w-40 px-4 py-3">
                    <Progress value={member.averageProgress} />
                  </td>
                  <td className="px-4 py-3 text-xs text-[#66727f]">
                    {member.lastLoginAt
                      ? formatDate(member.lastLoginAt, {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })
                      : copy.never}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={
                        member.status === "active"
                          ? "teal"
                          : member.status === "invited"
                            ? "amber"
                            : "coral"
                      }
                    >
                      {member.status === "active"
                        ? copy.active
                        : member.status === "invited"
                          ? copy.invited
                          : copy.disabled}
                    </Badge>
                  </td>
                  {canManageMembers ? (
                    <td className="px-4 py-3 text-right">
                      {member.role === "owner" ||
                      member.id === currentUserId ? (
                        <span className="text-[10px] font-semibold text-[#8a949d]">
                          {member.id === currentUserId
                            ? copy.currentAccess
                            : copy.protected}
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          className={
                            member.status === "disabled"
                              ? undefined
                              : "text-[#a94339]"
                          }
                          onClick={() => changeStatus(member)}
                          disabled={statusPending}
                          aria-label={`${member.firstName} ${member.lastName} ${member.status === "disabled" ? copy.enable : copy.disable}`}
                        >
                          {statusPendingId === member.id ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <Power className="size-3.5" />
                          )}
                          {member.status === "disabled"
                            ? copy.enable
                            : copy.disable}
                        </Button>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={canManageMembers ? 8 : 7}
                    className="px-4 py-12 text-center text-sm text-[#7a8690]"
                  >
                    {copy.noResults}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-[#edf0f2] px-4 py-3 text-xs text-[#7a8690]">
          <span>
            {copy.entries(filtered.length, members.length)}
          </span>
          <span>{copy.page}</span>
        </div>
      </div>
      {inviteOpen ? (
        <InviteDialog
          onClose={() => setInviteOpen(false)}
          copy={copy}
          actionCopy={actionCopy}
        />
      ) : null}
      {importOpen ? (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          copy={copy}
          actionCopy={actionCopy}
        />
      ) : null}
    </>
  );
}

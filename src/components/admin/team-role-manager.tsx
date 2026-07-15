"use client";

import { useActionState } from "react";
import {
  LoaderCircle,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  UserRoundCog,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  assignTeamRoleAdminAction,
  createTeamRoleAdminAction,
  deleteTeamRoleAdminAction,
  unassignTeamRoleAdminAction,
  updateTeamRoleAdminAction,
  type TeamRoleActionState,
} from "@/lib/admin/team-role-actions";
import {
  TEAM_PERMISSION_DETAILS,
  type TeamPermissionKey,
} from "@/lib/team-permission-policy";
import type { AppLocale } from "@/lib/i18n/model";
import {
  getTeamPermissionCopy,
  getTeamRoleCopy,
  resolveTeamRoleMessage,
} from "@/lib/i18n/team-roles";

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  permissions: string[];
  active: boolean;
  revision: number;
  assignmentCount: number;
};

type StaffRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "admin" | "trainer";
};

const initialState: TeamRoleActionState = { ok: null, message: "" };
const inputClass =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444]";

function ActionMessage({
  state,
  locale,
}: {
  state: TeamRoleActionState;
  locale: AppLocale;
}) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`rounded-md p-3 text-xs ${
        state.ok
          ? "bg-[#e9f8f6] text-[#167e74]"
          : "bg-[#fdf0ee] text-[#a94339]"
      }`}
    >
      {resolveTeamRoleMessage(locale, state.messageCode)}
    </p>
  );
}

function PermissionGrid({
  selected,
  locale,
}: {
  selected: readonly string[];
  locale: AppLocale;
}) {
  const groups = [...new Set(TEAM_PERMISSION_DETAILS.map((item) => item.group))];
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {groups.map((group) => (
        <fieldset key={group} className="rounded-md border border-[#e1e5e8] p-3">
          <legend className="px-1 text-xs font-bold text-[#354555]">
            {getTeamPermissionCopy(
              locale,
              TEAM_PERMISSION_DETAILS.find((item) => item.group === group)!.key,
            ).group}
          </legend>
          <div className="space-y-2">
            {TEAM_PERMISSION_DETAILS.filter((item) => item.group === group).map(
              (item) => {
                const itemCopy = getTeamPermissionCopy(locale, item.key);
                return (
                <label key={item.key} className="flex items-start gap-2 text-xs text-[#52606d]">
                  <input
                    type="checkbox"
                    name="permissions"
                    value={item.key}
                    defaultChecked={selected.includes(item.key)}
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span>
                    <span className="block font-semibold text-[#354555]">{itemCopy.label}</span>
                    <span className="mt-0.5 block leading-4">{itemCopy.description}</span>
                    <code className="mt-1 block text-[9px] text-[#7a8691]">{item.key}</code>
                  </span>
                </label>
                );
              },
            )}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function CreateRoleForm({ locale }: { locale: AppLocale }) {
  const copy = getTeamRoleCopy(locale).manager;
  const [state, action, pending] = useActionState(
    createTeamRoleAdminAction,
    initialState,
  );
  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center gap-3 border-b border-[#e8ebee] px-5 py-4">
        <span className="grid size-9 place-items-center rounded-md bg-[#e9f8f6] text-[#167e74]">
          <Plus className="size-4" />
        </span>
        <div>
          <h2 className="text-base font-bold text-[#243444]">{copy.createTitle}</h2>
          <p className="mt-0.5 text-xs text-[#71808b]">{copy.createDescription}</p>
        </div>
      </header>
      <form action={action} className="space-y-5 p-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_100px]">
          <label className="text-xs font-semibold text-[#52606d]">
            {copy.name}
            <input name="name" required minLength={2} maxLength={80} className={`${inputClass} mt-1.5`} />
          </label>
          <label className="text-xs font-semibold text-[#52606d]">
            {copy.description}
            <input name="description" maxLength={500} className={`${inputClass} mt-1.5`} />
          </label>
          <label className="text-xs font-semibold text-[#52606d]">
            {copy.color}
            <input name="color" type="color" defaultValue="#2b9188" className="focus-ring mt-1.5 h-10 w-full rounded-md border border-[#dce1e5] bg-white p-1" />
          </label>
        </div>
        <PermissionGrid selected={[]} locale={locale} />
        <ActionMessage state={state} locale={locale} />
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {copy.create}
        </Button>
      </form>
    </section>
  );
}

function RoleEditor({ role, locale }: { role: RoleRow; locale: AppLocale }) {
  const copy = getTeamRoleCopy(locale).manager;
  const [updateState, updateAction, updating] = useActionState(
    updateTeamRoleAdminAction,
    initialState,
  );
  const [deleteState, deleteAction, deleting] = useActionState(
    deleteTeamRoleAdminAction,
    initialState,
  );
  return (
    <article className="panel overflow-hidden">
      <form action={updateAction}>
        <input type="hidden" name="roleId" value={role.id} />
        <input type="hidden" name="revision" value={role.revision} />
        <input type="hidden" name="active" value="false" />
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8ebee] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="size-4 rounded border border-black/10" style={{ backgroundColor: role.color }} aria-hidden="true" />
            <div>
              <h3 className="text-sm font-bold text-[#243444]">{role.name}</h3>
              <p className="text-[10px] text-[#71808b]">
                {copy.assignmentsAndRevision(role.assignmentCount, role.revision)}
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-[#52606d]">
            <input type="checkbox" name="active" value="true" defaultChecked={role.active} className="size-4" />
            {copy.active}
          </label>
        </header>
        <div className="space-y-5 p-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_100px]">
            <label className="text-xs font-semibold text-[#52606d]">{copy.name}<input name="name" defaultValue={role.name} required className={`${inputClass} mt-1.5`} /></label>
            <label className="text-xs font-semibold text-[#52606d]">{copy.description}<input name="description" defaultValue={role.description ?? ""} className={`${inputClass} mt-1.5`} /></label>
            <label className="text-xs font-semibold text-[#52606d]">{copy.color}<input name="color" type="color" defaultValue={role.color} className="focus-ring mt-1.5 h-10 w-full rounded-md border border-[#dce1e5] bg-white p-1" /></label>
          </div>
          <PermissionGrid selected={role.permissions as TeamPermissionKey[]} locale={locale} />
          <ActionMessage state={updateState} locale={locale} />
          <Button type="submit" disabled={updating}>
            {updating ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            {copy.save}
          </Button>
        </div>
      </form>
      <form action={deleteAction} className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e8ebee] px-5 py-3">
        <input type="hidden" name="roleId" value={role.id} />
        <ActionMessage state={deleteState} locale={locale} />
        <Button type="submit" variant="danger" size="sm" disabled={deleting || role.assignmentCount > 0} title={role.assignmentCount > 0 ? copy.removeAssignmentsFirst : copy.deleteRole}>
          {deleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          {copy.delete}
        </Button>
      </form>
    </article>
  );
}

function StaffAssignment({
  staff,
  roles,
  assignedRoleId,
  locale,
}: {
  staff: StaffRow;
  roles: RoleRow[];
  assignedRoleId?: string;
  locale: AppLocale;
}) {
  const copy = getTeamRoleCopy(locale).manager;
  const [assignState, assignAction, assigning] = useActionState(assignTeamRoleAdminAction, initialState);
  const [removeState, removeAction, removing] = useActionState(unassignTeamRoleAdminAction, initialState);
  return (
    <div className="grid gap-3 border-b border-[#edf0f2] px-5 py-4 last:border-0 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,0.8fr)_auto] lg:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[#243444]">{staff.firstName} {staff.lastName}</p>
        <p className="truncate text-xs text-[#71808b]">
          {staff.email} | {staff.role === "admin" ? copy.administrator : copy.trainer}
        </p>
      </div>
      <form action={assignAction} className="flex gap-2">
        <input type="hidden" name="userId" value={staff.id} />
        <select name="roleId" defaultValue={assignedRoleId ?? ""} required className={inputClass}>
          <option value="" disabled>{copy.selectRole}</option>
          {roles.filter((role) => role.active).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
        </select>
        <Button type="submit" size="icon" disabled={assigning} aria-label={copy.assignRole} title={copy.assignRole}>
          {assigning ? <LoaderCircle className="size-4 animate-spin" /> : <UserRoundCog className="size-4" />}
        </Button>
      </form>
      <div className="flex items-center justify-end gap-2">
        <ActionMessage state={assignState.ok === false ? assignState : removeState} locale={locale} />
        {assignedRoleId ? (
          <form action={removeAction}>
            <input type="hidden" name="userId" value={staff.id} />
            <Button type="submit" variant="secondary" size="icon" disabled={removing} aria-label={copy.removeRole} title={copy.restoreDefaults}>
              {removing ? <LoaderCircle className="size-4 animate-spin" /> : <X className="size-4" />}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export function TeamRoleManager({
  roles,
  assignments,
  staff,
  locale,
}: {
  roles: RoleRow[];
  assignments: Array<{ userId: string; roleId: string }>;
  staff: StaffRow[];
  locale: AppLocale;
}) {
  const copy = getTeamRoleCopy(locale).manager;
  const assignmentByUser = new Map(assignments.map((item) => [item.userId, item.roleId]));
  return (
    <div className="space-y-6">
      <CreateRoleForm locale={locale} />
      <section className="space-y-4" aria-labelledby="existing-team-roles">
        <div className="flex items-center gap-3">
          <ShieldCheck className="size-5 text-[#167e74]" />
          <h2 id="existing-team-roles" className="text-base font-bold text-[#243444]">{copy.existing}</h2>
        </div>
        {roles.length ? roles.map((role) => <RoleEditor key={`${role.id}:${role.revision}`} role={role} locale={locale} />) : <p className="panel p-5 text-sm text-[#71808b]">{copy.noRoles}</p>}
      </section>
      <section className="panel overflow-hidden">
        <header className="flex items-center gap-3 border-b border-[#e8ebee] px-5 py-4">
          <UserRoundCog className="size-5 text-[#167e74]" />
          <div><h2 className="text-base font-bold text-[#243444]">{copy.assignments}</h2><p className="mt-0.5 text-xs text-[#71808b]">{copy.assignmentDescription}</p></div>
        </header>
        {staff.length ? staff.map((member) => <StaffAssignment key={member.id} staff={member} roles={roles} assignedRoleId={assignmentByUser.get(member.id)} locale={locale} />) : <p className="p-5 text-sm text-[#71808b]">{copy.noStaff}</p>}
      </section>
    </div>
  );
}

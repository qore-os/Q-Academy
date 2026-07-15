"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlignLeft,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bot,
  Braces,
  CalendarDays,
  ClipboardList,
  CheckCircle2,
  Code2,
  Copy,
  ExternalLink,
  GripVertical,
  LayoutPanelTop,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  PanelsTopLeft,
  Plus,
  Save,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { HubLayout } from "@/db/schema";
import {
  addHubRowAction,
  deleteHubRowAction,
  deleteHubWidgetAction,
  duplicateHubAction,
  grantHubAccessAction,
  moveHubRowAction,
  moveHubWidgetAction,
  revokeHubAccessAction,
  saveHubWidgetAction,
  updateHubDetailsAction,
  updateHubRowCategoryAction,
  type HubActionResult,
} from "@/lib/hub-actions";
import type { HubAccessSubjectType, HubAdminData } from "@/lib/hub-admin";
import { HUB_CUSTOM_CODE_MAX_LENGTH } from "@/lib/hub-custom-code-policy";
import {
  formatAdminEntityNumber,
  getAdminEntityCopy,
  type AdminEntityCopy,
  type AdminEntityUiKey,
} from "@/lib/i18n/admin-entities";
import { getHubActionMessage } from "@/lib/i18n/hub-actions";
import type { AppLocale } from "@/lib/i18n/model";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type HubWidget = HubLayout[number]["columns"][number];

type WidgetDialogState = {
  rowId: string;
  index: number | null;
  widget?: HubWidget;
};

type DeleteTarget =
  | { kind: "row"; rowId: string; label: string }
  | { kind: "widget"; rowId: string; index: number; label: string };

const initialResult: HubActionResult = { ok: false, code: "idle" };

const inputClassName =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444]";
const textareaClassName =
  "focus-ring min-h-24 w-full resize-y rounded-md border border-[#dce1e5] bg-white p-3 text-sm text-[#243444]";

const widgetTypes = {
  link: { labelKey: "hub.widgetLabels.link", icon: ExternalLink },
  text: { labelKey: "hub.widgetLabels.text", icon: AlignLeft },
  contact: { labelKey: "hub.widgetLabels.contact", icon: UserRound },
  stat: { labelKey: "hub.widgetLabels.stat", icon: BarChart3 },
  event: { labelKey: "hub.widgetLabels.event", icon: CalendarDays },
  data_form: { labelKey: "hub.widgetLabels.data_form", icon: ClipboardList },
  ai_agent: { labelKey: "hub.widgetLabels.ai_agent", icon: Bot },
  embed: { labelKey: "hub.widgetLabels.embed", icon: PanelsTopLeft },
  code: { labelKey: "hub.widgetLabels.code", icon: Code2 },
} as const;

const variableLabelKeys: Readonly<Partial<Record<string, AdminEntityUiKey>>> = {
  "member.firstName": "hub.variable.memberFirstName",
  "member.lastName": "hub.variable.memberLastName",
  "member.fullName": "hub.variable.memberFullName",
  "course.title": "hub.variable.courseTitle",
  "course.progress": "hub.variable.courseProgress",
};

function getVariableLabel(
  variable: HubAdminData["variables"][number],
  copy: AdminEntityCopy,
) {
  const labelKey = variableLabelKeys[variable.token];
  return labelKey ? copy(labelKey) : variable.label;
}

function WidgetDialog({
  hubId,
  state,
  pending,
  onSubmit,
  onClose,
  forms,
  agents,
  variables,
  copy,
}: {
  hubId: string;
  state: WidgetDialogState;
  pending: boolean;
  onSubmit: (formData: FormData) => void;
  onClose: () => void;
  forms: HubAdminData["forms"];
  agents: HubAdminData["agents"];
  variables: HubAdminData["variables"];
  copy: AdminEntityCopy;
}) {
  const editing = state.index !== null;
  const [widgetType, setWidgetType] = useState<HubWidget["type"]>(
    state.widget?.type ?? "link",
  );
  const [title, setTitle] = useState(state.widget?.title ?? "");
  const [description, setDescription] = useState(
    state.widget?.description ?? "",
  );
  const [activeTextField, setActiveTextField] = useState<
    "title" | "description"
  >("description");
  const insertVariable = (token: string) => {
    const insertion = `{{${token}}}`;
    if (activeTextField === "title") {
      setTitle((current) => `${current}${insertion}`.slice(0, 180));
    } else {
      setDescription((current) =>
        `${current}${insertion}`.slice(
          0,
          widgetType === "code" ? HUB_CUSTOM_CODE_MAX_LENGTH : 2_000,
        ),
      );
    }
  };
  const selectedAgentId =
    state.widget?.type === "ai_agent" &&
    agents.some((agent) => agent.id === state.widget?.agentId)
      ? state.widget.agentId
      : (agents[0]?.id ?? "");
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-3 sm:p-5">
      <button
        type="button"
        onClick={onClose}
        disabled={pending}
        className="absolute inset-0 bg-[#0f263c]/50 backdrop-blur-[1px]"
        aria-label={copy("hub.widgetDialogClose")}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={editing ? copy("hub.widgetEdit") : copy("hub.widgetAdd")}
        className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-md bg-white shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e8ebee] bg-white px-5 py-4">
          <div>
            <p className="text-[9px] font-bold uppercase text-[#2b9188]">
              {copy("hub.layout")}
            </p>
            <h2 className="mt-0.5 text-base font-bold text-[#243444]">
              {editing ? copy("hub.widgetEdit") : copy("hub.widgetAdd")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="focus-ring grid size-9 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3]"
            aria-label={copy("hub.widgetDialogClose")}
          >
            <X className="size-4.5" />
          </button>
        </header>
        <form action={onSubmit} className="space-y-4 p-5">
          <input type="hidden" name="hubId" value={hubId} />
          <input type="hidden" name="rowId" value={state.rowId} />
          <input type="hidden" name="widgetIndex" value={state.index ?? -1} />
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy("hub.widgetType")}
            </span>
            <select
              name="type"
              value={widgetType}
              onChange={(event) =>
                setWidgetType(event.target.value as HubWidget["type"])
              }
              className={inputClassName}
            >
              {Object.entries(widgetTypes).map(([value, type]) => (
                <option key={value} value={value}>
                  {copy(type.labelKey)}
                </option>
              ))}
            </select>
          </label>
          {widgetType === "data_form" ? (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy("hub.form")}
              </span>
              <select
                name="formId"
                defaultValue={state.widget?.formId ?? forms[0]?.id ?? ""}
                className={inputClassName}
                required
              >
                {forms.map((form) => (
                  <option key={form.id} value={form.id}>
                    {form.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {widgetType === "ai_agent" ? (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy("hub.agent")}
              </span>
              <select
                name="agentId"
                aria-label={copy("hub.agent")}
                defaultValue={selectedAgentId}
                className={inputClassName}
                required
                disabled={!agents.length}
              >
                {agents.length ? (
                  agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))
                ) : (
                  <option value="">{copy("hub.noAgent")}</option>
                )}
              </select>
            </label>
          ) : null}
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy("common.title")}
            </span>
            <input
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onFocus={() => setActiveTextField("title")}
              maxLength={180}
              required
              autoFocus
              className={inputClassName}
              placeholder={copy("hub.titlePlaceholder")}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {widgetType === "code"
                ? copy("hub.widgetLabels.code")
                : copy("common.description")}
            </span>
            <textarea
              name="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onFocus={() => setActiveTextField("description")}
              maxLength={
                widgetType === "code" ? HUB_CUSTOM_CODE_MAX_LENGTH : 2_000
              }
              required={widgetType === "code"}
              className={cn(
                textareaClassName,
                widgetType === "code" && "min-h-64 font-mono text-xs leading-5",
              )}
              placeholder={
                widgetType === "code"
                  ? copy("hub.codeDescription")
                  : copy("hub.memberContext")
              }
            />
            {widgetType === "code" ? (
              <span className="mt-1.5 block text-[10px] leading-4 text-[#71808b]">
                {copy("hub.codeDescription")}
              </span>
            ) : null}
          </label>
          {widgetType !== "code" ? (
            <div>
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-[#65727e]">
                <Braces className="size-3.5" /> {copy("hub.safeVariables")}
              </p>
              <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                {variables.map((variable) => (
                  <button
                    key={variable.token}
                    type="button"
                    onClick={() => insertVariable(variable.token)}
                    title={getVariableLabel(variable, copy)}
                    className="focus-ring rounded border border-[#d9e1e5] bg-[#f7f9fa] px-2 py-1 font-mono text-[10px] text-[#425464] hover:bg-[#edf2f4]"
                  >
                    {`{{${variable.token}}}`}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {widgetType !== "ai_agent" &&
          widgetType !== "data_form" &&
          widgetType !== "code" ? (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {widgetType === "embed"
                  ? copy("hub.embedUrl")
                  : copy("hub.linkTarget")}
              </span>
              <span className="relative block">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#84909a]" />
                <input
                  name="href"
                  defaultValue={state.widget?.href ?? ""}
                  maxLength={2000}
                  required={widgetType === "embed"}
                  className={cn(inputClassName, "pl-9")}
                  placeholder={
                    widgetType === "embed"
                      ? "https://www.youtube-nocookie.com/embed/..."
                      : copy("hub.linkPlaceholder")
                  }
                />
              </span>
              {widgetType === "embed" ? (
                <span className="mt-1.5 block text-[10px] leading-4 text-[#71808b]">
                  {copy("hub.embedHint")}
                </span>
              ) : null}
            </label>
          ) : null}
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy("common.color")}
            </span>
            <span className="flex h-10 items-center gap-3 rounded-md border border-[#dce1e5] px-2">
              <input
                name="color"
                type="color"
                defaultValue={
                  state.widget?.color?.match(/^#[0-9a-fA-F]{6}$/)
                    ? state.widget.color
                    : "#2bb7a9"
                }
                className="size-7 cursor-pointer border-0 bg-transparent p-0"
              />
              <span className="text-xs text-[#66727f]">
                {copy("hub.widgetAccent")}
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={pending}
            >
              {copy("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                pending ||
                (widgetType === "data_form" && forms.length === 0) ||
                (widgetType === "ai_agent" && agents.length === 0)
              }
            >
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {editing ? copy("hub.widgetSave") : copy("hub.widgetCreate")}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ConfirmDialog({
  target,
  pending,
  onConfirm,
  onClose,
  copy,
}: {
  target: DeleteTarget;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
  copy: AdminEntityCopy;
}) {
  const row = target.kind === "row";
  return (
    <div className="fixed inset-0 z-[85] grid place-items-center p-4">
      <button
        type="button"
        onClick={onClose}
        disabled={pending}
        className="absolute inset-0 bg-[#0f263c]/50"
        aria-label={copy("hub.deleteDialogClose")}
      />
      <section
        role="alertdialog"
        aria-modal="true"
        aria-label={
          row
            ? copy("hub.deleteRowQuestion")
            : copy("hub.deleteWidgetQuestion")
        }
        className="relative w-full max-w-md rounded-md bg-white p-5 shadow-2xl"
      >
        <span className="grid size-10 place-items-center rounded-md bg-[#fdf0ee] text-[#b84e42]">
          <Trash2 className="size-5" />
        </span>
        <h2 className="mt-4 text-base font-bold text-[#243444]">
          {row
            ? copy("hub.deleteRowQuestion")
            : copy("hub.deleteWidgetQuestion")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#66727f]">
          {copy(row ? "hub.deleteRowBody" : "hub.deleteWidgetBody", {
            name: target.label,
          })}
        </p>
        <div className="mt-5 flex justify-end gap-2 border-t border-[#edf0f2] pt-4">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {copy("common.cancel")}
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            {copy("hub.deletePermanently")}
          </Button>
        </div>
      </section>
    </div>
  );
}

export function HubEditor({
  data,
  locale,
}: {
  data: HubAdminData;
  locale: AppLocale;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [widgetDialog, setWidgetDialog] = useState<WidgetDialogState | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [subjectType, setSubjectType] = useState<HubAccessSubjectType>("user");
  const copy = getAdminEntityCopy(locale);
  const clientActionsDisabled = pending || !hydrated;

  const runMutation = (
    mutation: () => Promise<HubActionResult>,
    successKey: AdminEntityUiKey = "hub.changeSaved",
    onSuccess?: (result: HubActionResult) => void,
  ) => {
    startTransition(async () => {
      try {
        const result = await mutation();
        if (!result.ok) {
          toast.error(getHubActionMessage(locale, result.code));
          return;
        }
        toast.success(copy(successKey));
        onSuccess?.(result);
        router.refresh();
      } catch {
        toast.error(copy("common.genericError"));
      }
    });
  };

  const subjectOptions = (
    subjectType === "user"
      ? data.subjects.users
      : subjectType === "group"
        ? data.subjects.groups
        : data.subjects.bundles
  ).filter(
    (subject) =>
      !data.grants.some(
        (grant) =>
          grant.subjectType === subjectType && grant.subjectId === subject.id,
      ),
  );

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    runMutation(
      () =>
        target.kind === "row"
          ? deleteHubRowAction(data.hub.id, target.rowId)
          : deleteHubWidgetAction(data.hub.id, target.rowId, target.index),
      target.kind === "row" ? "hub.rowDeleted" : "hub.widgetDeleted",
      () => setDeleteTarget(null),
    );
  };

  return (
    <div className="space-y-8">
      <section className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0f2] pb-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]">
              <LayoutPanelTop className="size-4.5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-[#243444]">
                {copy("hub.settings")}
              </h2>
              <p className="mt-0.5 text-xs text-[#71808b]">
                {copy("hub.settingsHint")}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              runMutation(
                () => duplicateHubAction(data.hub.id),
                "hub.duplicated",
                (result) => {
                  if (result.resourceId) {
                    router.push(`/admin/hubs/${result.resourceId}`);
                  }
                },
              )
            }
            disabled={clientActionsDisabled}
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Copy className="size-4" />
            )}
            {copy("hub.duplicate")}
          </Button>
        </div>
        <form
          action={(formData) =>
            runMutation(
              () =>
                updateHubDetailsAction(data.hub.id, initialResult, formData),
              "hub.detailsSaved",
            )
          }
          className="mt-5 grid gap-4 lg:grid-cols-2"
        >
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy("common.title")}
            </span>
            <input
              name="title"
              defaultValue={data.hub.title}
              minLength={2}
              maxLength={180}
              required
              className={inputClassName}
            />
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy("common.slug")}
            </span>
            <input
              name="slug"
              defaultValue={data.hub.slug}
              maxLength={140}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              required
              className={inputClassName}
            />
          </label>
          <label className="lg:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy("common.description")}
            </span>
            <textarea
              name="description"
              defaultValue={data.hub.description ?? ""}
              maxLength={5000}
              className={textareaClassName}
            />
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy("common.status")}
            </span>
            <select
              name="status"
              defaultValue={data.hub.status}
              className={inputClassName}
            >
              <option value="draft">{copy("common.draft")}</option>
              <option value="published">{copy("common.published")}</option>
              <option value="archived">{copy("common.archived")}</option>
            </select>
          </label>
          <div className="flex items-end justify-end">
            <Button type="submit" disabled={clientActionsDisabled}>
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {copy("hub.saveSettings")}
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="layout-heading">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase text-[#2b9188]">
              {copy("hub.memberView")}
            </p>
            <h2
              id="layout-heading"
              className="mt-1 text-xl font-bold text-[#243444]"
            >
              {copy("hub.layoutRows")}
            </h2>
            <p className="mt-1 text-xs text-[#71808b]">
              {copy("hub.layoutSummary", {
                rows: formatAdminEntityNumber(data.hub.layout.length, locale),
                widgets: formatAdminEntityNumber(
                  data.hub.layout.reduce(
                    (sum, row) => sum + row.columns.length,
                    0,
                  ),
                  locale,
                ),
              })}
            </p>
          </div>
          <Button
            onClick={() =>
              runMutation(
                () => addHubRowAction(data.hub.id),
                "hub.rowAdded",
              )
            }
            disabled={
              clientActionsDisabled || data.hub.layout.length >= 30
            }
          >
            <Plus className="size-4" />
            {copy("hub.addRow")}
          </Button>
        </div>

        <div className="space-y-4">
          {data.hub.layout.map((row, rowIndex) => (
            <section
              key={row.id}
              aria-label={copy("hub.layoutRow", {
                count: formatAdminEntityNumber(rowIndex + 1, locale),
              })}
              className="border-y border-[#e1e5e8] bg-white"
            >
              <header className="flex flex-wrap items-center justify-between gap-3 bg-[#f7f8f9] px-4 py-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <GripVertical className="size-4 text-[#9aa3aa]" />
                  <div className="min-w-0">
                    <h3 className="text-xs font-bold text-[#354555]">
                      {copy("hub.row", {
                        count: formatAdminEntityNumber(rowIndex + 1, locale),
                      })}
                    </h3>
                    <p className="text-[9px] text-[#84909a]">
                      {copy("common.widgetCount", {
                        count: formatAdminEntityNumber(
                          row.columns.length,
                          locale,
                        ),
                      })}
                    </p>
                  </div>
                  <form
                    action={(formData) =>
                      runMutation(
                        () =>
                          updateHubRowCategoryAction(
                            data.hub.id,
                            row.id,
                            formData,
                          ),
                        "hub.categorySaved",
                      )
                    }
                    className="ml-2 flex min-w-0 max-w-sm flex-1 items-center gap-1"
                  >
                    <input
                      name="category"
                      defaultValue={row.category ?? ""}
                      maxLength={80}
                      aria-label={copy("hub.categoryForRow", {
                        count: formatAdminEntityNumber(rowIndex + 1, locale),
                      })}
                      placeholder={copy("hub.categoryPlaceholder")}
                      className="focus-ring h-8 min-w-0 flex-1 rounded-md border border-[#dce1e5] bg-white px-2 text-[10px] text-[#354555]"
                    />
                    <button
                      type="submit"
                      disabled={clientActionsDisabled}
                      className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-[#66727f] hover:bg-white disabled:opacity-35"
                      aria-label={copy("hub.saveCategoryForRow", {
                        count: formatAdminEntityNumber(rowIndex + 1, locale),
                      })}
                      title={copy("hub.saveCategory")}
                    >
                      <Save className="size-3.5" />
                    </button>
                  </form>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      runMutation(
                        () => moveHubRowAction(data.hub.id, row.id, "up"),
                        "hub.rowMoved",
                      )
                    }
                    disabled={clientActionsDisabled || rowIndex === 0}
                    className="focus-ring grid size-8 place-items-center rounded-md text-[#66727f] hover:bg-white disabled:opacity-35"
                    aria-label={copy("hub.moveRowUp", {
                      count: formatAdminEntityNumber(rowIndex + 1, locale),
                    })}
                    title={copy("common.moveUp")}
                  >
                    <ArrowUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      runMutation(
                        () => moveHubRowAction(data.hub.id, row.id, "down"),
                        "hub.rowMoved",
                      )
                    }
                    disabled={
                      clientActionsDisabled ||
                      rowIndex === data.hub.layout.length - 1
                    }
                    className="focus-ring grid size-8 place-items-center rounded-md text-[#66727f] hover:bg-white disabled:opacity-35"
                    aria-label={copy("hub.moveRowDown", {
                      count: formatAdminEntityNumber(rowIndex + 1, locale),
                    })}
                    title={copy("common.moveDown")}
                  >
                    <ArrowDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDeleteTarget({
                        kind: "row",
                        rowId: row.id,
                        label: copy("hub.row", {
                          count: formatAdminEntityNumber(rowIndex + 1, locale),
                        }),
                      })
                    }
                    disabled={clientActionsDisabled}
                    className="focus-ring grid size-8 place-items-center rounded-md text-[#84909a] hover:bg-[#fdf0ee] hover:text-[#b84e42]"
                    aria-label={copy("hub.deleteRow", {
                      count: formatAdminEntityNumber(rowIndex + 1, locale),
                    })}
                    title={copy("hub.deleteRowQuestion")}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </header>
              <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                {row.columns.map((widget, widgetIndex) => {
                  const visual = widgetTypes[widget.type];
                  const Icon = visual.icon;
                  const color = widget.color?.match(/^#[0-9a-fA-F]{6}$/)
                    ? widget.color
                    : "#2bb7a9";
                  return (
                    <article
                      key={`${row.id}-${widgetIndex}-${widget.title}`}
                      className="relative min-w-0 rounded-md border border-[#e1e5e8] bg-white p-4"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className="grid size-9 shrink-0 place-items-center rounded-md"
                          style={{ color, backgroundColor: `${color}18` }}
                        >
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h4 className="truncate text-xs font-bold text-[#354555]">
                              {widget.title}
                            </h4>
                            <Badge tone="neutral">
                              {copy(visual.labelKey)}
                            </Badge>
                          </div>
                          <p className="mt-1 line-clamp-2 min-h-8 text-[10px] leading-4 text-[#71808b]">
                            {widget.description || copy("common.noDescription")}
                          </p>
                          {widget.href ? (
                            <p className="mt-2 truncate text-[9px] text-[#2b9188]">
                              {widget.href}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-3 flex justify-end gap-1 border-t border-[#edf0f2] pt-2">
                        <button
                          type="button"
                          onClick={() =>
                            runMutation(
                              () =>
                                moveHubWidgetAction(
                                  data.hub.id,
                                  row.id,
                                  widgetIndex,
                                  "up",
                                ),
                              "hub.widgetMoved",
                            )
                          }
                          disabled={
                            clientActionsDisabled || widgetIndex === 0
                          }
                          className="focus-ring grid size-7 place-items-center rounded-md text-[#71808b] hover:bg-[#edf1f3] disabled:opacity-35"
                          aria-label={copy("common.moveNamedLeft", {
                            name: widget.title,
                          })}
                          title={copy("common.moveLeft")}
                        >
                          <ArrowLeft className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            runMutation(
                              () =>
                                moveHubWidgetAction(
                                  data.hub.id,
                                  row.id,
                                  widgetIndex,
                                  "down",
                                ),
                              "hub.widgetMoved",
                            )
                          }
                          disabled={
                            clientActionsDisabled ||
                            widgetIndex === row.columns.length - 1
                          }
                          className="focus-ring grid size-7 place-items-center rounded-md text-[#71808b] hover:bg-[#edf1f3] disabled:opacity-35"
                          aria-label={copy("common.moveNamedRight", {
                            name: widget.title,
                          })}
                          title={copy("common.moveRight")}
                        >
                          <ArrowRight className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setWidgetDialog({
                              rowId: row.id,
                              index: widgetIndex,
                              widget,
                            })
                          }
                          disabled={clientActionsDisabled}
                          className="focus-ring grid size-7 place-items-center rounded-md text-[#71808b] hover:bg-[#eef3f9] hover:text-[#365f8d]"
                          aria-label={copy("common.editNamed", {
                            name: widget.title,
                          })}
                          title={copy("common.edit")}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteTarget({
                              kind: "widget",
                              rowId: row.id,
                              index: widgetIndex,
                              label: widget.title,
                            })
                          }
                          disabled={clientActionsDisabled}
                          className="focus-ring grid size-7 place-items-center rounded-md text-[#84909a] hover:bg-[#fdf0ee] hover:text-[#b84e42]"
                          aria-label={copy("common.deleteNamed", {
                            name: widget.title,
                          })}
                          title={copy("common.delete")}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </article>
                  );
                })}
                <button
                  type="button"
                  onClick={() =>
                    setWidgetDialog({ rowId: row.id, index: null })
                  }
                  disabled={
                    clientActionsDisabled || row.columns.length >= 12
                  }
                  className="focus-ring flex min-h-36 items-center justify-center gap-2 rounded-md border border-dashed border-[#cfd6dc] bg-[#fafbfb] text-xs font-semibold text-[#66727f] hover:border-[#9fcfca] hover:bg-[#f1f8f7] disabled:opacity-45"
                >
                  <Plus className="size-4" />
                  {copy("hub.addWidget")}
                </button>
              </div>
            </section>
          ))}
          {!data.hub.layout.length ? (
            <div className="grid min-h-60 place-items-center border-y border-dashed border-[#cfd6dc] bg-white p-8 text-center">
              <div>
                <LayoutPanelTop className="mx-auto size-8 text-[#a2abb3]" />
                <p className="mt-3 text-sm font-semibold text-[#354555]">
                  {copy("hub.emptyRows")}
                </p>
                <Button
                  className="mt-4"
                  onClick={() =>
                    runMutation(
                      () => addHubRowAction(data.hub.id),
                      "hub.rowAdded",
                    )
                  }
                  disabled={clientActionsDisabled}
                >
                  <Plus className="size-4" />
                  {copy("hub.createFirstRow")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section
        className="panel overflow-hidden"
        aria-labelledby="access-heading"
      >
        <header className="flex flex-col gap-3 border-b border-[#e8ebee] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-md bg-[#fbf6e7] text-[#8d6a12]">
              <LockKeyhole className="size-4.5" />
            </span>
            <div>
              <h2
                id="access-heading"
                className="text-base font-bold text-[#243444]"
              >
                {copy("hub.access")}
              </h2>
              <p className="mt-0.5 text-xs text-[#71808b]">
                {data.grants.length
                  ? copy("hub.activeRules", {
                      count: formatAdminEntityNumber(
                        data.grants.length,
                        locale,
                      ),
                    })
                  : copy("hub.noRulesHint")}
              </p>
            </div>
          </div>
          <Badge tone={data.grants.length ? "amber" : "teal"}>
            {data.grants.length
              ? copy("hub.restricted")
              : copy("hub.public")}
          </Badge>
        </header>
        <form
          action={(formData) =>
            runMutation(
              () => grantHubAccessAction(data.hub.id, formData),
              "hub.accessGranted",
            )
          }
          className="grid gap-3 border-b border-[#edf0f2] bg-[#fafbfb] p-4 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-end"
        >
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy("hub.targetType")}
            </span>
            <select
              name="subjectType"
              value={subjectType}
              disabled={!hydrated}
              onChange={(event) =>
                setSubjectType(event.target.value as HubAccessSubjectType)
              }
              className={inputClassName}
            >
              <option value="user">{copy("common.member")}</option>
              <option value="group">{copy("common.group")}</option>
              <option value="bundle">{copy("common.bundle")}</option>
            </select>
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy("hub.target")}
            </span>
            <select
              key={subjectType}
              name="subjectId"
              className={inputClassName}
              required
              disabled={!subjectOptions.length}
            >
              {subjectOptions.length ? (
                subjectOptions.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.label}
                  </option>
                ))
              ) : (
                <option value="">{copy("hub.noTargets")}</option>
              )}
            </select>
          </label>
          <Button
            type="submit"
            disabled={clientActionsDisabled || !subjectOptions.length}
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {copy("hub.addRule")}
          </Button>
        </form>
        <div className="divide-y divide-[#edf0f2]">
          {data.grants.map((grant) => (
            <div
              key={`${grant.subjectType}:${grant.subjectId}`}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#f1f4f5] text-[#52606d]">
                {grant.subjectType === "user" ? (
                  <UserRound className="size-4" />
                ) : (
                  <Users className="size-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-[#354555]">
                  {grant.subjectMissing
                    ? copy("hub.missingTarget")
                    : grant.subjectName}
                </p>
                <p className="mt-0.5 text-[9px] uppercase text-[#84909a]">
                  {grant.subjectType === "user"
                    ? copy("common.member")
                    : grant.subjectType === "group"
                      ? copy("common.group")
                      : copy("common.bundle")}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  runMutation(
                    () =>
                      revokeHubAccessAction(
                        data.hub.id,
                        grant.subjectType,
                        grant.subjectId,
                      ),
                    "hub.accessRevoked",
                  )
                }
                disabled={clientActionsDisabled}
                aria-label={copy("hub.removeAccessNamed", {
                  name: grant.subjectMissing
                    ? copy("hub.missingTarget")
                    : grant.subjectName,
                })}
              >
                <Trash2 className="size-3.5" />
                {copy("common.remove")}
              </Button>
            </div>
          ))}
          {!data.grants.length ? (
            <div className="grid min-h-32 place-items-center p-6 text-center">
              <div>
                <CheckCircle2 className="mx-auto size-6 text-[#2b9188]" />
                <p className="mt-2 text-xs font-semibold text-[#354555]">
                  {copy("hub.allAccess")}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {widgetDialog ? (
        <WidgetDialog
          key={`${widgetDialog.rowId}:${widgetDialog.index ?? "new"}`}
          hubId={data.hub.id}
          state={widgetDialog}
          pending={pending}
          onSubmit={(formData) =>
            runMutation(
              () => saveHubWidgetAction(data.hub.id, formData),
              widgetDialog.index === null
                ? "hub.widgetCreated"
                : "hub.widgetSaved",
              () => setWidgetDialog(null),
            )
          }
          onClose={() => setWidgetDialog(null)}
            forms={data.forms}
            agents={data.agents}
          variables={data.variables}
          copy={copy}
        />
      ) : null}
      {deleteTarget ? (
        <ConfirmDialog
          target={deleteTarget}
          pending={pending}
          onConfirm={confirmDelete}
          onClose={() => setDeleteTarget(null)}
          copy={copy}
        />
      ) : null}
    </div>
  );
}

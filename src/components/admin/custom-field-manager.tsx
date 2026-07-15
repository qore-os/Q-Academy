"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  Braces,
  Check,
  ListPlus,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  createCustomFieldDefinitionAction,
  deleteCustomFieldDefinitionAction,
  setCustomFieldActiveAction,
  updateCustomFieldDefinitionAction,
  type CustomFieldActionCode,
  type CustomFieldActionState,
} from "@/lib/admin/custom-field-actions";
import {
  customFieldTypes,
  type CustomFieldType,
} from "@/lib/custom-fields";
import {
  customFieldVisibilities,
  type CustomFieldVisibility,
} from "@/lib/data-profile-policy";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import {
  getSettingsDataCopy,
  type SettingsDataCopy,
} from "@/lib/i18n/settings-data";
import { useHydrated } from "@/lib/use-hydrated";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type CustomFieldDefinitionView = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  type: CustomFieldType;
  category: string;
  required: boolean;
  visibility: CustomFieldVisibility;
  personalizationEnabled: boolean;
  options: string[];
  active: boolean;
  sortOrder: number;
};

const initialState: CustomFieldActionState = { ok: null, message: "" };

function actionMessage(
  code: CustomFieldActionCode | undefined,
  params: Record<string, string | number> | undefined,
  copy: SettingsDataCopy,
) {
  const count = String(params?.count ?? 0);
  const name = String(params?.name ?? "");
  switch (code) {
    case "fieldDuplicate": return copy.messages.fieldDuplicate;
    case "fieldNotFound": return copy.messages.fieldNotFound;
    case "fieldFormConflict": return copy.messages.fieldFormConflict;
    case "fieldCommunityConflict": return copy.messages.fieldCommunityConflict;
    case "fieldMediaConflict": return copy.messages.fieldMediaConflict;
    case "fieldCreated": return copy.messages.fieldCreated;
    case "fieldSaved": return copy.messages.fieldSaved;
    case "fieldSavedRemoved": return copy.messages.fieldSavedRemoved(count);
    case "fieldActivated": return copy.messages.fieldActivated(name);
    case "fieldDeactivated": return copy.messages.fieldDeactivated(name);
    case "fieldDeleted": return copy.messages.fieldDeleted(name);
    default: return copy.messages.fieldInvalid;
  }
}

function keyFromLabel(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "");
}

function DefinitionDialog({
  field,
  onClose,
  copy,
}: {
  field: CustomFieldDefinitionView | null;
  onClose: () => void;
  copy: SettingsDataCopy;
}) {
  const definitionAction = field
    ? updateCustomFieldDefinitionAction.bind(null, field.id)
    : createCustomFieldDefinitionAction;
  const [state, action, pending] = useActionState(
    definitionAction,
    initialState,
  );
  const [type, setType] = useState<CustomFieldType>(field?.type ?? "text");
  const [visibility, setVisibility] = useState<CustomFieldVisibility>(
    field?.visibility ?? "member",
  );
  const [label, setLabel] = useState(field?.label ?? "");
  const [technicalKey, setTechnicalKey] = useState(field?.key ?? "");
  const [keyEdited, setKeyEdited] = useState(Boolean(field));

  useEffect(() => {
    if (state.ok === true) {
      toast.success(actionMessage(state.code, state.params, copy));
      onClose();
    } else if (state.ok === false) {
      toast.error(actionMessage(state.code, state.params, copy));
    }
  }, [copy, onClose, state]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, pending]);

  const isChoice = type === "select" || type === "multiselect";
  const personalizationAllowed =
    visibility === "member" && type !== "url" && type !== "media";
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-[#0f263c]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-field-dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div className="my-4 w-full max-w-2xl rounded-md bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e8ebee] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase text-[#2b9188]">
              {copy.field.eyebrow}
            </p>
            <h2
              id="custom-field-dialog-title"
              className="mt-0.5 text-lg font-bold text-[#243444]"
            >
              {field ? copy.field.editTitle : copy.field.createTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3] disabled:opacity-50"
            aria-label={copy.common.closeDialog}
            title={copy.common.close}
          >
            <X className="size-5" />
          </button>
        </div>

        <form action={action} className="grid gap-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.field.label}
              </span>
              <input
                name="label"
                value={label}
                onChange={(event) => {
                  const nextLabel = event.target.value;
                  setLabel(nextLabel);
                  if (!keyEdited) setTechnicalKey(keyFromLabel(nextLabel));
                }}
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
                placeholder={copy.field.labelPlaceholder}
                required
                maxLength={180}
              />
            </label>
            <label>
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#52606d]">
                <Braces className="size-3.5" /> {copy.common.technicalKey}
              </span>
              <input
                name="key"
                value={technicalKey}
                onChange={(event) => {
                  setKeyEdited(true);
                  setTechnicalKey(event.target.value.toLowerCase());
                }}
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 font-mono text-xs"
                placeholder={copy.field.keyPlaceholder}
                pattern="[a-z][a-z0-9_]+"
                required
                maxLength={120}
              />
            </label>
          </div>

          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.common.description}
            </span>
            <textarea
              name="description"
              defaultValue={field?.description ?? ""}
              className="focus-ring min-h-20 w-full resize-y rounded-md border border-[#dce1e5] px-3 py-2 text-sm"
              placeholder={copy.field.descriptionPlaceholder}
              maxLength={1_000}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.field.fieldType}
              </span>
              <select
                name="type"
                value={type}
                onChange={(event) =>
                  setType(event.target.value as CustomFieldType)
                }
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
              >
                {customFieldTypes.map((fieldType) => (
                  <option key={fieldType} value={fieldType}>
                    {copy.types[fieldType]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.field.category}
              </span>
              <input
                name="category"
                defaultValue={field?.category ?? copy.field.defaultCategory}
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
                required
                maxLength={120}
              />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.field.visibleFor}
              </span>
              <select
                name="visibility"
                value={visibility}
                onChange={(event) =>
                  setVisibility(event.target.value as CustomFieldVisibility)
                }
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
              >
                {customFieldVisibilities.map((visibility) => (
                  <option key={visibility} value={visibility}>
                    {copy.visibility[visibility]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.common.order}
              </span>
              <input
                name="sortOrder"
                type="number"
                min={0}
                max={9_999}
                step={1}
                defaultValue={field?.sortOrder ?? 0}
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
                required
              />
            </label>
          </div>

          {isChoice ? (
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.field.options}
              </span>
              <textarea
                name="options"
                defaultValue={field?.options.join("\n") ?? ""}
                className="focus-ring min-h-28 w-full resize-y rounded-md border border-[#dce1e5] px-3 py-2 text-sm"
                placeholder={copy.field.optionsPlaceholder}
                required
              />
              <span className="mt-1 block text-[10px] text-[#7a8690]">
                {copy.field.optionsHint}
              </span>
            </label>
          ) : (
            <input type="hidden" name="options" value="" />
          )}

          <div className="grid gap-2 border-y border-[#edf0f2] py-3 sm:grid-cols-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-[#f7f8f9]">
              <input
                name="required"
                type="checkbox"
                defaultChecked={field?.required ?? false}
                className="focus-ring mt-0.5 size-4 accent-[#2bb7a9]"
              />
              <span>
                <strong className="block text-xs text-[#354555]">
                  {copy.field.required}
                </strong>
                <span className="mt-0.5 block text-[10px] leading-4 text-[#7a8690]">
                  {copy.field.requiredHint}
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-[#f7f8f9]">
              <input
                name="personalizationEnabled"
                type="checkbox"
                defaultChecked={
                  personalizationAllowed &&
                  (field?.personalizationEnabled ?? false)
                }
                disabled={!personalizationAllowed}
                className="focus-ring mt-0.5 size-4 accent-[#2bb7a9] disabled:opacity-40"
              />
              <span>
                <strong className="block text-xs text-[#354555]">
                  {copy.field.personalization}
                </strong>
                <span className="mt-0.5 block text-[10px] leading-4 text-[#7a8690]">
                  {copy.field.personalizationHint}
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-[#f7f8f9]">
              <input
                name="active"
                type="checkbox"
                defaultChecked={field?.active ?? true}
                className="focus-ring mt-0.5 size-4 accent-[#2bb7a9]"
              />
              <span>
                <strong className="block text-xs text-[#354555]">{copy.common.active}</strong>
                <span className="mt-0.5 block text-[10px] leading-4 text-[#7a8690]">
                  {copy.field.activeHint}
                </span>
              </span>
            </label>
          </div>

          {state.ok === false ? (
            <p
              className="rounded-md bg-[#fdf0ee] p-3 text-xs text-[#a94339]"
              aria-live="polite"
            >
              {actionMessage(state.code, state.params, copy)}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={pending}
            >
              {copy.common.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {pending
                ? copy.field.saving
                : field
                  ? copy.field.saveChanges
                  : copy.field.createTitle}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteDialog({
  field,
  pending,
  onCancel,
  onConfirm,
  copy,
}: {
  field: CustomFieldDefinitionView;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  copy: SettingsDataCopy;
}) {
  return (
    <div
      className="fixed inset-0 z-[75] grid place-items-center bg-[#0f263c]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-custom-field-title"
    >
      <div className="w-full max-w-md rounded-md bg-white p-5 shadow-2xl">
        <span className="grid size-10 place-items-center rounded-md bg-[#fdf0ee] text-[#b84e42]">
          <Trash2 className="size-5" />
        </span>
        <h2
          id="delete-custom-field-title"
          className="mt-4 text-lg font-bold text-[#243444]"
        >
          {copy.field.deleteTitle}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#66727f]">
          {copy.field.deleteBody(field.label)}
        </p>
        <div className="mt-5 flex justify-end gap-2 border-t border-[#edf0f2] pt-4">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            {copy.common.cancel}
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            {copy.field.deletePermanently}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CustomFieldManager({
  fields,
  locale,
}: {
  fields: CustomFieldDefinitionView[];
  locale: AppLocale;
}) {
  const copy = getSettingsDataCopy(locale);
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(intlLocale(locale)),
    [locale],
  );
  const [dialogField, setDialogField] = useState<
    CustomFieldDefinitionView | null | undefined
  >();
  const [deleteTarget, setDeleteTarget] =
    useState<CustomFieldDefinitionView | null>(null);
  const [mutationPending, startMutation] = useTransition();
  const [pendingFieldId, setPendingFieldId] = useState<string | null>(null);
  const hydrated = useHydrated();
  const activeCount = useMemo(
    () => fields.filter((field) => field.active).length,
    [fields],
  );

  const toggleActive = (field: CustomFieldDefinitionView) => {
    setPendingFieldId(field.id);
    startMutation(async () => {
      try {
        const result = await setCustomFieldActiveAction(
          field.id,
          !field.active,
        );
        if (result.ok) {
          toast.success(actionMessage(result.code, result.params, copy));
        } else {
          toast.error(actionMessage(result.code, result.params, copy));
        }
      } catch {
        toast.error(copy.messages.fieldToggleFailed);
      } finally {
        setPendingFieldId(null);
      }
    });
  };

  const deleteField = () => {
    if (!deleteTarget) return;
    const fieldId = deleteTarget.id;
    setPendingFieldId(fieldId);
    startMutation(async () => {
      try {
        const result = await deleteCustomFieldDefinitionAction(fieldId);
        if (result.ok) {
          toast.success(actionMessage(result.code, result.params, copy));
          setDeleteTarget(null);
        } else {
          toast.error(actionMessage(result.code, result.params, copy));
        }
      } catch {
        toast.error(copy.messages.fieldDeleteFailed);
      } finally {
        setPendingFieldId(null);
      }
    });
  };

  return (
    <section id="profilfelder" className="panel scroll-mt-24 overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[#e8ebee] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-[#243444]">
              {copy.field.managerTitle}
            </h2>
            <Badge tone="neutral">
              {copy.field.activeCount(numberFormatter.format(activeCount))}
            </Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-[#6c7882]">
            {copy.field.managerDescription}
          </p>
        </div>
        <Button onClick={() => setDialogField(null)}>
          <Plus className="size-4" /> {copy.field.createTitle}
        </Button>
      </div>

      {fields.length > 0 ? (
        <>
          <div className="divide-y divide-[#edf0f2] sm:hidden">
            {fields.map((field) => (
              <div key={field.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#2b3a48]">
                      {field.label}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-[#7a8690]">
                      {field.key}
                    </p>
                  </div>
                  <Badge tone="blue" className="shrink-0">
                    {copy.types[field.type]}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge tone="neutral">{field.category}</Badge>
                  {field.required ? (
                    <Badge tone="amber">{copy.field.requiredBadge}</Badge>
                  ) : (
                    <Badge tone="neutral">{copy.field.optionalBadge}</Badge>
                  )}
                  <Badge tone="blue">
                    {copy.visibility[field.visibility]}
                  </Badge>
                  {field.personalizationEnabled ? (
                    <Badge tone="teal">{copy.field.variableBadge}</Badge>
                  ) : null}
                  {field.options.length > 0 ? (
                    <Badge tone="neutral">
                      {copy.common.options(
                        numberFormatter.format(field.options.length),
                      )}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-[#edf0f2] pt-3">
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={field.active}
                      onChange={() => toggleActive(field)}
                      disabled={mutationPending}
                      className="peer sr-only"
                      aria-label={copy.common.toggleNamed(
                        field.label,
                        field.active,
                      )}
                    />
                    <span className="pointer-events-none relative h-5 w-9 rounded-full bg-[#cfd6dc] transition-colors peer-checked:bg-[#2bb7a9] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#2bb7a9] after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4" />
                    <span className="text-[10px] font-semibold text-[#66727f]">
                      {field.active ? copy.common.active : copy.common.inactive}
                    </span>
                    {pendingFieldId === field.id && mutationPending ? (
                      <LoaderCircle className="size-3.5 animate-spin text-[#7a8690]" />
                    ) : null}
                  </label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setDialogField(field)}
                      className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-[#eaf0f4] hover:text-[#17324d]"
                      aria-label={copy.common.editNamed(field.label)}
                      title={copy.common.edit}
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(field)}
                      disabled={!hydrated}
                      className="focus-ring grid size-8 place-items-center rounded-md text-[#a94339] hover:bg-[#fdf0ee]"
                      aria-label={copy.common.deleteNamed(field.label)}
                      title={copy.common.delete}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="table-scroll hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="bg-[#f7f8f9] text-[10px] font-bold uppercase text-[#7c8790]">
                  <th className="px-5 py-3">{copy.field.columnField}</th>
                  <th className="px-5 py-3">{copy.field.columnCategory}</th>
                  <th className="px-5 py-3">{copy.field.columnType}</th>
                  <th className="px-5 py-3">{copy.field.columnProperties}</th>
                  <th className="px-5 py-3">{copy.field.columnActive}</th>
                  <th className="px-5 py-3 text-right">{copy.field.columnActions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf0f2]">
                {fields.map((field) => (
                  <tr key={field.id} className="hover:bg-[#fafbfb]">
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-semibold text-[#2b3a48]">
                        {field.label}
                      </p>
                      <p className="mt-0.5 max-w-sm truncate font-mono text-[10px] text-[#7a8690]">
                        {field.key}
                      </p>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-[#52606d]">
                      {field.category}
                    </td>
                    <td className="px-5 py-3.5">
                      <Badge tone="blue">
                        {copy.types[field.type]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        {field.required ? (
                          <Badge tone="amber">{copy.field.requiredBadge}</Badge>
                        ) : (
                          <Badge tone="neutral">{copy.field.optionalBadge}</Badge>
                        )}
                        <Badge tone="blue">
                          {copy.visibility[field.visibility]}
                        </Badge>
                        {field.personalizationEnabled ? (
                          <Badge tone="teal">{copy.field.variableBadge}</Badge>
                        ) : null}
                        {field.options.length > 0 ? (
                          <Badge tone="neutral">
                            {copy.common.options(
                              numberFormatter.format(field.options.length),
                            )}
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <label className="inline-flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          role="switch"
                          checked={field.active}
                          onChange={() => toggleActive(field)}
                          disabled={mutationPending}
                          className="peer sr-only"
                          aria-label={copy.common.toggleNamed(
                            field.label,
                            field.active,
                          )}
                        />
                        <span className="pointer-events-none relative h-5 w-9 rounded-full bg-[#cfd6dc] transition-colors peer-checked:bg-[#2bb7a9] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#2bb7a9] after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4" />
                        {pendingFieldId === field.id && mutationPending ? (
                          <LoaderCircle className="size-3.5 animate-spin text-[#7a8690]" />
                        ) : null}
                      </label>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setDialogField(field)}
                          className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-[#eaf0f4] hover:text-[#17324d]"
                          aria-label={copy.common.editNamed(field.label)}
                          title={copy.common.edit}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(field)}
                          disabled={!hydrated}
                          className="focus-ring grid size-8 place-items-center rounded-md text-[#a94339] hover:bg-[#fdf0ee]"
                          aria-label={copy.common.deleteNamed(field.label)}
                          title={copy.common.delete}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="grid place-items-center px-5 py-14 text-center">
          <span className="grid size-12 place-items-center rounded-md bg-[#e9f8f6] text-[#167e74]">
            <ListPlus className="size-6" />
          </span>
          <h3 className="mt-4 text-sm font-bold text-[#354555]">
            {copy.field.emptyTitle}
          </h3>
          <p className="mt-1 max-w-md text-xs leading-5 text-[#7a8690]">
            {copy.field.emptyDescription}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-[#edf0f2] px-5 py-3 text-[10px] text-[#7a8690]">
        <Check className="size-3.5 text-[#2b9188]" /> {copy.field.validationHint}
      </div>

      {dialogField !== undefined ? (
        <DefinitionDialog
          field={dialogField}
          onClose={() => setDialogField(undefined)}
          copy={copy}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteDialog
          field={deleteTarget}
          pending={mutationPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={deleteField}
          copy={copy}
        />
      ) : null}
    </section>
  );
}

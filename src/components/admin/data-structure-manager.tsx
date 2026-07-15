"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { Braces, FileText, Layers3, LoaderCircle, Pencil, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import {
  createDataFormAction,
  createDataProfileDefinitionAction,
  setDataFormActiveAction,
  updateDataFormAction,
  updateDataProfileDefinitionAction,
  type DataStructureActionCode,
  type DataStructureActionState,
} from "@/lib/admin/data-structure-actions";
import {
  type CustomFieldVisibility,
} from "@/lib/data-profile-policy";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import {
  getSettingsDataCopy,
  type SettingsDataCopy,
} from "@/lib/i18n/settings-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type FieldOption = {
  id: string;
  label: string;
  category: string;
  visibility: CustomFieldVisibility;
  active: boolean;
};

export type DataProfileDefinitionAdminView = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  allowMemberCreation: boolean;
  active: boolean;
  sortOrder: number;
  fieldIds: string[];
};

export type DataFormAdminView = {
  id: string;
  profileDefinitionId: string;
  key: string;
  name: string;
  description: string | null;
  submitLabel: string;
  active: boolean;
  fieldIds: string[];
};

const initialState: DataStructureActionState = { ok: null, message: "" };

function actionMessage(
  code: DataStructureActionCode | undefined,
  params: Record<string, string | number> | undefined,
  copy: SettingsDataCopy,
) {
  const name = String(params?.name ?? "");
  switch (code) {
    case "definitionFieldInvalid": return copy.messages.definitionFieldInvalid;
    case "definitionDuplicate": return copy.messages.definitionDuplicate;
    case "definitionNotFound": return copy.messages.definitionNotFound;
    case "definitionConflict": return copy.messages.definitionConflict;
    case "definitionCreated": return copy.messages.definitionCreated;
    case "definitionSaved": return copy.messages.definitionSaved;
    case "formInvalid": return copy.messages.formInvalid;
    case "formDefinitionMissing": return copy.messages.formDefinitionMissing;
    case "formFieldsInvalid": return copy.messages.formFieldsInvalid;
    case "formFieldsChanged": return copy.messages.formFieldsChanged;
    case "formDuplicate": return copy.messages.formDuplicate;
    case "formNotFound": return copy.messages.formNotFound;
    case "formReferenced": return copy.messages.formReferenced;
    case "formCreated": return copy.messages.formCreated;
    case "formSaved": return copy.messages.formSaved;
    case "formActivated": return copy.messages.formActivated(name);
    case "formDeactivated": return copy.messages.formDeactivated(name);
    default: return copy.messages.definitionInvalid;
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

function FieldAssignments({
  fields,
  selected,
  copy,
}: {
  fields: FieldOption[];
  selected: string[];
  copy: SettingsDataCopy;
}) {
  const categories = useMemo(() => {
    const result = new Map<string, FieldOption[]>();
    for (const field of fields) {
      const items = result.get(field.category) ?? [];
      items.push(field);
      result.set(field.category, items);
    }
    return [...result.entries()];
  }, [fields]);
  return (
    <fieldset className="max-h-64 overflow-y-auto rounded-md border border-[#dce1e5] p-3">
      <legend className="px-1 text-xs font-semibold text-[#52606d]">
        {copy.structure.profileFields}
      </legend>
      <div className="grid gap-4">
        {categories.map(([category, items]) => (
          <div key={category}>
            <p className="mb-2 text-[10px] font-bold uppercase text-[#2b9188]">
              {category}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((field) => (
                <label
                  key={field.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[#f4f6f7]"
                >
                  <input
                    type="checkbox"
                    name="fieldIds"
                    value={field.id}
                    defaultChecked={selected.includes(field.id)}
                    className="focus-ring size-4 accent-[#2bb7a9]"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-[#354555]">
                    {field.label}
                  </span>
                  <Badge tone="neutral">
                    {copy.visibility[field.visibility]}
                  </Badge>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function DialogFrame({
  title,
  pending,
  onClose,
  children,
  copy,
}: {
  title: string;
  pending: boolean;
  onClose: () => void;
  children: React.ReactNode;
  copy: SettingsDataCopy;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-[#0f263c]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div className="my-4 w-full max-w-2xl rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-[#e8ebee] px-5 py-4">
          <h2 className="text-base font-bold text-[#243444]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3]"
            aria-label={copy.common.closeDialog}
            title={copy.common.close}
          >
            <X className="size-5" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function ProfileDefinitionDialog({
  definition,
  fields,
  onClose,
  copy,
}: {
  definition: DataProfileDefinitionAdminView | null;
  fields: FieldOption[];
  onClose: () => void;
  copy: SettingsDataCopy;
}) {
  const action = definition
    ? updateDataProfileDefinitionAction.bind(null, definition.id)
    : createDataProfileDefinitionAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [name, setName] = useState(definition?.name ?? "");
  const [key, setKey] = useState(definition?.key ?? "");
  const [keyEdited, setKeyEdited] = useState(Boolean(definition));

  useEffect(() => {
    if (state.ok === true) {
      toast.success(actionMessage(state.code, state.params, copy));
      onClose();
    } else if (state.ok === false) {
      toast.error(actionMessage(state.code, state.params, copy));
    }
  }, [copy, onClose, state]);

  return (
    <DialogFrame
      title={definition ? copy.structure.editDefinition : copy.structure.createDefinition}
      pending={pending}
      onClose={onClose}
      copy={copy}
    >
      <form action={formAction} className="grid gap-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.common.name}
            </span>
            <input
              name="name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!keyEdited) setKey(keyFromLabel(event.target.value));
              }}
              className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
              required
            />
          </label>
          <label>
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#52606d]">
              <Braces className="size-3.5" /> {copy.common.technicalKey}
            </span>
            <input
              name="key"
              value={key}
              onChange={(event) => {
                setKeyEdited(true);
                setKey(event.target.value.toLowerCase());
              }}
              disabled={definition?.key === "default"}
              className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 font-mono text-xs disabled:bg-[#f3f5f6]"
              required
            />
            {definition?.key === "default" ? (
              <input type="hidden" name="key" value="default" />
            ) : null}
          </label>
        </div>
        <label>
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.common.description}
          </span>
          <textarea
            name="description"
            defaultValue={definition?.description ?? ""}
            className="focus-ring min-h-20 w-full rounded-md border border-[#dce1e5] px-3 py-2 text-sm"
          />
        </label>
        <FieldAssignments
          fields={fields}
          selected={definition?.fieldIds ?? []}
          copy={copy}
        />
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-xs text-[#52606d]">
            <input
              name="allowMemberCreation"
              type="checkbox"
              defaultChecked={definition?.allowMemberCreation ?? true}
              disabled={definition?.key === "default"}
              className="focus-ring size-4 accent-[#2bb7a9]"
            />
            {copy.structure.allowMemberCreation}
          </label>
          <label className="flex items-center gap-2 text-xs text-[#52606d]">
            <input
              name="active"
              type="checkbox"
              defaultChecked={definition?.active ?? true}
              disabled={definition?.key === "default"}
              className="focus-ring size-4 accent-[#2bb7a9]"
            />
            {copy.common.active}
          </label>
          <label className="flex items-center gap-2 text-xs text-[#52606d]">
            {copy.common.order}
            <input
              name="sortOrder"
              type="number"
              min={0}
              defaultValue={definition?.sortOrder ?? 0}
              className="focus-ring h-9 w-20 rounded-md border border-[#dce1e5] px-2"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {copy.common.cancel}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            {copy.common.save}
          </Button>
        </div>
      </form>
    </DialogFrame>
  );
}

function DataFormDialog({
  form,
  definitions,
  fields,
  onClose,
  copy,
}: {
  form: DataFormAdminView | null;
  definitions: DataProfileDefinitionAdminView[];
  fields: FieldOption[];
  onClose: () => void;
  copy: SettingsDataCopy;
}) {
  const action = form
    ? updateDataFormAction.bind(null, form.id)
    : createDataFormAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [definitionId, setDefinitionId] = useState(
    form?.profileDefinitionId ?? definitions[0]?.id ?? "",
  );
  const [name, setName] = useState(form?.name ?? "");
  const [key, setKey] = useState(form?.key ?? "");
  const [keyEdited, setKeyEdited] = useState(Boolean(form));
  const definition = definitions.find((item) => item.id === definitionId);
  const availableFields = fields.filter(
    (field) =>
      field.visibility === "member" && definition?.fieldIds.includes(field.id),
  );

  useEffect(() => {
    if (state.ok === true) {
      toast.success(actionMessage(state.code, state.params, copy));
      onClose();
    } else if (state.ok === false) {
      toast.error(actionMessage(state.code, state.params, copy));
    }
  }, [copy, onClose, state]);

  return (
    <DialogFrame
      title={form ? copy.structure.editForm : copy.structure.createForm}
      pending={pending}
      onClose={onClose}
      copy={copy}
    >
      <form action={formAction} className="grid gap-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.common.name}
            </span>
            <input
              name="name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!keyEdited) setKey(keyFromLabel(event.target.value));
              }}
              className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
              required
            />
          </label>
          <label>
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#52606d]">
              <Braces className="size-3.5" /> {copy.common.technicalKey}
            </span>
            <input
              name="key"
              value={key}
              onChange={(event) => {
                setKeyEdited(true);
                setKey(event.target.value.toLowerCase());
              }}
              className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 font-mono text-xs"
              required
            />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.structure.profileDefinition}
            </span>
            <select
              name="profileDefinitionId"
              value={definitionId}
              onChange={(event) => setDefinitionId(event.target.value)}
              className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
              required
            >
              {definitions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.structure.buttonLabel}
            </span>
            <input
              name="submitLabel"
              defaultValue={form?.submitLabel ?? copy.structure.defaultSubmitLabel}
              className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
              required
            />
          </label>
        </div>
        <label>
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.common.description}
          </span>
          <textarea
            name="description"
            defaultValue={form?.description ?? ""}
            className="focus-ring min-h-20 w-full rounded-md border border-[#dce1e5] px-3 py-2 text-sm"
          />
        </label>
        <FieldAssignments
          key={definitionId}
          fields={availableFields}
          selected={form?.profileDefinitionId === definitionId ? form.fieldIds : []}
          copy={copy}
        />
        <label className="flex items-center gap-2 text-xs text-[#52606d]">
          <input
            name="active"
            type="checkbox"
            defaultChecked={form?.active ?? true}
            className="focus-ring size-4 accent-[#2bb7a9]"
          />
          {copy.common.active}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {copy.common.cancel}
          </Button>
          <Button type="submit" disabled={pending || availableFields.length === 0}>
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            {copy.common.save}
          </Button>
        </div>
      </form>
    </DialogFrame>
  );
}

export function DataStructureManager({
  fields,
  definitions,
  forms,
  locale,
}: {
  fields: FieldOption[];
  definitions: DataProfileDefinitionAdminView[];
  forms: DataFormAdminView[];
  locale: AppLocale;
}) {
  const copy = getSettingsDataCopy(locale);
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(intlLocale(locale)),
    [locale],
  );
  const [definitionDialog, setDefinitionDialog] = useState<
    DataProfileDefinitionAdminView | null | undefined
  >(undefined);
  const [formDialog, setFormDialog] = useState<
    DataFormAdminView | null | undefined
  >(undefined);
  const [pending, startTransition] = useTransition();
  const toggleForm = (form: DataFormAdminView) => {
    startTransition(async () => {
      try {
        const result = await setDataFormActiveAction(form.id, !form.active);
        if (result.ok) {
          toast.success(actionMessage(result.code, result.params, copy));
        } else {
          toast.error(actionMessage(result.code, result.params, copy));
        }
      } catch {
        toast.error(copy.messages.formFieldsChanged);
      }
    });
  };

  return (
    <>
      <section id="datenprofile" className="panel scroll-mt-24 overflow-hidden">
        <header className="flex flex-col gap-3 border-b border-[#e8ebee] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Layers3 className="size-5 text-[#365f8d]" />
            <h2 className="text-base font-bold text-[#243444]">{copy.structure.definitionsTitle}</h2>
            <Badge tone="neutral">{numberFormatter.format(definitions.length)}</Badge>
          </div>
          <Button onClick={() => setDefinitionDialog(null)}>
            <Plus className="size-4" /> {copy.structure.addDefinition}
          </Button>
        </header>
        <div className="divide-y divide-[#edf0f2]">
          {definitions.map((definition) => (
            <div key={definition.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-[#2b3a48]">{definition.name}</p>
                  <Badge tone={definition.active ? "teal" : "neutral"}>
                    {definition.active ? copy.common.active : copy.common.inactive}
                  </Badge>
                  {definition.allowMemberCreation ? <Badge tone="blue">{copy.structure.selfService}</Badge> : null}
                </div>
                <p className="mt-1 font-mono text-[10px] text-[#7a8690]">
                  {definition.key} | {copy.common.fields(numberFormatter.format(definition.fieldIds.length))}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDefinitionDialog(definition)}
                className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3]"
                aria-label={copy.common.editNamed(definition.name)}
                title={copy.common.edit}
              >
                <Pencil className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section id="datenformulare" className="panel scroll-mt-24 overflow-hidden">
        <header className="flex flex-col gap-3 border-b border-[#e8ebee] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-[#2b9188]" />
            <h2 className="text-base font-bold text-[#243444]">{copy.structure.formsTitle}</h2>
            <Badge tone="neutral">{numberFormatter.format(forms.length)}</Badge>
          </div>
          <Button onClick={() => setFormDialog(null)} disabled={definitions.length === 0}>
            <Plus className="size-4" /> {copy.structure.addForm}
          </Button>
        </header>
        <div className="divide-y divide-[#edf0f2]">
          {forms.map((form) => {
            const definition = definitions.find((item) => item.id === form.profileDefinitionId);
            return (
              <div key={form.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#2b3a48]">{form.name}</p>
                  <p className="mt-1 text-[10px] text-[#7a8690]">
                    {definition?.name ?? copy.structure.profileDefinition} | {copy.common.fields(numberFormatter.format(form.fieldIds.length))}
                  </p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={form.active}
                    onChange={() => toggleForm(form)}
                    disabled={pending}
                    className="peer sr-only"
                    aria-label={copy.common.toggleNamed(form.name, form.active)}
                  />
                  <span className="pointer-events-none relative h-5 w-9 rounded-full bg-[#cfd6dc] transition-colors peer-checked:bg-[#2bb7a9] after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4" />
                </label>
                <button
                  type="button"
                  onClick={() => setFormDialog(form)}
                  className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3]"
                  aria-label={copy.common.editNamed(form.name)}
                  title={copy.common.edit}
                >
                  <Pencil className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {definitionDialog !== undefined ? (
        <ProfileDefinitionDialog
          definition={definitionDialog}
          fields={fields}
          onClose={() => setDefinitionDialog(undefined)}
          copy={copy}
        />
      ) : null}
      {formDialog !== undefined ? (
        <DataFormDialog
          form={formDialog}
          definitions={definitions.filter((definition) => definition.active)}
          fields={fields.filter((field) => field.active)}
          onClose={() => setFormDialog(undefined)}
          copy={copy}
        />
      ) : null}
    </>
  );
}

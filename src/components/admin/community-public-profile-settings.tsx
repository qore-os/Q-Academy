"use client";

import {
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  Eye,
  LoaderCircle,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  replaceCommunityProfileSettingsAdminAction,
  type CommunityActionState,
} from "@/lib/community-actions";
import {
  formatCommunityAdminNumber,
  getCommunityAdminCopy,
  localizeCommunityAdminAction,
} from "@/lib/i18n/community-admin";
import type { AppLocale } from "@/lib/i18n/model";

type StandardField =
  | "avatar"
  | "job_title"
  | "department"
  | "bio"
  | "community_points"
  | "badges";

type ProfileFieldRow = {
  id: string;
  standardField: StandardField | null;
  customFieldId: string | null;
  requiredForPosting: boolean;
  sortOrder: number;
};

type CustomFieldOption = {
  id: string;
  key: string;
  label: string;
  type: string;
};

type SelectedField = {
  key: string;
  standardField: StandardField | null;
  customFieldId: string | null;
  requiredForPosting: boolean;
};

function profileStandardOptions(locale: AppLocale): Array<{
  value: StandardField;
  label: string;
  requiredCapable: boolean;
}> {
  const labels = getCommunityAdminCopy(locale).profile.standardFields;
  return [
  { value: "avatar", label: labels.avatar, requiredCapable: true },
  { value: "job_title", label: labels.job_title, requiredCapable: true },
  { value: "department", label: labels.department, requiredCapable: true },
  { value: "bio", label: labels.bio, requiredCapable: true },
  {
    value: "community_points",
    label: labels.community_points,
    requiredCapable: false,
  },
  { value: "badges", label: labels.badges, requiredCapable: false },
  ];
}
const initialState: CommunityActionState = { ok: null, message: "" };

function selectedFromRows(fields: ProfileFieldRow[]): SelectedField[] {
  return fields.map((field) => ({
    key: field.standardField
      ? `standard:${field.standardField}`
      : `custom:${field.customFieldId}`,
    standardField: field.standardField,
    customFieldId: field.customFieldId,
    requiredForPosting: field.requiredForPosting,
  }));
}

function typeLabel(type: string, locale: AppLocale) {
  const labels: Record<string, string> = getCommunityAdminCopy(locale).profile.fieldTypes;
  return labels[type] ?? type;
}

export function CommunityPublicProfileSettings({
  data,
  canManage,
  locale,
}: {
  data: {
    settings: {
      completionGateEnabled: boolean;
      revision: number;
    };
    fields: ProfileFieldRow[];
    customFieldCatalog: CustomFieldOption[];
    activeMemberCount: number;
    incompleteActiveMemberCount: number;
  };
  canManage: boolean;
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale);
  const standardOptions = profileStandardOptions(locale);
  const standardByValue = new Map(
    standardOptions.map((option) => [option.value, option]),
  );
  const [fields, setFields] = useState<SelectedField[]>(() =>
    selectedFromRows(data.fields),
  );
  const [gateEnabled, setGateEnabled] = useState(
    data.settings.completionGateEnabled,
  );
  const [candidate, setCandidate] = useState("");
  const [state, action, pending] = useActionState(
    replaceCommunityProfileSettingsAdminAction,
    initialState,
  );

  useEffect(() => {
    if (state.ok === true) {
      toast.success(localizeCommunityAdminAction(locale, state));
    } else if (state.ok === false) {
      toast.error(localizeCommunityAdminAction(locale, state));
    }
  }, [locale, state]);
  const revision =
    state.ok === true && typeof state.revision === "number"
      ? state.revision
      : data.settings.revision;

  const selectedKeys = useMemo(
    () => new Set(fields.map((field) => field.key)),
    [fields],
  );
  const customById = useMemo(
    () => new Map(data.customFieldCatalog.map((field) => [field.id, field])),
    [data.customFieldCatalog],
  );
  const availableStandard = standardOptions.filter(
    (field) => !selectedKeys.has(`standard:${field.value}`),
  );
  const availableCustom = data.customFieldCatalog.filter(
    (field) => !selectedKeys.has(`custom:${field.id}`),
  );
  const gateConfigurationValid =
    !gateEnabled || fields.some((field) => field.requiredForPosting);
  const configurationSnapshot = JSON.stringify({
    completionGateEnabled: gateEnabled,
    fields: fields.map((field) => ({
      standardField: field.standardField,
      customFieldId: field.customFieldId,
      requiredForPosting: field.requiredForPosting,
    })),
  });
  const savedConfigurationSnapshot = JSON.stringify({
    completionGateEnabled: data.settings.completionGateEnabled,
    fields: selectedFromRows(data.fields).map((field) => ({
      standardField: field.standardField,
      customFieldId: field.customFieldId,
      requiredForPosting: field.requiredForPosting,
    })),
  });
  const hasUnsavedChanges = configurationSnapshot !== savedConfigurationSnapshot;

  const addField = () => {
    if (!candidate) return;
    if (candidate.startsWith("standard:")) {
      const standardField = candidate.slice("standard:".length) as StandardField;
      if (!standardByValue.has(standardField)) return;
      setFields((current) => [
        ...current,
        {
          key: candidate,
          standardField,
          customFieldId: null,
          requiredForPosting: false,
        },
      ]);
    } else if (candidate.startsWith("custom:")) {
      const customFieldId = candidate.slice("custom:".length);
      if (!customById.has(customFieldId)) return;
      setFields((current) => [
        ...current,
        {
          key: candidate,
          standardField: null,
          customFieldId,
          requiredForPosting: false,
        },
      ]);
    }
    setCandidate("");
  };

  const moveField = (index: number, target: number) => {
    if (target < 0 || target >= fields.length) return;
    setFields((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  return (
    <section className="panel overflow-hidden" aria-labelledby="community-profile-settings-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <div>
          <p className="text-[9px] font-bold uppercase text-[#365f8d]">
            {copy.profile.eyebrow}
          </p>
          <h2
            id="community-profile-settings-heading"
            className="mt-0.5 text-sm font-bold text-[#243444]"
          >
            {copy.profile.heading}
          </h2>
        </div>
        <Badge tone="blue">{copy.profile.revision(formatCommunityAdminNumber(revision, locale))}</Badge>
      </div>

      <form action={action}>
        <input type="hidden" name="expectedRevision" value={revision} />
        <input
          type="hidden"
          name="fieldsJson"
          value={JSON.stringify(
            fields.map((field) => ({
              standardField: field.standardField,
              customFieldId: field.customFieldId,
              requiredForPosting: field.requiredForPosting,
            })),
          )}
        />

        <div className="flex flex-col gap-3 border-y border-[#e7ebee] bg-[#f8fafb] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-xs font-bold text-[#455463]">
              <ShieldCheck className="size-4 shrink-0 text-[#2b9188]" />
              {copy.profile.gate}
            </span>
            <span
              className={
                data.incompleteActiveMemberCount > 0
                  ? "mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-[#9b6415]"
                  : "mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-[#397169]"
              }
            >
              {data.incompleteActiveMemberCount > 0 ? (
                <AlertTriangle className="size-3 shrink-0" />
              ) : (
                <ShieldCheck className="size-3 shrink-0" />
              )}
              {copy.profile.impact(
                formatCommunityAdminNumber(data.incompleteActiveMemberCount, locale),
                formatCommunityAdminNumber(data.activeMemberCount, locale),
              )}
            </span>
            {hasUnsavedChanges ? (
              <span className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-[#9b6415]">
                <AlertTriangle className="size-3 shrink-0" />
                {copy.profile.unsavedImpact}
              </span>
            ) : null}
          </span>
          <label className="inline-flex cursor-pointer items-center gap-2 self-start sm:self-auto">
            <input
              name="completionGateEnabled"
              type="checkbox"
              checked={gateEnabled}
              disabled={!canManage}
              onChange={(event) => setGateEnabled(event.target.checked)}
              className="peer sr-only"
            />
            <span className="relative h-6 w-11 rounded-full bg-[#cbd3d9] transition-colors peer-checked:bg-[#2b9188] peer-focus-visible:ring-2 peer-focus-visible:ring-[#17324d] peer-focus-visible:ring-offset-2 after:absolute after:left-1 after:top-1 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
            <span className="text-[10px] font-bold text-[#52606d]">
              {gateEnabled ? copy.common.active : copy.common.inactive}
            </span>
          </label>
        </div>

        <div className="divide-y divide-[#edf0f2]">
          {fields.map((field, index) => {
            const standard = field.standardField
              ? standardByValue.get(field.standardField)
              : null;
            const custom = field.customFieldId
              ? customById.get(field.customFieldId)
              : null;
            const label = standard?.label ?? custom?.label ?? copy.profile.unknownField;
            const requiredCapable = standard
              ? standard.requiredCapable
              : Boolean(custom);
            return (
              <div
                key={field.key}
                className="flex min-w-0 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[#eef3f7] text-[#536577]">
                  <Eye className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-[#455463]">
                    {label}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-[#87919a]">
                    {standard
                      ? copy.profile.standardField
                      : copy.profile.customField(typeLabel(custom?.type ?? "", locale))}
                  </span>
                </span>
                <label className="flex min-h-8 items-center gap-2 text-[10px] font-semibold text-[#52606d]">
                  <input
                    type="checkbox"
                    checked={field.requiredForPosting}
                    disabled={!canManage || !requiredCapable}
                    onChange={(event) =>
                      setFields((current) =>
                        current.map((item) =>
                          item.key === field.key
                            ? {
                                ...item,
                                requiredForPosting: event.target.checked,
                              }
                            : item,
                        ),
                      )
                    }
                    className="size-4 accent-[#2b9188] disabled:opacity-40"
                  />
                  {copy.profile.required}
                </label>
                {canManage ? <div className="flex shrink-0 items-center gap-0.5 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={() => moveField(index, index - 1)}
                    disabled={index === 0}
                    className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-[#f3f5f6] disabled:opacity-30"
                    aria-label={copy.profile.moveUp(label)}
                    title={copy.common.moveUp}
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveField(index, index + 1)}
                    disabled={index === fields.length - 1}
                    className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-[#f3f5f6] disabled:opacity-30"
                    aria-label={copy.profile.moveDown(label)}
                    title={copy.common.moveDown}
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setFields((current) =>
                        current.filter((item) => item.key !== field.key),
                      )
                    }
                    className="focus-ring grid size-8 place-items-center rounded-md text-[#a94339] hover:bg-[#fdf0ee]"
                    aria-label={copy.profile.removeField(label)}
                    title={copy.profile.removeFieldTitle}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div> : null}
              </div>
            );
          })}
          {!fields.length ? (
            <p className="px-5 py-7 text-center text-xs text-[#71808b]">
              {copy.profile.empty}
            </p>
          ) : null}
        </div>

        {canManage ? <div className="grid gap-3 border-t border-[#e7ebee] bg-[#f8fafb] px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5">
          <label>
            <span className="sr-only">{copy.profile.selectField}</span>
            <select
              value={candidate}
              onChange={(event) => setCandidate(event.target.value)}
              className="focus-ring h-9 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-xs text-[#455463]"
            >
              <option value="">{copy.profile.selectField}</option>
              {availableStandard.length ? (
                <optgroup label={copy.profile.standardGroup}>
                  {availableStandard.map((field) => (
                    <option
                      key={field.value}
                      value={`standard:${field.value}`}
                    >
                      {field.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {availableCustom.length ? (
                <optgroup label={copy.profile.customGroup}>
                  {availableCustom.map((field) => (
                    <option key={field.id} value={`custom:${field.id}`}>
                      {field.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={addField}
            disabled={!candidate}
          >
            <Plus className="size-3.5" /> {copy.profile.add}
          </Button>
        </div> : null}

        {canManage ? <div className="flex flex-col gap-3 border-t border-[#e7ebee] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            {state.ok !== null ? (
              <p
                role={state.ok ? "status" : "alert"}
                className={
                  state.ok
                    ? "text-xs font-semibold text-[#167e74]"
                    : "text-xs font-semibold text-[#a94339]"
                }
              >
                 {localizeCommunityAdminAction(locale, state)}
              </p>
            ) : !gateConfigurationValid ? (
              <p role="alert" className="text-xs font-semibold text-[#a94339]">
                {copy.profile.requireOne}
              </p>
            ) : null}
          </div>
          <Button
            type="submit"
            disabled={pending || !gateConfigurationValid}
            className="self-end"
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {copy.profile.save}
          </Button>
        </div> : null}
      </form>
    </section>
  );
}

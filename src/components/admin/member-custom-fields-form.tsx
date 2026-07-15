"use client";

import { useActionState, useMemo } from "react";
import {
  ExternalLink,
  LoaderCircle,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import {
  updateMemberCustomFieldsAction,
  type CustomFieldActionState,
} from "@/lib/admin/custom-field-actions";
import { updateOwnCustomFieldsAction } from "@/lib/profile-actions";
import {
  updateMemberDataProfileAction,
  updateOwnDataProfileAction,
  type DataProfileActionState,
} from "@/lib/data-profile-actions";
import type { CustomFieldType, CustomFieldValue } from "@/lib/custom-fields";
import { Button, buttonClassName } from "@/components/ui/button";
import { ProfileMediaAssetField } from "@/components/media/profile-media-asset-field";
import { getMemberExperienceCopy } from "@/lib/i18n/member-experience";
import { dataProfileActionMessage } from "@/lib/i18n/data-profile-actions";
import type { AppLocale } from "@/lib/i18n/model";

export type MemberCustomFieldView = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  type: CustomFieldType;
  category: string;
  required: boolean;
  options: string[];
  value: CustomFieldValue;
};

const initialState: CustomFieldActionState = { ok: null, message: "" };
const inputClassName =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444]";

function FieldControl({
  field,
  readOnly,
  ownerUserId,
  locale,
}: {
  field: MemberCustomFieldView;
  readOnly: boolean;
  ownerUserId: string;
  locale: AppLocale;
}) {
  const copy = getMemberExperienceCopy(locale).customFields;
  const name = `field:${field.id}`;
  if (field.type === "media") {
    return (
      <ProfileMediaAssetField
        name={name}
        ownerUserId={ownerUserId}
        initialAssetId={typeof field.value === "string" ? field.value : null}
        readOnly={readOnly}
        locale={locale}
      />
    );
  }
  if (field.type === "boolean") {
    return (
      <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md border border-[#dce1e5] bg-white px-3">
        <input
          id={name}
          name={name}
          type="checkbox"
          defaultChecked={field.value === true}
          disabled={readOnly}
          className="focus-ring size-4 accent-[#2bb7a9]"
        />
        <span className="text-xs font-semibold text-[#52606d]">
          {copy.affirmative}
        </span>
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <select
        id={name}
        name={name}
        defaultValue={typeof field.value === "string" ? field.value : ""}
        className={inputClassName}
        required={field.required}
        disabled={readOnly}
      >
        <option value="">{copy.select}</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "multiselect") {
    const selected = Array.isArray(field.value) ? field.value : [];
    return (
      <div
        className="grid min-h-10 gap-2 rounded-md border border-[#dce1e5] bg-white p-3 sm:grid-cols-2"
        role="group"
        aria-labelledby={`label:${field.id}`}
      >
        {field.options.map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-center gap-2 text-xs text-[#52606d]"
          >
            <input
              name={name}
              type="checkbox"
              value={option}
              defaultChecked={selected.includes(option)}
              disabled={readOnly}
              className="focus-ring size-4 accent-[#2bb7a9]"
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    );
  }

  const stringValue =
    typeof field.value === "string" || typeof field.value === "number"
      ? String(field.value)
      : "";
  return (
    <input
      id={name}
      name={name}
      type={
        field.type === "number"
          ? "number"
          : field.type === "date"
            ? "date"
            : field.type === "url"
              ? "url"
              : "text"
      }
      defaultValue={stringValue}
      className={inputClassName}
      required={field.required}
      disabled={readOnly}
      step={field.type === "number" ? "any" : undefined}
      maxLength={
        field.type === "url"
          ? 2_000
          : field.type === "text"
            ? 10_000
            : undefined
      }
      placeholder={field.type === "url" ? "https://example.com" : undefined}
    />
  );
}

export function MemberCustomFieldsForm({
  memberId,
  fields,
  selfService = false,
  profileId,
  profileName,
  readOnly = false,
  communityRequiredFieldKeys = [],
  locale,
}: {
  memberId: string;
  fields: MemberCustomFieldView[];
  selfService?: boolean;
  profileId?: string;
  profileName?: string;
  readOnly?: boolean;
  communityRequiredFieldKeys?: string[];
  locale: AppLocale;
}) {
  const copy = getMemberExperienceCopy(locale).customFields;
  const updateAction = profileId
    ? selfService
      ? updateOwnDataProfileAction.bind(null, profileId)
      : updateMemberDataProfileAction.bind(null, memberId, profileId)
    : selfService
      ? updateOwnCustomFieldsAction
      : updateMemberCustomFieldsAction.bind(null, memberId);
  const [state, action, pending] = useActionState(updateAction, initialState);
  const categories = useMemo(() => {
    const grouped = new Map<string, MemberCustomFieldView[]>();
    for (const field of fields) {
      const categoryFields = grouped.get(field.category) ?? [];
      categoryFields.push(field);
      grouped.set(field.category, categoryFields);
    }
    return [...grouped.entries()];
  }, [fields]);
  const communityRequired = useMemo(
    () => new Set(communityRequiredFieldKeys),
    [communityRequiredFieldKeys],
  );
  const actionMessage = profileId
    ? dataProfileActionMessage(
        locale,
        (state as DataProfileActionState).code,
        (state as DataProfileActionState).params,
      )
    : state.message;

  if (fields.length === 0) {
    return (
      <section className="panel grid place-items-center px-5 py-14 text-center">
        <span className="grid size-12 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]">
          <SlidersHorizontal className="size-6" />
        </span>
        <h2 className="mt-4 text-base font-bold text-[#354555]">
          {copy.emptyTitle}
        </h2>
        <p className="mt-1 max-w-lg text-xs leading-5 text-[#7a8690]">
          {selfService
            ? copy.emptySelf
            : copy.emptyAdmin}
        </p>
        {!selfService && !readOnly ? (
          <Link
            href="/admin/settings#profilfelder"
            className={buttonClassName({
              variant: "secondary",
              className: "mt-5",
            })}
          >
            <ExternalLink className="size-4" /> {copy.openSettings}
          </Link>
        ) : null}
      </section>
    );
  }

  return (
    <form action={action} className="panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[#e8ebee] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-[#243444]">
            {profileName ?? copy.title}
          </h2>
          <p className="mt-1 text-xs leading-5 text-[#6c7882]">
            {selfService
              ? copy.selfDescription
              : copy.adminDescription}
          </p>
        </div>
        {!readOnly ? <Button type="submit" disabled={pending}>
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {pending ? copy.saving : copy.save}
        </Button> : null}
      </div>

      <div className="divide-y divide-[#edf0f2]">
        {categories.map(([category, categoryFields]) => (
          <fieldset key={category} className="grid gap-4 p-5">
            <legend className="px-0 text-[10px] font-bold uppercase text-[#2b9188]">
              {category}
            </legend>
            <div className="grid gap-4 md:grid-cols-2">
              {categoryFields.map((field) => {
                const requiredForCommunity = communityRequired.has(field.key);
                const effectiveField = requiredForCommunity
                  ? { ...field, required: true }
                  : field;
                return (
                <div
                  key={field.id}
                  id={`community-field-${field.key}`}
                  className={[
                    field.type === "multiselect" ? "md:col-span-2" : "",
                    requiredForCommunity
                      ? "rounded-md border border-[#edcf9f] bg-[#fffaf1] p-3"
                      : "",
                  ].filter(Boolean).join(" ") || undefined}
                >
                  <label
                    id={`label:${field.id}`}
                    className="mb-1.5 block text-xs font-semibold text-[#52606d]"
                    htmlFor={
                      field.type === "multiselect" || field.type === "boolean"
                        ? undefined
                        : `field:${field.id}`
                    }
                  >
                    {field.label}
                    {field.required ? (
                      <span className="ml-1 text-[#b84e42]">*</span>
                    ) : null}
                    {requiredForCommunity ? (
                      <span className="ml-1.5 text-[9px] font-bold text-[#9b6415]">
                        {copy.communityRequired}
                      </span>
                    ) : null}
                  </label>
                  <FieldControl
                    field={effectiveField}
                    readOnly={readOnly}
                    ownerUserId={memberId}
                    locale={locale}
                  />
                  {field.description ? (
                    <p className="mt-1.5 text-[10px] leading-4 text-[#7a8690]">
                      {field.description}
                    </p>
                  ) : null}
                </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      {state.ok !== null && actionMessage ? (
        <div className="border-t border-[#edf0f2] px-5 py-4">
          <p
            className={`rounded-md p-3 text-xs ${state.ok ? "bg-[#e9f8f6] text-[#167e74]" : "bg-[#fdf0ee] text-[#a94339]"}`}
            aria-live="polite"
          >
            {actionMessage}
          </p>
        </div>
      ) : null}
    </form>
  );
}

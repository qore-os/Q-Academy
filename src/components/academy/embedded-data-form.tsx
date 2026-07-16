"use client";

import { useActionState, useEffect, useState } from "react";
import { FileText, LoaderCircle, Save } from "lucide-react";
import Link from "next/link";
import {
  loadOwnDataFormAction,
  submitOwnDataFormAction,
  type DataFormActionState,
} from "@/lib/data-form-actions";
import type { CustomFieldType, CustomFieldValue } from "@/lib/custom-fields";
import { Button } from "@/components/ui/button";
import { ProfileMediaAssetField } from "@/components/media/profile-media-asset-field";
import type { AppLocale } from "@/lib/i18n/model";
import {
  getSystemExperienceCopy,
  resolveDataFormMessage,
} from "@/lib/i18n/system-experience";

type LoadedForm = Extract<
  Awaited<ReturnType<typeof loadOwnDataFormAction>>,
  { ok: true }
>["data"];

const initialState: DataFormActionState = { ok: null, message: "" };
const inputClassName =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444]";

function FieldControl({
  field,
  profileId,
  controlId,
  descriptionId,
  disabled = false,
  locale,
}: {
  field: LoadedForm["fields"][number];
  profileId: string;
  controlId: string;
  descriptionId?: string;
  disabled?: boolean;
  locale: AppLocale;
}) {
  const copy = getSystemExperienceCopy(locale).dataForm;
  const name = `field:${field.id}`;
  const value = field.values[profileId] as CustomFieldValue | undefined;
  if (field.type === "media") {
    return (
      <ProfileMediaAssetField
        name={name}
        initialAssetId={typeof value === "string" ? value : null}
        readOnly={disabled}
        locale={locale}
      />
    );
  }
  if (field.type === "boolean") {
    return (
      <div className="flex min-h-10 items-center gap-3 rounded-md border border-[#dce1e5] bg-white px-3">
        <input
          id={controlId}
          name={name}
          type="checkbox"
          defaultChecked={value === true}
          disabled={disabled}
          aria-describedby={descriptionId}
          className="focus-ring size-4 accent-[#2bb7a9]"
        />
        <span className="text-xs font-semibold text-[#52606d]">{copy.yes}</span>
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <select
        id={controlId}
        name={name}
        defaultValue={typeof value === "string" ? value : ""}
        aria-describedby={descriptionId}
        className={inputClassName}
        required={field.required}
        disabled={disabled}
      >
        <option value="">{copy.selectOption}</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "multiselect") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="grid gap-2 rounded-md border border-[#dce1e5] bg-white p-3 sm:grid-cols-2">
        {field.options.map((option, index) => (
          <label key={option} className="flex items-center gap-2 text-xs text-[#52606d]">
            <input
              id={index === 0 ? controlId : `${controlId}-${index}`}
              name={name}
              type="checkbox"
              value={option}
              defaultChecked={selected.includes(option)}
              disabled={disabled}
              aria-describedby={descriptionId}
              className="focus-ring size-4 accent-[#2bb7a9]"
            />
            {option}
          </label>
        ))}
      </div>
    );
  }
  const stringValue =
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  const inputType: Record<Exclude<CustomFieldType, "boolean" | "select" | "multiselect" | "media">, string> = {
    text: "text",
    number: "number",
    date: "date",
    url: "url",
  };
  return (
    <input
      id={controlId}
      name={name}
      type={inputType[field.type]}
      defaultValue={stringValue}
      aria-describedby={descriptionId}
      className={inputClassName}
      required={field.required}
      disabled={disabled}
      step={field.type === "number" ? "any" : undefined}
    />
  );
}

function DataFormBody({
  form,
  profileId,
  sourceType,
  sourceId,
  readOnly,
  locale,
}: {
  form: LoadedForm;
  profileId: string;
  sourceType: "profile" | "lesson" | "hub";
  sourceId: string | null;
  readOnly: boolean;
  locale: AppLocale;
}) {
  const action = submitOwnDataFormAction.bind(
    null,
    form.id,
    profileId,
    sourceType,
    sourceId,
  );
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        {form.fields.map((field) => {
          const controlId = `data-form-${form.id}-${profileId}-${field.id}`;
          const descriptionId = field.description
            ? `${controlId}-description`
            : undefined;
          return (
            <div
              key={field.id}
              className={
                field.type === "multiselect" ? "md:col-span-2" : undefined
              }
            >
              <label
                htmlFor={controlId}
                className="mb-1.5 block text-xs font-semibold text-[#52606d]"
              >
                {field.label}
                {field.required ? (
                  <span aria-hidden="true" className="ml-1 text-[#b84e42]">
                    *
                  </span>
                ) : null}
              </label>
              <FieldControl
                field={field}
                profileId={profileId}
                controlId={controlId}
                descriptionId={descriptionId}
                disabled={readOnly}
                locale={locale}
              />
              {field.description ? (
                <span
                  id={descriptionId}
                  className="mt-1 block text-[10px] leading-4 text-[#7a8690]"
                >
                  {field.description}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col-reverse gap-3 border-t border-[#edf0f2] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p
          className={state.ok === false ? "text-xs text-[#a94339]" : "text-xs text-[#167e74]"}
          aria-live="polite"
        >
          {state.ok === null ? "" : resolveDataFormMessage(locale, state)}
        </p>
        <Button
          type="submit"
          disabled={readOnly || pending || form.fields.length === 0}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          {form.submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function EmbeddedDataForm({
  formId,
  sourceType,
  sourceId = null,
  readOnly = false,
  locale,
}: {
  formId: string;
  sourceType: "profile" | "lesson" | "hub";
  sourceId?: string | null;
  readOnly?: boolean;
  locale: AppLocale;
}) {
  const copy = getSystemExperienceCopy(locale).dataForm;
  const [result, setResult] = useState<
    Awaited<ReturnType<typeof loadOwnDataFormAction>> | null
  >(null);
  const [profileId, setProfileId] = useState("");
  const requestKey = `${formId}:${sourceType}:${sourceId ?? ""}`;
  const [resultKey, setResultKey] = useState("");
  const [failedKey, setFailedKey] = useState("");
  useEffect(() => {
    let active = true;
    void loadOwnDataFormAction(formId, sourceType, sourceId)
      .then((nextResult) => {
        if (!active) return;
        setResult(nextResult);
        setResultKey(requestKey);
        setFailedKey("");
        if (nextResult.ok) {
          setProfileId(
            nextResult.data.profiles.find((profile) => profile.isDefault)?.id ??
              nextResult.data.profiles[0]?.id ??
              "",
          );
        }
      })
      .catch(() => {
        if (active) setFailedKey(requestKey);
      });
    return () => {
      active = false;
    };
  }, [formId, requestKey, sourceId, sourceType]);

  if (failedKey === requestKey) {
    return <p className="text-xs text-[#a94339]">{copy.requestFailed}</p>;
  }
  if (!result || resultKey !== requestKey) {
    return (
      <div
        className="grid min-h-32 place-items-center"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <LoaderCircle
          aria-hidden="true"
          className="size-5 animate-spin text-[#2b9188]"
        />
        <span className="sr-only">{copy.loading}</span>
      </div>
    );
  }
  if (!result.ok) {
    return (
      <p className="text-xs text-[#a94339]">
        {resolveDataFormMessage(locale, result)}
      </p>
    );
  }
  const form = result.data;
  if (!profileId) {
    return (
      <div className="py-4 text-center">
        <FileText className="mx-auto size-6 text-[#7a8690]" />
        <p className="mt-2 text-xs text-[#52606d]">{copy.noProfile}</p>
        <Link
          href="/academy/profile"
          className="focus-ring mt-3 inline-flex h-9 items-center rounded-md border border-[#dfe4e8] px-3 text-xs font-semibold text-[#52606d]"
        >
          {copy.openProfile}
        </Link>
      </div>
    );
  }
  return (
    <section className="border-y border-[#e4e8eb] py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-bold text-[#243444]">{form.name}</h3>
          {form.description ? (
            <p className="mt-1 text-xs leading-5 text-[#6c7882]">{form.description}</p>
          ) : null}
        </div>
        {form.profiles.length > 1 ? (
          <select
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
            className="focus-ring h-9 min-w-44 rounded-md border border-[#dce1e5] bg-white px-3 text-xs"
            aria-label={copy.profile}
          >
            {form.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="mt-5">
        <DataFormBody
          key={profileId}
          form={form}
          profileId={profileId}
          sourceType={sourceType}
          sourceId={sourceId}
          readOnly={readOnly}
          locale={locale}
        />
      </div>
    </section>
  );
}

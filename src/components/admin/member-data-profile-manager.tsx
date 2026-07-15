"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Archive, LoaderCircle, Plus, Star, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  archiveMemberDataProfileAction,
  archiveOwnDataProfileAction,
  createMemberDataProfileAction,
  createOwnDataProfileAction,
  setMemberDefaultDataProfileAction,
  setOwnDefaultDataProfileAction,
  type DataProfileActionState,
} from "@/lib/data-profile-actions";
import { MemberCustomFieldsForm, type MemberCustomFieldView } from "@/components/admin/member-custom-fields-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { dataProfileActionMessage } from "@/lib/i18n/data-profile-actions";
import type { AppLocale } from "@/lib/i18n/model";

type DataProfileTab = {
  id: string;
  name: string;
  definitionId: string;
  definitionName: string;
  isDefault: boolean;
};

type DataProfileDefinitionOption = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  allowMemberCreation: boolean;
};

const initialState: DataProfileActionState = { ok: null, message: "" };

type DataProfileCopy = ReturnType<
  typeof getMainPageDictionary
>["admin"]["memberDetail"]["dataProfiles"];

function CreateProfileDialog({
  memberId,
  definitions,
  selfService,
  copy,
  locale,
  onClose,
}: {
  memberId: string;
  definitions: DataProfileDefinitionOption[];
  selfService: boolean;
  copy: DataProfileCopy;
  locale: AppLocale;
  onClose: () => void;
}) {
  const action = selfService
    ? createOwnDataProfileAction
    : createMemberDataProfileAction.bind(null, memberId);
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    const message = dataProfileActionMessage(locale, state.code, state.params);
    if (state.ok === true) {
      toast.success(message);
      onClose();
    } else if (state.ok === false) {
      toast.error(message);
    }
  }, [locale, onClose, state]);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-[#0f263c]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-data-profile-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <form
        action={formAction}
        className="w-full max-w-lg rounded-md bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-[#e8ebee] px-5 py-4">
          <h2
            id="create-data-profile-title"
            className="text-base font-bold text-[#243444]"
          >
            {copy.createTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3]"
            aria-label={copy.closeDialog}
            title={copy.close}
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="grid gap-4 p-5">
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.template}
            </span>
            <select
              name="definitionId"
              className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
              required
            >
              {definitions.map((definition) => (
                <option key={definition.id} value={definition.id}>
                  {definition.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.profileName}
            </span>
            <input
              name="name"
              className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
              placeholder={copy.profileNamePlaceholder}
              minLength={2}
              maxLength={180}
              required
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={pending}
            >
              {copy.cancel}
            </Button>
            <Button type="submit" disabled={pending || definitions.length === 0}>
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {copy.create}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function MemberDataProfileManager({
  memberId,
  profiles,
  definitions,
  selectedProfile,
  fields,
  selfService = false,
  basePath,
  readOnly = false,
  communityRequiredFieldKeys = [],
  locale,
}: {
  memberId: string;
  profiles: DataProfileTab[];
  definitions: DataProfileDefinitionOption[];
  selectedProfile: DataProfileTab;
  fields: MemberCustomFieldView[];
  selfService?: boolean;
  basePath: string;
  readOnly?: boolean;
  communityRequiredFieldKeys?: string[];
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).admin.memberDetail.dataProfiles;
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const setDefault = () => {
    startTransition(async () => {
      const result = selfService
        ? await setOwnDefaultDataProfileAction(selectedProfile.id)
        : await setMemberDefaultDataProfileAction(
            memberId,
            selectedProfile.id,
          );
      const message = dataProfileActionMessage(
        locale,
        result.code,
        result.params,
      );
      if (result.ok) toast.success(message);
      else toast.error(message);
      if (result.ok) router.refresh();
    });
  };

  const archive = () => {
    startTransition(async () => {
      const result = selfService
        ? await archiveOwnDataProfileAction(selectedProfile.id)
        : await archiveMemberDataProfileAction(memberId, selectedProfile.id);
      const message = dataProfileActionMessage(
        locale,
        result.code,
        result.params,
      );
      if (result.ok) toast.success(message);
      else toast.error(message);
      if (result.ok) router.push(basePath);
    });
  };

  return (
    <>
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#e8ebee] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[#243444]">
                {copy.title}
              </h2>
              <Badge tone="neutral">{profiles.length}</Badge>
            </div>
            <p className="mt-1 text-xs text-[#6c7882]">
              {selectedProfile.definitionName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!readOnly && !selectedProfile.isDefault ? (
              <button
                type="button"
                onClick={setDefault}
                disabled={pending}
                className="focus-ring grid size-9 place-items-center rounded-md border border-[#dfe4e8] text-[#52606d] hover:bg-[#f3f5f6] disabled:opacity-50"
                aria-label={copy.setActive}
                title={copy.setActive}
              >
                {pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Star className="size-4" />
                )}
              </button>
            ) : null}
            {!readOnly && !selectedProfile.isDefault && profiles.length > 1 ? (
              <button
                type="button"
                onClick={archive}
                disabled={pending}
                className="focus-ring grid size-9 place-items-center rounded-md border border-[#ead9d6] text-[#a94339] hover:bg-[#fdf0ee] disabled:opacity-50"
                aria-label={copy.archive}
                title={copy.archive}
              >
                <Archive className="size-4" />
              </button>
            ) : null}
            {!readOnly && definitions.length > 0 ? (
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="size-4" /> {copy.newProfile}
              </Button>
            ) : null}
          </div>
        </div>
        <nav
          className="flex gap-1 overflow-x-auto px-3"
          aria-label={copy.navigation}
        >
          {profiles.map((profile) => (
            <Link
              key={profile.id}
              href={`${basePath}?profile=${encodeURIComponent(profile.id)}`}
              aria-current={profile.id === selectedProfile.id ? "page" : undefined}
              className={cn(
                "focus-ring flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-xs font-semibold",
                profile.id === selectedProfile.id
                  ? "border-[#2bb7a9] text-[#17324d]"
                  : "border-transparent text-[#71808b] hover:text-[#354555]",
              )}
            >
              {profile.name}
              {profile.isDefault ? <Star className="size-3 fill-current" /> : null}
            </Link>
          ))}
        </nav>
      </section>

      <MemberCustomFieldsForm
        key={selectedProfile.id}
        memberId={memberId}
        profileId={selectedProfile.id}
        fields={fields}
        selfService={selfService}
        readOnly={readOnly}
        locale={locale}
        communityRequiredFieldKeys={communityRequiredFieldKeys}
      />

      {dialogOpen ? (
        <CreateProfileDialog
          memberId={memberId}
          definitions={definitions}
          selfService={selfService}
          copy={copy}
          locale={locale}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </>
  );
}

"use client";

import {
  ArrowDown,
  ArrowUp,
  FolderPlus,
  GripVertical,
  LoaderCircle,
  Pencil,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { AdminCreateButton } from "@/components/admin/admin-create-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  createCommunityAreaAdminAction,
  deleteCommunityAreaAdminAction,
  deleteCommunitySpaceAdminAction,
  moveCommunityAreaAdminAction,
  moveCommunitySpaceAdminAction,
  updateCommunityAreaAdminAction,
  updateCommunitySpaceAdminAction,
  type CommunityActionState,
} from "@/lib/community-actions";
import type { CommunitySpaceType } from "@/lib/community-domain";
import {
  formatCommunityAdminNumber,
  getCommunityAdminCopy,
  localizeCommunityAdminAction,
} from "@/lib/i18n/community-admin";
import type { AppLocale } from "@/lib/i18n/model";

export type CommunityLayoutManagerSpace = {
  id: string;
  areaId: string;
  title: string;
  slug: string;
  description: string | null;
  color: string;
  type: CommunitySpaceType;
  accessMode: "open" | "restricted";
  sortOrder: number;
};

export type CommunityLayoutManagerArea = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  spaces: CommunityLayoutManagerSpace[];
};

const initialState: CommunityActionState = { ok: null, message: "" };
const inputClassName =
  "focus-ring h-9 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-xs text-[#2b3a48]";

function ActionMessage({ state, locale }: { state: CommunityActionState; locale: AppLocale }) {
  if (state.ok === null) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={
        state.ok
          ? "text-[10px] font-semibold text-[#167e74]"
          : "text-[10px] font-semibold text-[#a94339]"
      }
    >
      {localizeCommunityAdminAction(locale, state)}
    </p>
  );
}

function CreateAreaForm({ onClose, locale }: { onClose: () => void; locale: AppLocale }) {
  const copy = getCommunityAdminCopy(locale);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(
    createCommunityAreaAdminAction,
    initialState,
  );

  useEffect(() => {
    if (state.ok === true) {
      toast.success(localizeCommunityAdminAction(locale, state));
      formRef.current?.reset();
      onClose();
    } else if (state.ok === false) {
      toast.error(localizeCommunityAdminAction(locale, state));
    }
  }, [locale, onClose, state]);

  return (
    <form
      ref={formRef}
      action={action}
      className="grid gap-3 border-t border-[#e7ebee] bg-[#f8fafb] p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]"
    >
      <label>
        <span className="mb-1 block text-[10px] font-bold text-[#667581]">
          {copy.common.name}
        </span>
        <input
          name="title"
          required
          minLength={2}
          maxLength={160}
          autoFocus
          className={inputClassName}
          placeholder={copy.layout.areaNamePlaceholder}
        />
      </label>
      <label>
        <span className="mb-1 block text-[10px] font-bold text-[#667581]">
          {copy.common.description}
        </span>
        <input
          name="description"
          maxLength={5000}
          className={inputClassName}
          placeholder={copy.layout.areaDescriptionPlaceholder}
        />
      </label>
      <div className="flex items-end justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="focus-ring grid size-9 place-items-center rounded-md text-[#667581] hover:bg-[#e9edef] disabled:opacity-50"
          aria-label={copy.layout.cancelAreaCreation}
          title={copy.common.cancel}
        >
          <X className="size-4" />
        </button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <FolderPlus className="size-3.5" />
          )}
          {copy.common.create}
        </Button>
      </div>
      <div className="sm:col-span-3">
        <ActionMessage state={state} locale={locale} />
      </div>
    </form>
  );
}

function AreaHeader({
  area,
  index,
  areaCount,
  canManage,
  locale,
}: {
  area: CommunityLayoutManagerArea;
  index: number;
  areaCount: number;
  canManage: boolean;
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [transitionPending, startTransition] = useTransition();
  const updateAction = useCallback(
    async (current: CommunityActionState, formData: FormData) => {
      const result = await updateCommunityAreaAdminAction(
        area.id,
        current,
        formData,
      );
      if (result.ok === true) {
        toast.success(localizeCommunityAdminAction(locale, result));
        setEditing(false);
      } else if (result.ok === false) {
        toast.error(localizeCommunityAdminAction(locale, result));
      }
      return result;
    },
    [area.id, locale],
  );
  const [state, action, updatePending] = useActionState(
    updateAction,
    initialState,
  );

  const move = (position: number) => {
    startTransition(async () => {
      const result = await moveCommunityAreaAdminAction(area.id, position);
       if (result.ok) toast.success(localizeCommunityAdminAction(locale, result));
       else toast.error(localizeCommunityAdminAction(locale, result));
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await deleteCommunityAreaAdminAction(area.id);
       if (result.ok) toast.success(localizeCommunityAdminAction(locale, result));
       else toast.error(localizeCommunityAdminAction(locale, result));
      setConfirmingDelete(false);
    });
  };

  return (
    <div className="border-t border-[#e7ebee] first:border-t-0">
      {editing ? (
        <form
          action={action}
          className="grid gap-3 bg-[#f6f9fa] p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]"
        >
          <label>
            <span className="mb-1 block text-[10px] font-bold text-[#667581]">
              {copy.layout.area}
            </span>
            <input
              name="title"
              defaultValue={area.title}
              minLength={2}
              maxLength={160}
              required
              autoFocus
              className={inputClassName}
            />
          </label>
          <label>
            <span className="mb-1 block text-[10px] font-bold text-[#667581]">
              {copy.common.description}
            </span>
            <input
              name="description"
              defaultValue={area.description ?? ""}
              maxLength={5000}
              className={inputClassName}
            />
          </label>
          <div className="flex items-end justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={updatePending}
              className="focus-ring grid size-9 place-items-center rounded-md text-[#667581] hover:bg-white disabled:opacity-50"
              aria-label={copy.layout.cancelAreaEdit(area.title)}
              title={copy.common.cancel}
            >
              <X className="size-4" />
            </button>
            <Button type="submit" size="sm" disabled={updatePending}>
              {updatePending ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              {copy.common.save}
            </Button>
          </div>
          <div className="sm:col-span-3">
            <ActionMessage state={state} locale={locale} />
          </div>
        </form>
      ) : (
        <div className="flex min-w-0 items-start gap-3 bg-[#f8fafb] px-4 py-3">
          <GripVertical className="mt-0.5 size-4 shrink-0 text-[#a1abb3]" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-[#2b3a48]">
                {area.title}
              </h3>
              <Badge tone="neutral">{copy.layout.spaceCount(formatCommunityAdminNumber(area.spaces.length, locale))}</Badge>
            </div>
            {area.description ? (
              <p className="mt-1 text-[10px] leading-4 text-[#71808b]">
                {area.description}
              </p>
            ) : null}
          </div>
          {canManage ? <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => move(index - 1)}
              disabled={transitionPending || index === 0}
              className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-white disabled:opacity-30"
              aria-label={copy.layout.moveAreaUp(area.title)}
              title={copy.common.moveUp}
            >
              <ArrowUp className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => move(index + 1)}
              disabled={transitionPending || index === areaCount - 1}
              className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-white disabled:opacity-30"
              aria-label={copy.layout.moveAreaDown(area.title)}
              title={copy.common.moveDown}
            >
              <ArrowDown className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={transitionPending}
              className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-white disabled:opacity-50"
              aria-label={copy.layout.editArea(area.title)}
              title={copy.layout.editArea(area.title)}
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete((value) => !value)}
              disabled={transitionPending || area.spaces.length > 0}
              className="focus-ring grid size-8 place-items-center rounded-md text-[#a94339] hover:bg-[#fdf0ee] disabled:opacity-30"
              aria-label={copy.layout.deleteArea(area.title)}
              title={
                area.spaces.length
                  ? copy.layout.moveSpacesFirst
                  : copy.layout.deleteArea(area.title)
              }
            >
              {transitionPending ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </button>
          </div> : null}
        </div>
      )}
      {confirmingDelete ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#efd8d4] bg-[#fdf5f3] px-4 py-2.5">
          <p className="mr-auto text-[10px] font-semibold text-[#8f3f36]">
            {copy.layout.deleteEmptyArea}
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setConfirmingDelete(false)}
            disabled={transitionPending}
          >
            {copy.common.cancel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="danger"
            onClick={remove}
            disabled={transitionPending}
          >
            <Trash2 className="size-3.5" /> {copy.common.delete}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SpaceRow({
  space,
  area,
  areas,
  index,
  canManage,
  locale,
}: {
  space: CommunityLayoutManagerSpace;
  area: CommunityLayoutManagerArea;
  areas: CommunityLayoutManagerArea[];
  index: number;
  canManage: boolean;
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [transitionPending, startTransition] = useTransition();
  const updateAction = useCallback(
    async (current: CommunityActionState, formData: FormData) => {
      const result = await updateCommunitySpaceAdminAction(
        space.id,
        current,
        formData,
      );
      if (result.ok === true) {
        toast.success(localizeCommunityAdminAction(locale, result));
        setEditing(false);
      } else if (result.ok === false) {
        toast.error(localizeCommunityAdminAction(locale, result));
      }
      return result;
    },
    [locale, space.id],
  );
  const [state, action, updatePending] = useActionState(
    updateAction,
    initialState,
  );

  const move = (areaId: string, position: number) => {
    startTransition(async () => {
      const result = await moveCommunitySpaceAdminAction(
        space.id,
        areaId,
        position,
      );
       if (result.ok) toast.success(localizeCommunityAdminAction(locale, result));
       else toast.error(localizeCommunityAdminAction(locale, result));
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await deleteCommunitySpaceAdminAction(
        space.id,
        confirmation,
      );
       if (result.ok) toast.success(localizeCommunityAdminAction(locale, result));
       else toast.error(localizeCommunityAdminAction(locale, result));
    });
  };

  return (
    <div className="border-t border-[#edf0f2] first:border-t-0">
      {editing ? (
        <form action={action} className="grid gap-3 px-4 py-3 lg:grid-cols-2">
          <label>
            <span className="mb-1 block text-[10px] font-bold text-[#667581]">
              {copy.common.title}
            </span>
            <input
              name="title"
              defaultValue={space.title}
              required
              minLength={2}
              maxLength={160}
              autoFocus
              className={inputClassName}
            />
          </label>
          <label>
            <span className="mb-1 block text-[10px] font-bold text-[#667581]">
              {copy.common.description}
            </span>
            <input
              name="description"
              defaultValue={space.description ?? ""}
              maxLength={5000}
              className={inputClassName}
            />
          </label>
          <label>
            <span className="mb-1 block text-[10px] font-bold text-[#667581]">
              {copy.common.type}
            </span>
            <select name="type" defaultValue={space.type} className={inputClassName}>
              <option value="feed">{copy.common.feed}</option>
              <option value="discussion">{copy.common.discussion}</option>
              <option value="announcement">{copy.common.announcement}</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-[10px] font-bold text-[#667581]">
              {copy.common.accentColor}
            </span>
            <span className="flex h-9 items-center gap-2 rounded-md border border-[#dce1e5] bg-white px-2">
              <input
                name="color"
                type="color"
                defaultValue={space.color}
                className="size-6 border-0 bg-transparent p-0"
              />
              <span className="text-[10px] text-[#71808b]">{space.color}</span>
            </span>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2 lg:col-span-2">
            <ActionMessage state={state} locale={locale} />
            <div className="ml-auto flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setEditing(false)}
                disabled={updatePending}
              >
                {copy.common.cancel}
              </Button>
              <Button type="submit" size="sm" disabled={updatePending}>
                {updatePending ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {copy.common.save}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <div className="flex min-w-0 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: space.color }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-xs font-bold text-[#455463]">
                {space.title}
              </p>
              <Badge tone={space.accessMode === "restricted" ? "blue" : "neutral"}>
                {space.type === "announcement"
                   ? copy.common.announcement
                  : space.type === "discussion"
                     ? copy.common.discussion
                     : copy.common.feed}
              </Badge>
            </div>
            {space.description ? (
              <p className="mt-0.5 line-clamp-1 text-[10px] text-[#87919a]">
                {space.description}
              </p>
            ) : null}
          </div>
          {canManage ? <select
            aria-label={copy.layout.assignArea(space.title)}
            value={area.id}
            disabled={transitionPending}
            onChange={(event) => {
              const target = areas.find(
                (candidate) => candidate.id === event.target.value,
              );
              if (target) move(target.id, target.spaces.length);
            }}
            className="focus-ring h-8 min-w-36 rounded-md border border-[#dce1e5] bg-white px-2 text-[10px] font-semibold text-[#52606d] disabled:opacity-50"
          >
            {areas.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title}
              </option>
            ))}
          </select> : null}
          {canManage ? <div className="flex shrink-0 items-center gap-0.5 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => move(area.id, index - 1)}
              disabled={transitionPending || index === 0}
              className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-[#f3f5f6] disabled:opacity-30"
              aria-label={copy.layout.moveSpaceUp(space.title)}
              title={copy.common.moveUp}
            >
              <ArrowUp className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => move(area.id, index + 1)}
              disabled={transitionPending || index === area.spaces.length - 1}
              className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-[#f3f5f6] disabled:opacity-30"
              aria-label={copy.layout.moveSpaceDown(space.title)}
              title={copy.common.moveDown}
            >
              <ArrowDown className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={transitionPending}
              className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-[#f3f5f6] disabled:opacity-50"
              aria-label={copy.layout.editSpace(space.title)}
              title={copy.layout.editSpace(space.title)}
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete((value) => !value)}
              disabled={transitionPending}
              className="focus-ring grid size-8 place-items-center rounded-md text-[#a94339] hover:bg-[#fdf0ee] disabled:opacity-50"
              aria-label={copy.layout.deleteSpace(space.title)}
              title={copy.layout.deleteSpace(space.title)}
            >
              {transitionPending ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </button>
          </div> : null}
        </div>
      )}
      {confirmingDelete ? (
        <div className="flex flex-col gap-2 border-t border-[#efd8d4] bg-[#fdf5f3] px-4 py-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[10px] font-bold text-[#8f3f36]">
              {copy.layout.confirmDelete(space.title)}
            </span>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className={inputClassName}
              autoFocus
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setConfirmingDelete(false);
              setConfirmation("");
            }}
            disabled={transitionPending}
          >
            {copy.common.cancel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="danger"
            onClick={remove}
            disabled={transitionPending || confirmation !== space.title}
          >
            <Trash2 className="size-3.5" /> {copy.common.deletePermanent}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function CommunityLayoutManager({
  areas,
  canManage,
  locale,
}: {
  areas: CommunityLayoutManagerArea[];
  canManage: boolean;
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale);
  const [creatingArea, setCreatingArea] = useState(false);
  const areaOptions = areas.map(({ id, title }) => ({ id, title }));

  return (
    <section className="panel overflow-hidden" aria-labelledby="community-layout-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <div>
          <p className="text-[9px] font-bold uppercase text-[#2b9188]">
            {copy.layout.eyebrow}
          </p>
          <h2 id="community-layout-heading" className="mt-0.5 text-sm font-bold text-[#243444]">
            {copy.layout.heading}
          </h2>
        </div>
        {canManage ? <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setCreatingArea((value) => !value)}
            aria-expanded={creatingArea}
          >
            <FolderPlus className="size-3.5" /> {copy.layout.newArea}
          </Button>
          <AdminCreateButton
            resource="community-space"
            label={copy.layout.newSpace}
            variant="primary"
            communityAreas={areaOptions}
            locale={locale}
          />
        </div> : null}
      </div>
      {canManage && creatingArea ? (
        <CreateAreaForm onClose={() => setCreatingArea(false)} locale={locale} />
      ) : null}
      <div>
        {areas.map((area, areaIndex) => (
          <div key={area.id}>
            <AreaHeader area={area} index={areaIndex} areaCount={areas.length} canManage={canManage} locale={locale} />
            <div className="bg-white">
              {area.spaces.map((space, spaceIndex) => (
                <SpaceRow
                  key={space.id}
                  space={space}
                  area={area}
                  areas={areas}
                  index={spaceIndex}
                  canManage={canManage}
                  locale={locale}
                />
              ))}
              {!area.spaces.length ? (
                <p className="border-t border-[#edf0f2] px-10 py-4 text-xs text-[#87919a]">
                  {copy.layout.emptyArea}
                </p>
              ) : null}
            </div>
          </div>
        ))}
        {!areas.length ? (
          <p className="border-t border-[#edf0f2] px-5 py-8 text-center text-xs text-[#71808b]">
            {copy.layout.emptyLayout}
          </p>
        ) : null}
      </div>
    </section>
  );
}

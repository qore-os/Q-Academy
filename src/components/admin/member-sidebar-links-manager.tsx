"use client";

import {
  ArrowDown,
  ArrowUp,
  Link2,
  LoaderCircle,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  createMemberSidebarLinkAction,
  deleteMemberSidebarLinkAction,
  reorderMemberSidebarLinksAction,
  updateMemberSidebarLinkAction,
  type MemberSidebarLinkActionState,
} from "@/lib/member-sidebar-link-actions";
import { MEMBER_SIDEBAR_LINK_ICONS } from "@/lib/member-sidebar-link-model";
import type { MemberSidebarLinkView } from "@/lib/member-sidebar-links";
import { memberSidebarLinkIconComponents } from "@/components/member-sidebar-link-icons";
import { getSettingsAdminCopy, type SettingsAdminCopy } from "@/lib/i18n/settings-admin";
import type { AppLocale } from "@/lib/i18n/model";

const initialState: MemberSidebarLinkActionState = { ok: null, message: "" };
const inputClassName =
  "focus-ring h-9 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-xs text-[#243444]";

function IconPicker({
  defaultValue,
  copy,
}: {
  defaultValue: MemberSidebarLinkView["icon"];
  copy: SettingsAdminCopy;
}) {
  return (
    <fieldset className="min-w-0 lg:col-span-4">
      <legend className="mb-1 text-[10px] font-semibold text-[#66727f]">
        {copy.sidebar.iconPicker}
      </legend>
      <div className="grid grid-cols-8 gap-1 sm:grid-cols-12 lg:grid-cols-16">
        {MEMBER_SIDEBAR_LINK_ICONS.map((icon) => {
          const Icon = memberSidebarLinkIconComponents[icon];
          const label = copy.sidebar.icons[icon];
          return (
            <label
              key={icon}
              title={label}
              className="focus-within:focus-ring relative grid size-9 cursor-pointer place-items-center rounded-md border border-[#dce1e5] text-[#66727f] hover:bg-[#f3f6f7] has-[:checked]:border-[var(--brand-accent)] has-[:checked]:bg-[#e9f8f6] has-[:checked]:text-[#167e74]"
            >
              <input
                className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
                type="radio"
                name="icon"
                value={icon}
                defaultChecked={icon === defaultValue}
              />
              <Icon className="size-4" aria-hidden="true" />
              <span className="sr-only">{label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function LinkFields({ link, copy }: { link?: MemberSidebarLinkView; copy: SettingsAdminCopy }) {
  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(140px,0.7fr)_minmax(200px,1fr)_minmax(220px,1.3fr)_auto] lg:items-end">
      <label className="min-w-0">
        <span className="mb-1 block text-[10px] font-semibold text-[#66727f]">{copy.sidebar.name}</span>
        <input name="label" defaultValue={link?.label} required maxLength={80} className={inputClassName} />
      </label>
      <label className="min-w-0">
        <span className="mb-1 block text-[10px] font-semibold text-[#66727f]">{copy.sidebar.descriptionLabel}</span>
        <input name="description" defaultValue={link?.description ?? ""} maxLength={240} className={inputClassName} />
      </label>
      <label className="min-w-0">
        <span className="mb-1 block text-[10px] font-semibold text-[#66727f]">{copy.sidebar.href}</span>
        <input name="href" defaultValue={link?.href} required maxLength={2048} placeholder={copy.sidebar.hrefPlaceholder} className={inputClassName} />
      </label>
      <label className="flex h-9 items-center gap-2 text-xs font-semibold text-[#52606d]">
        <input name="active" type="checkbox" defaultChecked={link?.active ?? true} className="size-4 accent-[var(--brand-accent)]" />
        {copy.common.active}
      </label>
      <IconPicker defaultValue={link?.icon ?? "link"} copy={copy} />
    </div>
  );
}

function ExistingLink({
  link,
  index,
  count,
  busy,
  onMove,
  onDelete,
  copy,
}: {
  link: MemberSidebarLinkView;
  index: number;
  count: number;
  busy: boolean;
  onMove: (index: number, offset: -1 | 1) => void;
  onDelete: (id: string) => void;
  copy: SettingsAdminCopy;
}) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: MemberSidebarLinkActionState, formData: FormData) => {
      const result = await updateMemberSidebarLinkAction(link.id, previous, formData);
      if (result.ok) {
        setDirty(false);
        router.refresh();
      }
      return result;
    },
    initialState,
  );
  const message = state.code ? copy.messages[state.code] : "";
  return (
    <form action={action} onChange={() => setDirty(true)} className="border-t border-[#edf0f2] px-5 py-4 first:border-t-0">
      <LinkFields link={link} copy={copy} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className={`min-h-4 text-[11px] ${state.ok === false ? "text-[#a94339]" : "text-[#167e74]"}`}>
          {message}
        </p>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => onMove(index, -1)} disabled={busy || index === 0} aria-label={copy.sidebar.moveUpNamed(link.label)} title={copy.sidebar.moveUp} className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3] disabled:opacity-35">
            <ArrowUp className="size-4" />
          </button>
          <button type="button" onClick={() => onMove(index, 1)} disabled={busy || index === count - 1} aria-label={copy.sidebar.moveDownNamed(link.label)} title={copy.sidebar.moveDown} className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3] disabled:opacity-35">
            <ArrowDown className="size-4" />
          </button>
          <button type="button" onClick={() => onDelete(link.id)} disabled={busy} aria-label={copy.sidebar.deleteNamed(link.label)} title={copy.sidebar.delete} className="focus-ring grid size-8 place-items-center rounded-md text-[#a94339] hover:bg-[#fdf0ee] disabled:opacity-35">
            <Trash2 className="size-4" />
          </button>
          <Button type="submit" size="sm" disabled={pending || busy || !dirty}>
            {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {copy.common.save}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function MemberSidebarLinksManager({ links, locale }: { links: MemberSidebarLinkView[]; locale: AppLocale }) {
  const router = useRouter();
  const copy = getSettingsAdminCopy(locale);
  const formRef = useRef<HTMLFormElement>(null);
  const [operationMessage, setOperationMessage] = useState("");
  const [transitionPending, startTransition] = useTransition();
  const [createState, createAction, createPending] = useActionState(
    createMemberSidebarLinkAction,
    initialState,
  );
  useEffect(() => {
    if (!createState.ok) return;
    formRef.current?.reset();
    router.refresh();
  }, [createState.ok, router]);

  function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= links.length) return;
    const next = [...links];
    [next[index], next[target]] = [next[target], next[index]];
    startTransition(async () => {
      const result = await reorderMemberSidebarLinksAction(next.map((item) => item.id));
      setOperationMessage(result.code ? copy.messages[result.code] : "");
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!window.confirm(copy.sidebar.confirmDelete)) return;
    startTransition(async () => {
      const result = await deleteMemberSidebarLinkAction(id);
      setOperationMessage(result.code ? copy.messages[result.code] : "");
      router.refresh();
    });
  }

  return (
    <section id="mitglieder-links" className="panel scroll-mt-24 overflow-hidden">
      <header className="flex items-center gap-3 border-b border-[#e8ebee] px-5 py-4">
        <span className="grid size-9 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]"><Link2 className="size-4" /></span>
        <div>
          <h2 className="text-base font-bold text-[#243444]">{copy.sidebar.title}</h2>
          <p className="mt-0.5 text-xs text-[#71808b]">{copy.sidebar.description}</p>
        </div>
      </header>
      <form ref={formRef} action={createAction} className="bg-[#f8fafb] px-5 py-4">
        <LinkFields copy={copy} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" className={`min-h-4 text-[11px] ${createState.ok === false ? "text-[#a94339]" : "text-[#167e74]"}`}>{createState.code ? copy.messages[createState.code] : ""}</p>
          <Button type="submit" size="sm" disabled={createPending}>
            {createPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {copy.sidebar.add}
          </Button>
        </div>
      </form>
      <div>
        {links.map((link, index) => (
          <ExistingLink key={link.id} link={link} index={index} count={links.length} busy={transitionPending} onMove={move} onDelete={remove} copy={copy} />
        ))}
        {!links.length ? <p className="border-t border-[#edf0f2] px-5 py-8 text-center text-xs text-[#71808b]">{copy.sidebar.empty}</p> : null}
      </div>
      <p aria-live="polite" className="min-h-8 border-t border-[#edf0f2] px-5 py-2 text-[11px] text-[#52606d]">{operationMessage}</p>
    </section>
  );
}

export { memberSidebarLinkIconComponents } from "@/components/member-sidebar-link-icons";

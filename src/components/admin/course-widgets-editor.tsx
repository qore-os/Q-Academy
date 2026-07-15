"use client";

import { cloneElement, type FormEvent, type ReactElement } from "react";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ImageIcon,
  Info,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CourseMediaSourceField } from "@/components/admin/course-media-source-field";
import {
  createCourseWidgetAction,
  deleteCourseWidgetAction,
  reorderCourseWidgetsAction,
  updateCourseWidgetAction,
  type CourseWidgetActionResult,
} from "@/lib/course-widget-actions";
import { safeCourseImageSource } from "@/lib/content-blocks/interactive-documents";
import { cn } from "@/lib/utils";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import type { AppLocale } from "@/lib/i18n/model";

type Widget = {
  id: string;
  type: "author" | "info" | "image_link";
  sortOrder: number;
  authorUserId: string | null;
  authorRole: string | null;
  authorDescription: string | null;
  title: string | null;
  text: string | null;
  linkUrl: string | null;
  imageUrl: string | null;
  mediaAssetId?: string | null;
  mediaFileName?: string | null;
  altText: string | null;
  author: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    jobTitle: string | null;
    bio: string | null;
  } | null;
};

type TeamMember = {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  role: "owner" | "admin" | "trainer" | "member";
  status: "active" | "invited" | "disabled";
  jobTitle: string | null;
  bio: string | null;
};

const inputClass =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444] placeholder:text-[var(--theme-muted-text)]";
const textareaClass = cn(inputClass, "h-auto min-h-24 py-2.5 leading-6");

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactElement<{
    id?: string;
    "aria-describedby"?: string;
  }>;
  hint?: string;
}) {
  const generatedId = useId();
  const controlId = children.props.id ?? generatedId;
  const hintId = `${controlId}-hint`;
  const control = cloneElement(children, {
    id: controlId,
    ...(hint ? { "aria-describedby": hintId } : {}),
  });
  return (
    <div className="block">
      <label
        htmlFor={controlId}
        className="mb-1.5 block text-xs font-semibold text-[#52606d]"
      >
        {label}
      </label>
      {control}
      {hint ? (
        <span
          id={hintId}
          className="mt-1 block text-[10px] leading-4 text-[#87919a]"
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function WidgetForm({
  type,
  widget,
  teamMembers,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
  locale,
  courseId,
}: {
  type: Widget["type"];
  widget?: Widget;
  teamMembers: TeamMember[];
  pending: boolean;
  submitLabel: string;
  onSubmit: (formData: FormData) => void;
  onCancel: () => void;
  locale: AppLocale;
  courseId: string;
}) {
  const copy = getCourseSupportCopy(locale).widgets;
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
      className="space-y-4"
    >
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="locale" value={locale} />
      {type === "author" ? (
        <>
          <Field label={copy.teamMember}>
            <select
              name="authorUserId"
              required
              defaultValue={widget?.authorUserId ?? teamMembers[0]?.id ?? ""}
              className={inputClass}
            >
              {!teamMembers.length ? (
                <option value="">{copy.noActiveMember}</option>
              ) : null}
              {teamMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.firstName} {member.lastName}
                </option>
              ))}
            </select>
          </Field>
          <Field label={copy.role} hint={copy.roleHint}>
            <input
              name="roleLabel"
              maxLength={160}
              defaultValue={widget?.authorRole ?? ""}
              className={inputClass}
              placeholder={copy.rolePlaceholder}
            />
          </Field>
          <Field label={copy.description} hint={copy.descriptionHint}>
            <textarea
              name="description"
              maxLength={3_000}
              defaultValue={widget?.authorDescription ?? ""}
              className={textareaClass}
            />
          </Field>
        </>
      ) : null}
      {type === "info" ? (
        <>
          <Field label={copy.titleField}>
            <input
              name="title"
              required
              maxLength={220}
              defaultValue={widget?.title ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label={copy.text}>
            <textarea
              name="text"
              required
              maxLength={5_000}
              defaultValue={widget?.text ?? ""}
              className={textareaClass}
            />
          </Field>
          <Field label={copy.optionalLink} hint={copy.internalLinkHint}>
            <input
              name="linkUrl"
              maxLength={2_000}
              defaultValue={widget?.linkUrl ?? ""}
              className={inputClass}
              placeholder="/academy/events"
            />
          </Field>
        </>
      ) : null}
      {type === "image_link" ? (
        <>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-[#52606d]">
              {copy.imageSource}
            </p>
            <CourseMediaSourceField
              courseId={courseId}
              kind="image"
              label={copy.imageSource}
              defaultAssetId={widget?.mediaAssetId ?? undefined}
              defaultFileName={widget?.mediaFileName ?? undefined}
              defaultUrl={
                widget?.mediaAssetId ? undefined : widget?.imageUrl ?? undefined
              }
              mediaAssetIdName="mediaAssetId"
              urlName="imageUrl"
              preferredMode="upload"
              allowExternalUrl
              allowInternalUrl
              locale={locale}
            />
            <span className="mt-1 block text-[10px] leading-4 text-[#87919a]">
              {copy.imageSourceHint}
            </span>
          </div>
          <Field label={copy.altText}>
            <input
              name="altText"
              required
              maxLength={300}
              defaultValue={widget?.altText ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label={copy.link} hint={copy.internalLinkHint}>
            <input
              name="linkUrl"
              required
              maxLength={2_000}
              defaultValue={widget?.linkUrl ?? ""}
              className={inputClass}
            />
          </Field>
        </>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          <X className="size-4" />
          {copy.cancel}
        </Button>
        <Button type="submit" disabled={pending || (type === "author" && !teamMembers.length)}>
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function WidgetPreview({ widget, locale }: { widget: Widget; locale: AppLocale }) {
  const copy = getCourseSupportCopy(locale).widgets;
  if (widget.type === "author" && widget.author) {
    return (
      <div className="flex items-start gap-3">
        <Avatar
          firstName={widget.author.firstName}
          lastName={widget.author.lastName}
          src={widget.author.avatarUrl}
          size="lg"
        />
        <div className="min-w-0">
          <p className="font-bold text-[#243444]">
            {widget.author.firstName} {widget.author.lastName}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-[#2b9188]">
            {widget.authorRole || widget.author.jobTitle || copy.authorFallback}
          </p>
          {widget.authorDescription || widget.author.bio ? (
            <p className="mt-2 line-clamp-3 whitespace-pre-line text-xs leading-5 text-[#71808b]">
              {widget.authorDescription || widget.author.bio}
            </p>
          ) : null}
        </div>
      </div>
    );
  }
  if (widget.type === "info") {
    return (
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#edf5f7] text-[#276b88]">
          <Info className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-bold text-[#243444]">{widget.title}</p>
          <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs leading-5 text-[#71808b]">
            {widget.text}
          </p>
          {widget.linkUrl ? (
            <p className="mt-2 truncate text-[10px] font-semibold text-[#276b88]">
              {widget.linkUrl}
            </p>
          ) : null}
        </div>
      </div>
    );
  }
  const source = safeCourseImageSource(widget.imageUrl);
  return source ? (
    <div className="overflow-hidden rounded-md border border-[#e1e5e8] bg-[#f4f6f7]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={source}
        alt={widget.altText ?? ""}
        className="aspect-[16/7] w-full object-cover"
      />
      <p className="truncate px-3 py-2 text-[10px] font-semibold text-[#52606d]">
        {widget.linkUrl}
      </p>
    </div>
  ) : null;
}

export function CourseWidgetsEditor({
  courseId,
  widgets,
  teamMembers,
  locale,
}: {
  courseId: string;
  widgets: Widget[];
  teamMembers: TeamMember[];
  locale: AppLocale;
}) {
  const copy = getCourseSupportCopy(locale).widgets;
  const ordered = [...widgets].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
  );
  const [newType, setNewType] = useState<Widget["type"] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (
    task: () => Promise<CourseWidgetActionResult>,
    after?: () => void,
  ) => {
    startTransition(async () => {
      try {
        const result = await task();
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        toast.success(result.message);
        after?.();
        router.refresh();
      } catch {
        toast.error(copy.saveFailed);
      }
    });
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const ids = ordered.map((widget) => widget.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(() => reorderCourseWidgetsAction(courseId, ids, locale));
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h2 className="text-base font-bold text-[#243444]">{copy.title}</h2>
        </div>
        <div className="flex flex-wrap gap-2" aria-label={copy.createAria}>
          <Button type="button" variant="secondary" onClick={() => setNewType("author")}>
            <UserRound className="size-4" />
            {copy.types.author}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setNewType("info")}>
            <Info className="size-4" />
            {copy.types.info}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setNewType("image_link")}>
            <ImageIcon className="size-4" />
            {copy.types.image_link}
          </Button>
        </div>
      </div>

      {newType ? (
        <section className="mt-5 rounded-md border border-[#cfe0e4] bg-[#f7fafb] p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <Plus className="size-4 text-[#2b9188]" />
            <h3 className="text-sm font-bold text-[#243444]">{copy.createTitle}</h3>
          </div>
          <WidgetForm
            type={newType}
            teamMembers={teamMembers}
            pending={pending}
            submitLabel={copy.create}
            locale={locale}
            courseId={courseId}
            onCancel={() => setNewType(null)}
            onSubmit={(formData) =>
              run(() => createCourseWidgetAction(courseId, formData), () => setNewType(null))
            }
          />
        </section>
      ) : null}

      <div className="mt-5 space-y-3">
        {ordered.map((widget, index) => (
          <article
            key={widget.id}
            data-widget-id={widget.id}
            className="rounded-md border border-[#e1e5e8] bg-white p-4 sm:p-5"
          >
            {editingId === widget.id ? (
              <WidgetForm
                type={widget.type}
                widget={widget}
                teamMembers={teamMembers}
                pending={pending}
                submitLabel={copy.saveChanges}
                locale={locale}
                courseId={courseId}
                onCancel={() => setEditingId(null)}
                onSubmit={(formData) =>
                  run(
                    () => updateCourseWidgetAction(courseId, widget.id, formData),
                    () => setEditingId(null),
                  )
                }
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <WidgetPreview widget={widget} locale={locale} />
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={pending || index === 0}
                    className="focus-ring grid size-9 place-items-center rounded-md text-[#66727f] hover:bg-[#f1f4f5] disabled:opacity-35"
                    title={getCourseSupportCopy(locale).common.moveUp}
                    aria-label={copy.moveUp(copy.types[widget.type])}
                  >
                    <ArrowUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={pending || index === ordered.length - 1}
                    className="focus-ring grid size-9 place-items-center rounded-md text-[#66727f] hover:bg-[#f1f4f5] disabled:opacity-35"
                    title={getCourseSupportCopy(locale).common.moveDown}
                    aria-label={copy.moveDown(copy.types[widget.type])}
                  >
                    <ArrowDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(widget.id)}
                    disabled={pending}
                    className="focus-ring grid size-9 place-items-center rounded-md text-[#47606f] hover:bg-[#edf3f7] disabled:opacity-50"
                    title={getCourseSupportCopy(locale).common.edit}
                    aria-label={copy.editWidget(copy.types[widget.type])}
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingId(widget.id)}
                    disabled={pending}
                    className="focus-ring grid size-9 place-items-center rounded-md text-[#b84e42] hover:bg-[#fcefee] disabled:opacity-50"
                    title={getCourseSupportCopy(locale).common.delete}
                    aria-label={copy.deleteWidget(copy.types[widget.type])}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            )}
            {deletingId === widget.id && editingId !== widget.id ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f2] pt-4">
                <p className="text-xs font-semibold text-[#7d4b46]">
                  {copy.confirmDelete}
                </p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setDeletingId(null)}>
                    {copy.cancel}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => deleteCourseWidgetAction(courseId, widget.id, locale),
                        () => setDeletingId(null),
                      )
                    }
                  >
                    <Trash2 className="size-3.5" />
                    {getCourseSupportCopy(locale).common.delete}
                  </Button>
                </div>
              </div>
            ) : null}
          </article>
        ))}
        {!ordered.length ? (
          <div className="grid min-h-56 place-items-center rounded-md border border-dashed border-[#cbd5dc] bg-[#fafbfb] text-center">
            <div>
              <ImageIcon className="mx-auto size-6 text-[#8b979f]" />
              <p className="mt-2 text-sm font-semibold text-[#52606d]">
                {copy.empty}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

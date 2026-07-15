"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  FolderTree,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  createCourseCategoryAdminAction,
  deleteCourseCategoryAdminAction,
  previewCourseCategoryDeletionAdminAction,
  reorderCourseCategoriesAdminAction,
  updateCourseCategoryAdminAction,
  type CourseCategoryActionState,
} from "@/lib/admin/course-category-actions";
import {
  getCourseCategoryActionCopy,
  getCourseCategoryColorCopy,
  getCourseCategoryDeletionUsageCopy,
  getCourseSupportCopy,
} from "@/lib/i18n/course-support";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";

export type CourseCategoryAdminView = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  sortOrder: number;
  courseCount: number;
};

const initialState: CourseCategoryActionState = { ok: null, message: "" };
const inputClassName =
  "focus-ring h-10 w-full min-w-0 rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444]";

function DialogFrame({
  title,
  pending,
  onClose,
  children,
  locale,
}: {
  title: string;
  pending: boolean;
  onClose: () => void;
  children: React.ReactNode;
  locale: AppLocale;
}) {
  const copy = getCourseSupportCopy(locale).categories;
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, pending]);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-[#0f263c]/45 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div className="my-4 w-full max-w-lg overflow-hidden rounded-md border border-[#dce1e5] bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-[#e8ebee] px-4 py-3 sm:px-5">
          <h2 className="text-base font-bold text-[#243444]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3] disabled:opacity-50"
            aria-label={copy.close}
            title={copy.close}
          >
            <X className="size-5" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function CategoryFormDialog({
  category,
  onClose,
  locale,
}: {
  category: CourseCategoryAdminView | null;
  onClose: () => void;
  locale: AppLocale;
}) {
  const copy = getCourseSupportCopy(locale).categories;
  const colorCopy = getCourseCategoryColorCopy(locale);
  const router = useRouter();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const action = category
    ? updateCourseCategoryAdminAction.bind(null, category.id)
    : createCourseCategoryAdminAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [color, setColor] = useState(category?.color ?? "#2bb7a9");

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (state.ok === true) {
      toast.success(state.message);
      router.refresh();
      onClose();
    } else if (state.ok === false) {
      toast.error(state.message);
    }
  }, [onClose, router, state]);

  return (
    <DialogFrame
      title={category ? copy.editTitle : copy.createTitle}
      pending={pending}
      onClose={onClose}
      locale={locale}
    >
      <form action={formAction} className="grid gap-4 p-4 sm:p-5">
        <input type="hidden" name="locale" value={locale} />
        <label>
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.name}
          </span>
          <input
            ref={nameInputRef}
            name="name"
            defaultValue={category?.name ?? ""}
            minLength={2}
            maxLength={120}
            required
            className={inputClassName}
          />
        </label>
        <label>
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.description}
          </span>
          <textarea
            name="description"
            defaultValue={category?.description ?? ""}
            maxLength={5000}
            className="focus-ring min-h-24 w-full min-w-0 resize-y rounded-md border border-[#dce1e5] bg-white px-3 py-2 text-sm text-[#243444]"
          />
        </label>
        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold text-[#52606d]">
            {copy.color}
          </legend>
          <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2">
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="focus-ring h-10 w-11 cursor-pointer rounded-md border border-[#dce1e5] bg-white p-1"
              aria-label={colorCopy.picker}
            />
            <input
              name="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              pattern="#[0-9a-fA-F]{6}"
              maxLength={7}
              required
              aria-label={colorCopy.hex}
              className={`${inputClassName} font-mono`}
            />
          </div>
        </fieldset>
        {state.ok === false ? (
          <p
            className="rounded-md border border-[#f4c8c2] bg-[#fdf0ee] px-3 py-2 text-xs text-[#a94339]"
            role="alert"
          >
            {state.message}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-[#e8ebee] pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={pending}
          >
            {copy.cancel}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {category ? copy.save : copy.create}
          </Button>
        </div>
      </form>
    </DialogFrame>
  );
}

function DeleteCategoryDialog({
  category,
  onClose,
  locale,
}: {
  category: CourseCategoryAdminView;
  onClose: () => void;
  locale: AppLocale;
}) {
  const copy = getCourseSupportCopy(locale).categories;
  const numberFormatter = new Intl.NumberFormat(intlLocale(locale));
  const router = useRouter();
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  useEffect(() => {
    confirmButtonRef.current?.focus();
  }, []);

  const remove = () => {
    setError("");
    startTransition(async () => {
      const result = await deleteCourseCategoryAdminAction(
        category.id,
        category.courseCount,
        locale,
      );
      if (!result.ok) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.refresh();
      onClose();
    });
  };

  return (
    <DialogFrame
      title={copy.confirmTitle}
      pending={pending}
      onClose={onClose}
      locale={locale}
    >
      <div className="grid gap-4 p-4 sm:p-5">
        <p className="text-sm leading-6 text-[#354555]">
          {copy.confirmQuestion(category.name)}
        </p>
        {category.courseCount > 0 ? (
          <p className="rounded-md border border-[#ead9a8] bg-[#fbf6e7] px-3 py-2 text-xs leading-5 text-[#735a18]">
            {getCourseCategoryDeletionUsageCopy(
              locale,
              numberFormatter.format(category.courseCount),
            )}
          </p>
        ) : (
          <p className="text-xs leading-5 text-[#66727f]">
            {copy.confirmUnused}
          </p>
        )}
        {error ? (
          <p className="text-xs text-[#a94339]" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-[#e8ebee] pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={pending}
          >
            {copy.cancel}
          </Button>
          <Button
            ref={confirmButtonRef}
            type="button"
            variant="danger"
            onClick={remove}
            disabled={pending}
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            {copy.confirmDelete}
          </Button>
        </div>
      </div>
    </DialogFrame>
  );
}

export function CourseCategoryManager({
  categories,
  locale,
}: {
  categories: CourseCategoryAdminView[];
  locale: AppLocale;
}) {
  const copy = getCourseSupportCopy(locale).categories;
  const numberFormatter = new Intl.NumberFormat(intlLocale(locale));
  const actionCopy = getCourseCategoryActionCopy(locale);
  const router = useRouter();
  const [orderedCategories, setOrderedCategories] = useState(categories);
  const [editorCategory, setEditorCategory] = useState<
    CourseCategoryAdminView | null | undefined
  >(undefined);
  const [deleteCategory, setDeleteCategory] = useState<
    CourseCategoryAdminView | undefined
  >(undefined);
  const [statusMessage, setStatusMessage] = useState("");
  const [reorderPending, startReorderTransition] = useTransition();
  const [deletePreviewPending, startDeletePreviewTransition] = useTransition();

  const openDeleteDialog = (category: CourseCategoryAdminView) => {
    startDeletePreviewTransition(async () => {
      const result = await previewCourseCategoryDeletionAdminAction(category.id, locale);
      if (!result.ok || result.courseCount === undefined) {
        toast.error(result.message);
        return;
      }
      setDeleteCategory({ ...category, courseCount: result.courseCount });
    });
  };

  const moveCategory = (index: number, offset: -1 | 1) => {
    const targetIndex = index + offset;
    if (
      reorderPending ||
      targetIndex < 0 ||
      targetIndex >= orderedCategories.length
    ) {
      return;
    }
    const previous = orderedCategories;
    const next = [...orderedCategories];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    setOrderedCategories(next);
    setStatusMessage("");
    startReorderTransition(async () => {
      const result = await reorderCourseCategoriesAdminAction(
        next.map((category) => category.id),
        locale,
      );
      if (!result.ok) {
        setOrderedCategories(previous);
        setStatusMessage(result.message);
        toast.error(result.message);
        router.refresh();
        return;
      }
      setStatusMessage(result.message);
      toast.success(result.message);
      router.refresh();
    });
  };

  return (
    <section
      className="panel min-w-0 overflow-hidden"
      aria-labelledby="course-categories-heading"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-[#e8ebee] px-4 py-3 sm:px-5">
        <FolderTree className="size-4 text-[#2b9188]" />
        <div className="min-w-0 flex-1">
          <h2
            id="course-categories-heading"
            className="text-sm font-bold text-[#243444]"
          >
            {copy.manageTitle}
          </h2>
          <p className="mt-0.5 text-[11px] text-[#71808b]">
            {copy.count(numberFormatter.format(orderedCategories.length))}
          </p>
        </div>
        <Button size="sm" onClick={() => setEditorCategory(null)}>
          <Plus className="size-4" />
          {copy.create}
        </Button>
      </header>
      <div className="divide-y divide-[#e8ebee]">
        {orderedCategories.length === 0 ? (
          <p className="px-4 py-5 text-sm text-[#66727f] sm:px-5">
            {copy.empty}
          </p>
        ) : (
          orderedCategories.map((category, index) => (
            <div
              key={category.id}
              className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-5 lg:grid-cols-[auto_minmax(12rem,1fr)_minmax(12rem,1.5fr)_auto_auto]"
            >
              <span
                className="size-4 shrink-0 rounded-sm border border-black/10"
                style={{ backgroundColor: category.color }}
                aria-hidden="true"
                title={category.color}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#243444]">
                  {category.name}
                </p>
                <p className="truncate text-[10px] text-[#8a949d]">
                  {category.slug}
                </p>
              </div>
              <p className="hidden min-w-0 truncate text-xs text-[#66727f] lg:block">
                {category.description || copy.noDescription}
              </p>
              <Badge tone={category.courseCount > 0 ? "teal" : "neutral"}>
                {copy.courseCount(numberFormatter.format(category.courseCount))}
              </Badge>
              <div className="col-span-3 flex items-center justify-end gap-0.5 lg:col-span-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => moveCategory(index, -1)}
                  disabled={index === 0 || reorderPending}
                  aria-label={actionCopy.moveUp(category.name)}
                  title={copy.moveUp}
                >
                  {reorderPending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ArrowUp className="size-4" />
                  )}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => moveCategory(index, 1)}
                  disabled={
                    index === orderedCategories.length - 1 || reorderPending
                  }
                  aria-label={actionCopy.moveDown(category.name)}
                  title={copy.moveDown}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => setEditorCategory(category)}
                  disabled={reorderPending}
                  aria-label={actionCopy.edit(category.name)}
                  title={copy.edit}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-[#a94339] hover:text-[#a94339]"
                  onClick={() => openDeleteDialog(category)}
                  disabled={reorderPending || deletePreviewPending}
                  aria-label={actionCopy.delete(category.name)}
                  title={copy.delete}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {statusMessage}
      </p>
      {editorCategory !== undefined ? (
        <CategoryFormDialog
          key={editorCategory?.id ?? "new"}
          category={editorCategory}
          locale={locale}
          onClose={() => setEditorCategory(undefined)}
        />
      ) : null}
      {deleteCategory ? (
        <DeleteCategoryDialog
          key={deleteCategory.id}
          category={deleteCategory}
          locale={locale}
          onClose={() => setDeleteCategory(undefined)}
        />
      ) : null}
    </section>
  );
}

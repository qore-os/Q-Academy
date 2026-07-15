"use client";

import { Archive, LoaderCircle, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { changeCourseLifecycleAction } from "@/lib/course-lifecycle-actions";
import { getCourseParityCopy } from "@/lib/i18n/course-parity";
import type { AppLocale } from "@/lib/i18n/model";

export function CourseLifecycleActions({
  courseId,
  status,
  locale,
}: {
  courseId: string;
  status: "draft" | "published" | "archived";
  locale: AppLocale;
}) {
  const router = useRouter();
  const copy = getCourseParityCopy(locale).lifecycle;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const restoring = status === "archived";

  const submit = () => {
    startTransition(async () => {
      const result = await changeCourseLifecycleAction(
        courseId,
        restoring ? "restore" : "archive",
        locale,
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        {restoring ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
        {restoring ? copy.restore : copy.archive}
      </Button>
      {open ? (
        <div className="fixed inset-0 z-[90] grid place-items-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-[#0f263c]/55"
            onClick={() => !pending && setOpen(false)}
            aria-label={copy.close}
          />
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="course-lifecycle-title"
            aria-describedby="course-lifecycle-description"
            className="relative w-full max-w-md rounded-md bg-white p-5 shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="focus-ring absolute right-3 top-3 grid size-8 place-items-center rounded-md text-[#71808b] hover:bg-[#f1f3f5]"
              aria-label={copy.close}
            >
              <X className="size-4" />
            </button>
            <span className="grid size-10 place-items-center rounded-md bg-[#f4ece8] text-[#9b5148]">
              {restoring ? <RotateCcw className="size-5" /> : <Archive className="size-5" />}
            </span>
            <h2 id="course-lifecycle-title" className="mt-4 pr-8 text-base font-bold text-[#243444]">
              {restoring ? copy.restoreTitle : copy.archiveTitle}
            </h2>
            <p id="course-lifecycle-description" className="mt-2 text-sm leading-6 text-[#61707c]">
              {restoring ? copy.restoreDescription : copy.archiveDescription}
            </p>
            <div className="mt-5 flex justify-end gap-2 border-t border-[#edf0f2] pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                {copy.close}
              </Button>
              <Button
                type="button"
                variant={restoring ? "primary" : "danger"}
                onClick={submit}
                disabled={pending}
              >
                {pending ? <LoaderCircle className="size-4 animate-spin" /> : restoring ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
                {pending
                  ? copy.pending
                  : restoring
                    ? copy.restoreConfirm
                    : copy.archiveConfirm}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

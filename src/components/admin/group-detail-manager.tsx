"use client";

import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Check,
  Layers3,
  LoaderCircle,
  PackageOpen,
  Plus,
  Save,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  addGroupBundleAdminAction,
  addGroupCourseAdminAction,
  addGroupMemberAdminAction,
  removeGroupBundleAdminAction,
  removeGroupCourseAdminAction,
  removeGroupMemberAdminAction,
  updateGroupAdminAction,
  type AccessManagementActionResult,
} from "@/lib/admin/access-management-actions";
import {
  formatAdminEntityDifficulty,
  formatAdminEntityNumber,
  getAdminEntityCopy,
  type AdminEntityCopy,
  type AdminEntityUiKey,
} from "@/lib/i18n/admin-entities";
import type { AppLocale } from "@/lib/i18n/model";
import { useHydrated } from "@/lib/use-hydrated";
import { formatDate, formatDuration } from "@/lib/utils";

type GroupDetailData = {
  group: {
    id: string;
    name: string;
    description: string | null;
    color: string;
    memberCount: number;
    directCourseCount: number;
    bundleCount: number;
    effectiveLearnerCount: number;
  };
  members: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    status: string;
    department: string | null;
    joinedAt: Date | string;
  }>;
  directCourses: Array<{
    id: string;
    title: string;
    status: string;
    difficulty: string;
    estimatedMinutes: number;
  }>;
  bundles: Array<{
    id: string;
    name: string;
    description: string | null;
    color: string;
    active: boolean;
    courseCount: number;
  }>;
  availableMembers: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    status: string;
  }>;
  availableCourses: Array<{ id: string; title: string; status: string }>;
  availableBundles: Array<{ id: string; name: string; active: boolean }>;
};

const inputClass =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444]";
const textareaClass = `${inputClass} h-auto min-h-24 py-2.5 leading-6`;

function RemoveControl({
  copy,
  label,
  hydrated,
  pending,
  onRemove,
}: {
  copy: AdminEntityCopy;
  label: string;
  hydrated: boolean;
  pending: boolean;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={pending || !hydrated}
        className="focus-ring grid size-9 shrink-0 place-items-center rounded-md text-[#8a949d] hover:bg-[#fdf0ee] hover:text-[#c95b4f] disabled:opacity-40"
        aria-label={copy("common.removeNamed", { name: label })}
        title={copy("common.removeNamed", { name: label })}
      >
        <Trash2 className="size-4" />
      </button>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-md bg-[#fdf0ee] p-1">
      <button
        type="button"
        onClick={onRemove}
        disabled={pending || !hydrated}
        className="focus-ring grid size-8 place-items-center rounded text-[#b84e42] hover:bg-white disabled:opacity-40"
        aria-label={copy("common.reallyRemoveNamed", { name: label })}
        title={copy("common.confirmRemove")}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending || !hydrated}
        className="focus-ring grid size-8 place-items-center rounded text-[#66727f] hover:bg-white disabled:opacity-40"
        aria-label={copy("common.cancelRemove")}
        title={copy("common.cancel")}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function AddForm({
  copy,
  label,
  name,
  hydrated,
  pending,
  options,
  onAdd,
}: {
  copy: AdminEntityCopy;
  label: string;
  name: string;
  hydrated: boolean;
  pending: boolean;
  options: Array<{ id: string; label: string; suffix?: string }>;
  onAdd: (id: string) => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = String(new FormData(event.currentTarget).get(name) ?? "");
    if (id) onAdd(id);
  };
  if (!options.length) {
    return (
      <p className="text-[11px] text-[#7d8891]">
        {copy("common.noOptions")}
      </p>
    );
  }
  return (
    <form
      onSubmit={submit}
      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <label className="sr-only" htmlFor={`${name}-select`}>
        {label}
      </label>
      <select
        id={`${name}-select`}
        name={name}
        defaultValue=""
        className={inputClass}
        required
      >
        <option value="" disabled>
          {label}
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
            {option.suffix ? ` | ${option.suffix}` : ""}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={pending || !hydrated}>
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Plus className="size-4" />
        )}
        {copy("common.add")}
      </Button>
    </form>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof UsersRound;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]">
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-lg font-bold text-[#243444]">{value}</p>
        <p className="text-[10px] text-[#7a8690]">{label}</p>
      </div>
    </div>
  );
}

export function GroupDetailManager({
  data,
  locale,
}: {
  data: GroupDetailData;
  locale: AppLocale;
}) {
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const copy = getAdminEntityCopy(locale);

  const run = (
    task: () => Promise<AccessManagementActionResult>,
    successKey: AdminEntityUiKey,
  ) => {
    startTransition(async () => {
      try {
        const result = await task();
        if (!result.ok) {
          toast.error(copy("common.genericError"));
          return;
        }
        toast.success(copy(successKey));
        router.refresh();
      } catch {
        toast.error(copy("common.genericError"));
      }
    });
  };

  return (
    <div className="space-y-5">
      <section className="panel overflow-hidden">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => updateGroupAdminAction(data.group.id, formData),
              "group.saved",
            );
          }}
          className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy("group.name")}
              </span>
              <input
                name="name"
                defaultValue={data.group.name}
                className={inputClass}
                required
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy("common.description")}
              </span>
              <textarea
                name="description"
                defaultValue={data.group.description ?? ""}
                className={textareaClass}
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy("group.color")}
            </span>
            <span className="flex h-10 items-center gap-3 rounded-md border border-[#dce1e5] bg-white px-3">
              <input
                name="color"
                type="color"
                defaultValue={data.group.color}
                className="size-6 cursor-pointer border-0 bg-transparent p-0"
              />
              <span className="text-xs text-[#66727f]">{data.group.color}</span>
            </span>
          </label>
          <Button type="submit" disabled={pending || !hydrated}>
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {copy("common.save")}
          </Button>
        </form>
        <div className="grid divide-y divide-[#edf0f2] border-t border-[#edf0f2] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <Metric
            label={copy("common.members")}
            value={formatAdminEntityNumber(data.group.memberCount, locale)}
            icon={UsersRound}
          />
          <Metric
            label={copy("group.directCourses")}
            value={formatAdminEntityNumber(data.group.directCourseCount, locale)}
            icon={BookOpen}
          />
          <Metric
            label={copy("common.bundles")}
            value={formatAdminEntityNumber(data.group.bundleCount, locale)}
            icon={PackageOpen}
          />
          <Metric
            label={copy("common.activeLearners")}
            value={formatAdminEntityNumber(data.group.effectiveLearnerCount, locale)}
            icon={UserRound}
          />
        </div>
      </section>

      <section className="panel overflow-hidden">
        <header className="border-b border-[#e8ebee] px-4 py-4 sm:px-5">
          <div className="flex items-center gap-2">
            <UsersRound className="size-4 text-[#4f7cac]" />
            <h2 className="text-sm font-bold text-[#243444]">
              {copy("common.members")}
            </h2>
            <Badge tone="neutral">
              {formatAdminEntityNumber(data.members.length, locale)}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] text-[#7a8690]">
            {copy("group.newMembersHint")}
          </p>
        </header>
        <div className="border-b border-[#edf0f2] bg-[#fafbfb] p-4 sm:p-5">
          <AddForm
            copy={copy}
            label={copy("common.selectMember")}
            name="memberId"
            hydrated={hydrated}
            pending={pending}
            options={data.availableMembers.map((member) => ({
              id: member.id,
              label: `${member.firstName} ${member.lastName}`,
              suffix: member.email,
            }))}
            onAdd={(id) =>
              run(
                () => addGroupMemberAdminAction(data.group.id, id),
                "group.memberAdded",
              )
            }
          />
        </div>
        <div className="divide-y divide-[#edf0f2]">
          {data.members.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-3 px-4 py-3 sm:px-5"
            >
              <Avatar
                firstName={member.firstName}
                lastName={member.lastName}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/admin/members/${member.id}`}
                  className="focus-ring rounded text-sm font-semibold text-[#2b3a48] hover:text-[#176f68]"
                >
                  {member.firstName} {member.lastName}
                </Link>
                <p className="truncate text-[10px] text-[#7a8690]">
                  {member.email}
                  {member.department ? ` | ${member.department}` : ""} |{" "}
                  {copy("group.joined", {
                    date: formatDate(member.joinedAt, undefined, locale),
                  })}
                </p>
              </div>
              <Badge tone={member.status === "active" ? "teal" : "amber"}>
                {member.status === "active"
                  ? copy("common.active")
                  : copy("group.invited")}
              </Badge>
              <RemoveControl
                copy={copy}
                label={`${member.firstName} ${member.lastName}`}
                hydrated={hydrated}
                pending={pending}
                onRemove={() =>
                  run(
                    () =>
                      removeGroupMemberAdminAction(data.group.id, member.id),
                    "group.memberRemoved",
                  )
                }
              />
            </div>
          ))}
          {!data.members.length ? (
            <div className="grid min-h-32 place-items-center text-xs text-[#7d8891]">
              {copy("group.emptyMembers")}
            </div>
          ) : null}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="panel overflow-hidden">
          <header className="border-b border-[#e8ebee] px-4 py-4 sm:px-5">
            <div className="flex items-center gap-2">
              <BookOpen className="size-4 text-[#2b9188]" />
              <h2 className="text-sm font-bold text-[#243444]">
                {copy("group.directCourses")}
              </h2>
              <Badge tone="blue">
                {formatAdminEntityNumber(data.directCourses.length, locale)}
              </Badge>
            </div>
            <p className="mt-1 text-[11px] text-[#7a8690]">
              {copy("group.directCoursesHint")}
            </p>
          </header>
          <div className="border-b border-[#edf0f2] bg-[#fafbfb] p-4">
            <AddForm
              copy={copy}
              label={copy("common.selectCourse")}
              name="courseId"
              hydrated={hydrated}
              pending={pending}
              options={data.availableCourses.map((course) => ({
                id: course.id,
                label: course.title,
                suffix:
                  course.status === "published"
                    ? copy("common.live")
                    : copy("common.draft"),
              }))}
              onAdd={(id) =>
                run(
                  () => addGroupCourseAdminAction(data.group.id, id),
                  "group.courseAdded",
                )
              }
            />
          </div>
          <div className="divide-y divide-[#edf0f2]">
            {data.directCourses.map((course) => (
              <div
                key={course.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#e9f8f6] text-[#176f68]">
                  <BookOpen className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/courses/${course.id}`}
                    className="focus-ring rounded text-xs font-semibold text-[#2b3a48] hover:text-[#176f68]"
                  >
                    {course.title}
                  </Link>
                  <p className="text-[10px] text-[#7a8690]">
                    {formatAdminEntityDifficulty(course.difficulty, copy)} |{" "}
                    {formatDuration(course.estimatedMinutes, locale)}
                  </p>
                </div>
                <Badge tone={course.status === "published" ? "teal" : "amber"}>
                  {course.status === "published"
                    ? copy("common.live")
                    : copy("common.draft")}
                </Badge>
                <RemoveControl
                  copy={copy}
                  label={course.title}
                  hydrated={hydrated}
                  pending={pending}
                  onRemove={() =>
                    run(
                      () =>
                        removeGroupCourseAdminAction(data.group.id, course.id),
                      "group.courseRemoved",
                    )
                  }
                />
              </div>
            ))}
            {!data.directCourses.length ? (
              <div className="grid min-h-28 place-items-center text-xs text-[#7d8891]">
                {copy("group.emptyCourses")}
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel overflow-hidden">
          <header className="border-b border-[#e8ebee] px-4 py-4 sm:px-5">
            <div className="flex items-center gap-2">
              <PackageOpen className="size-4 text-[#c95b4f]" />
              <h2 className="text-sm font-bold text-[#243444]">
                {copy("common.bundles")}
              </h2>
              <Badge tone="neutral">
                {formatAdminEntityNumber(data.bundles.length, locale)}
              </Badge>
            </div>
            <p className="mt-1 text-[11px] text-[#7a8690]">
              {copy("group.bundlesHint")}
            </p>
          </header>
          <div className="border-b border-[#edf0f2] bg-[#fafbfb] p-4">
            <AddForm
              copy={copy}
              label={copy("common.selectBundle")}
              name="bundleId"
              hydrated={hydrated}
              pending={pending}
              options={data.availableBundles.map((bundle) => ({
                id: bundle.id,
                label: bundle.name,
                suffix: bundle.active
                  ? copy("common.active")
                  : copy("common.paused"),
              }))}
              onAdd={(id) =>
                run(
                  () => addGroupBundleAdminAction(data.group.id, id),
                  "group.bundleAdded",
                )
              }
            />
          </div>
          <div className="divide-y divide-[#edf0f2]">
            {data.bundles.map((bundle) => (
              <div
                key={bundle.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-md bg-[#f4f6f7]"
                  style={{ color: bundle.color }}
                >
                  <PackageOpen className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/bundles/${bundle.id}`}
                    className="focus-ring rounded text-xs font-semibold text-[#2b3a48] hover:text-[#176f68]"
                  >
                    {bundle.name}
                  </Link>
                  <p className="text-[10px] text-[#7a8690]">
                    {copy("common.courseCount", {
                      count: formatAdminEntityNumber(bundle.courseCount, locale),
                    })}
                  </p>
                </div>
                <Badge tone={bundle.active ? "teal" : "neutral"}>
                  {bundle.active
                    ? copy("common.active")
                    : copy("common.paused")}
                </Badge>
                <RemoveControl
                  copy={copy}
                  label={bundle.name}
                  hydrated={hydrated}
                  pending={pending}
                  onRemove={() =>
                    run(
                      () =>
                        removeGroupBundleAdminAction(data.group.id, bundle.id),
                      "group.bundleRemoved",
                    )
                  }
                />
              </div>
            ))}
            {!data.bundles.length ? (
              <div className="grid min-h-28 place-items-center text-xs text-[#7d8891]">
                {copy("group.emptyBundles")}
              </div>
            ) : null}
          </div>
        </section>
      </div>
      <p className="flex items-center gap-2 text-[10px] text-[#7d8891]">
        <Layers3 className="size-3.5" />
        {copy("group.preserveHint")}
      </p>
    </div>
  );
}

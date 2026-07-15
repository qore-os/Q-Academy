"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Target,
  Trash2,
  UserRound,
} from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";

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

type CourseAuthor = {
  id: string;
  userId: string;
  sortOrder: number;
  author: TeamMember;
};

type GoalDraft = { key: string; text: string };

const inputClass =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444] placeholder:text-[var(--theme-muted-text)]";

function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function OrderButtons({
  label,
  index,
  count,
  locale,
  onMove,
}: {
  label: string;
  index: number;
  count: number;
  locale: AppLocale;
  onMove: (direction: -1 | 1) => void;
}) {
  const copy = getCourseSupportCopy(locale).common;
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => onMove(-1)}
        disabled={index === 0}
        className="focus-ring grid size-9 place-items-center rounded-md text-[#66727f] hover:bg-[#f1f4f5] disabled:opacity-35"
        aria-label={`${label} ${copy.moveUp}`}
        title={copy.moveUp}
      >
        <ArrowUp className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => onMove(1)}
        disabled={index === count - 1}
        className="focus-ring grid size-9 place-items-center rounded-md text-[#66727f] hover:bg-[#f1f4f5] disabled:opacity-35"
        aria-label={`${label} ${copy.moveDown}`}
        title={copy.moveDown}
      >
        <ArrowDown className="size-4" />
      </button>
    </div>
  );
}

export function CourseInformationListsEditor({
  learningGoals,
  courseAuthors,
  teamMembers,
  locale,
}: {
  learningGoals: Array<{ id: string; text: string; sortOrder: number }>;
  courseAuthors: CourseAuthor[];
  teamMembers: TeamMember[];
  locale: AppLocale;
}) {
  const copy = getCourseSupportCopy(locale);
  const numberFormatter = new Intl.NumberFormat(intlLocale(locale));
  const [goals, setGoals] = useState<GoalDraft[]>(
    [...learningGoals]
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
      )
      .map((goal) => ({ key: goal.id, text: goal.text })),
  );
  const [authorIds, setAuthorIds] = useState(
    [...courseAuthors]
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
      )
      .map((author) => author.userId),
  );
  const [authorToAdd, setAuthorToAdd] = useState("");
  const authorsById = useMemo(
    () =>
      new Map([
        ...teamMembers.map((member) => [member.id, member] as const),
        ...courseAuthors.map(({ author }) => [author.id, author] as const),
      ]),
    [courseAuthors, teamMembers],
  );
  const availableAuthors = teamMembers.filter(
    (member) => !authorIds.includes(member.id),
  );
  const selectedAuthorToAdd = availableAuthors.some(
    (member) => member.id === authorToAdd,
  )
    ? authorToAdd
    : (availableAuthors[0]?.id ?? "");

  return (
    <div className="space-y-6 sm:col-span-2">
      <section className="border-t border-[#e5e8eb] pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Target className="size-4 text-[#2b9188]" />
            <h3 className="text-sm font-bold text-[#243444]">{copy.information.goals}</h3>
          </div>
          <button
            type="button"
            onClick={() =>
              setGoals((current) => [
                ...current,
                { key: `new-${Date.now()}-${current.length}`, text: "" },
              ])
            }
            disabled={goals.length >= 20}
            className="focus-ring grid size-9 place-items-center rounded-md text-[#176f68] hover:bg-[#e9f8f6] disabled:opacity-40"
            aria-label={copy.information.addGoal}
            title={copy.information.addGoal}
          >
            <Plus className="size-4" />
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {goals.map((goal, index) => (
            <div
              key={goal.key}
              className="grid items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
            >
              <span className="hidden w-6 text-center text-xs font-bold text-[#8a949d] sm:block">
                {numberFormatter.format(index + 1)}
              </span>
              <label className="sr-only" htmlFor={`learning-goal-${goal.key}`}>
                {copy.information.goal(numberFormatter.format(index + 1))}
              </label>
              <input
                id={`learning-goal-${goal.key}`}
                name="learningGoals"
                value={goal.text}
                onChange={(event) =>
                  setGoals((current) =>
                    current.map((entry) =>
                      entry.key === goal.key
                        ? { ...entry, text: event.target.value }
                        : entry,
                    ),
                  )
                }
                maxLength={500}
                required
                className={inputClass}
              />
              <div className="flex items-center justify-end gap-1">
                <OrderButtons
                  label={copy.information.goal(numberFormatter.format(index + 1))}
                  index={index}
                  count={goals.length}
                  locale={locale}
                  onMove={(direction) =>
                    setGoals((current) => moveItem(current, index, direction))
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    setGoals((current) =>
                      current.filter((entry) => entry.key !== goal.key),
                    )
                  }
                  className="focus-ring grid size-9 place-items-center rounded-md text-[#b84e42] hover:bg-[#fcefee]"
                  aria-label={copy.information.deleteGoal(numberFormatter.format(index + 1))}
                  title={copy.common.delete}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-[#e5e8eb] pt-5">
        <div className="flex items-center gap-2">
          <UserRound className="size-4 text-[#4f7cac]" />
          <h3 className="text-sm font-bold text-[#243444]">{copy.information.authors}</h3>
        </div>
        {availableAuthors.length > 0 && authorIds.length < 20 ? (
          <div className="mt-3 flex gap-2">
            <label className="sr-only" htmlFor="course-author-add">
              {copy.information.authorSelect}
            </label>
            <select
              id="course-author-add"
              value={selectedAuthorToAdd}
              onChange={(event) => setAuthorToAdd(event.target.value)}
              className={inputClass}
            >
              {availableAuthors.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.firstName} {member.lastName}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                if (!selectedAuthorToAdd) return;
                setAuthorIds((current) => [...current, selectedAuthorToAdd]);
                setAuthorToAdd("");
              }}
              className="focus-ring grid size-10 shrink-0 place-items-center rounded-md bg-[#17324d] text-white hover:bg-[#244765]"
              aria-label={copy.information.addAuthor}
              title={copy.information.addAuthor}
            >
              <Plus className="size-4" />
            </button>
          </div>
        ) : null}
        <div className="mt-3 space-y-2">
          {authorIds.map((authorId, index) => {
            const author = authorsById.get(authorId);
            if (!author) return null;
            return (
              <div
                key={authorId}
                className="flex flex-wrap items-center gap-3 rounded-md border border-[#e1e5e8] bg-white p-3 sm:flex-nowrap"
              >
                <input type="hidden" name="authorIds" value={authorId} />
                <Avatar
                  firstName={author.firstName}
                  lastName={author.lastName}
                  src={author.avatarUrl}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-[#354555]">
                    {author.firstName} {author.lastName}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-[#7a8690]">
                    {author.jobTitle ?? copy.common.teamMember}
                  </p>
                </div>
                <OrderButtons
                  label={`${author.firstName} ${author.lastName}`}
                  index={index}
                  count={authorIds.length}
                  locale={locale}
                  onMove={(direction) =>
                    setAuthorIds((current) => moveItem(current, index, direction))
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    setAuthorIds((current) =>
                      current.filter((id) => id !== authorId),
                    )
                  }
                  className="focus-ring grid size-9 place-items-center rounded-md text-[#b84e42] hover:bg-[#fcefee]"
                  aria-label={copy.information.removeAuthor(
                    `${author.firstName} ${author.lastName}`,
                  )}
                  title={copy.access.remove}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

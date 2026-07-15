import { CheckCircle2, UserRound } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import type {
  CourseAuthorSnapshot,
  CourseLearningGoalSnapshot,
} from "@/db/schema";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import type { AppLocale } from "@/lib/i18n/model";

export function CourseInformationDetails({
  learningGoals,
  authors,
  locale,
}: {
  learningGoals: CourseLearningGoalSnapshot[];
  authors: CourseAuthorSnapshot[];
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).academy.courseDetail;
  if (!learningGoals.length && !authors.length) return null;
  return (
    <section
      className="grid gap-6 border-y border-[#dfe5e8] py-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]"
      aria-label={copy.goalsAndInstructors}
    >
      {learningGoals.length ? (
        <div>
          <h2 className="text-lg font-bold text-[#243444]">
            {copy.whatYouLearn}
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {learningGoals.map((goal) => (
              <li key={goal.id} className="flex items-start gap-3 text-sm leading-6 text-[#52606d]">
                <CheckCircle2 className="mt-1 size-4 shrink-0 text-[#2b9188]" />
                <span>{goal.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {authors.length ? (
        <div className={learningGoals.length ? "lg:border-l lg:border-[#e3e8eb] lg:pl-6" : "lg:col-span-2"}>
          <div className="flex items-center gap-2">
            <UserRound className="size-4 text-[#4f7cac]" />
            <h2 className="text-lg font-bold text-[#243444]">
              {copy.instructors}
            </h2>
          </div>
          <ul className="mt-4 space-y-4">
            {authors.map(({ id, author }) => (
              <li key={id} className="flex items-center gap-3">
                <Avatar
                  firstName={author.firstName}
                  lastName={author.lastName}
                  src={author.avatarUrl}
                  size="lg"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[#354555]">
                    {author.firstName} {author.lastName}
                  </p>
                  {author.jobTitle ? (
                    <p className="mt-0.5 truncate text-xs text-[#71808b]">
                      {author.jobTitle}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

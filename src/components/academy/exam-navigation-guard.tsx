"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { getLearningUiCopy } from "@/lib/i18n/learning";
import type { AppLocale } from "@/lib/i18n/model";

export type ExamNavigationLock = {
  attemptId: string;
  courseId: string;
  lessonId: string;
  mode: "block_course" | "block_academy";
};

type ExamNavigationContextValue = {
  lock: ExamNavigationLock | null;
  setLock: React.Dispatch<React.SetStateAction<ExamNavigationLock | null>>;
  lockedMessage: string;
};

const ExamNavigationContext = createContext<ExamNavigationContextValue | null>(
  null,
);

export function ExamNavigationBoundary({
  children,
  initialLock,
  locale,
}: {
  children: ReactNode;
  initialLock: ExamNavigationLock | null;
  locale: AppLocale;
}) {
  const [lock, setLock] = useState(initialLock);
  const lockedMessage = getLearningUiCopy(locale)("navigation.examLocked");
  return (
    <ExamNavigationContext.Provider value={{ lock, setLock, lockedMessage }}>
      {children}
    </ExamNavigationContext.Provider>
  );
}

export function useExamNavigationLockController(
  lock: ExamNavigationLock | null,
) {
  const context = useContext(ExamNavigationContext);
  const setLock = context?.setLock;
  const attemptId = lock?.attemptId ?? null;
  const courseId = lock?.courseId ?? null;
  const lessonId = lock?.lessonId ?? null;
  const mode = lock?.mode ?? null;

  useEffect(() => {
    if (!setLock) return;
    setLock(
      attemptId && courseId && lessonId && mode
        ? { attemptId, courseId, lessonId, mode }
        : null,
    );
  }, [attemptId, courseId, lessonId, mode, setLock]);
}

export function ExamGuardedLink({
  children,
  className,
  href,
}: {
  children: ReactNode;
  className?: string;
  href: string;
}) {
  const context = useContext(ExamNavigationContext);
  if (context?.lock) {
    return (
      <span
        aria-disabled="true"
        data-exam-navigation-locked="true"
        title={context.lockedMessage}
        className={cn(
          className,
          "cursor-not-allowed opacity-55 pointer-events-none",
        )}
      >
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

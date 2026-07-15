"use client";

import { useEffect, useRef } from "react";
import { LEARNING_TIME_HEARTBEAT_INTERVAL_MS } from "@/lib/learning-time-constants";

type ActiveTracker = {
  id: string;
  nextSequence: number;
  timeout: ReturnType<typeof setTimeout> | null;
  sending: boolean;
};

function viewIsActive() {
  return document.visibilityState === "visible" && document.hasFocus();
}

export function LearningTimeTracker({
  courseId,
  lessonId,
}: {
  courseId: string;
  lessonId: string;
}) {
  const reusableInitialSessionId = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let tracker: ActiveTracker | null = null;

    function stop(discardReusableId = false) {
      if (tracker?.timeout) clearTimeout(tracker.timeout);
      if (discardReusableId) reusableInitialSessionId.current = null;
      tracker = null;
    }

    function schedule(current: ActiveTracker) {
      if (disposed || tracker !== current || !viewIsActive()) return;
      current.timeout = setTimeout(
        () => void send(current),
        LEARNING_TIME_HEARTBEAT_INTERVAL_MS,
      );
    }

    async function send(current: ActiveTracker) {
      if (
        disposed ||
        tracker !== current ||
        current.sending ||
        !viewIsActive()
      ) {
        return;
      }
      current.sending = true;
      const sequence = current.nextSequence;
      try {
        const response = await fetch("/api/learning-time/heartbeat", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            courseId,
            lessonId,
            trackingSessionId: current.id,
            sequence,
          }),
          cache: "no-store",
          keepalive: true,
        });
        if (tracker !== current || disposed) return;
        if (response.ok) {
          current.nextSequence = sequence + 1;
          if (
            sequence === 0 &&
            reusableInitialSessionId.current === current.id
          ) {
            reusableInitialSessionId.current = null;
          }
        } else if (response.status === 409) {
          const problem = (await response.json().catch(() => null)) as {
            errors?: { reason?: string } | null;
          } | null;
          const reason = problem?.errors?.reason;
          if (reason === "heartbeat_too_soon") return;
          stop(true);
          if (
            reason === "tracking_session_expired" ||
            reason === "heartbeat_sequence_gap" ||
            reason === "course_version_changed"
          ) {
            setTimeout(start, 0);
          }
          return;
        } else if (response.status === 401 || response.status === 403) {
          stop(true);
          return;
        } else if (response.status === 429) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          stop(true);
          setTimeout(
            start,
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1_000
              : LEARNING_TIME_HEARTBEAT_INTERVAL_MS,
          );
          return;
        }
      } catch {
        // A transient network failure retries the same idempotent sequence.
      } finally {
        current.sending = false;
        if (tracker === current) schedule(current);
      }
    }

    function start() {
      if (disposed || tracker || !viewIsActive()) return;
      const current: ActiveTracker = {
        id: reusableInitialSessionId.current ?? crypto.randomUUID(),
        nextSequence: 0,
        timeout: null,
        sending: false,
      };
      reusableInitialSessionId.current = current.id;
      tracker = current;
      void send(current);
    }

    function reconcile() {
      if (viewIsActive()) start();
      else stop(true);
    }

    function stopForPageHide() {
      stop(true);
    }

    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("focus", reconcile);
    window.addEventListener("blur", reconcile);
    window.addEventListener("pagehide", stopForPageHide);
    start();

    return () => {
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("blur", reconcile);
      window.removeEventListener("pagehide", stopForPageHide);
    };
  }, [courseId, lessonId]);

  return null;
}

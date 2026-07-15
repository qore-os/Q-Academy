"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";

import { EDITOR_PRESENCE_HEARTBEAT_MS } from "@/lib/editor-presence-model";
import { getCourseParityCopy } from "@/lib/i18n/course-parity";
import type { AppLocale } from "@/lib/i18n/model";

type Presence = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  lessonId: string | null;
  pageId: string | null;
  expiresAt: string;
};

export function EditorPresenceStrip({
  courseId,
  lessonId,
  pageId,
  locale,
}: {
  courseId: string;
  lessonId: string | null;
  pageId: string | null;
  locale: AppLocale;
}) {
  const [presence, setPresence] = useState<Presence[]>([]);
  const copy = getCourseParityCopy(locale).presence;

  useEffect(() => {
    const clientId = crypto.randomUUID();
    let disposed = false;
    const heartbeat = async (leave = false) => {
      try {
        const response = await fetch(`/api/editor-presence/courses/${courseId}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          keepalive: leave,
          body: JSON.stringify({ clientId, lessonId, pageId, leave }),
        });
        if (!response.ok || leave) return;
        const payload = (await response.json()) as {
          data?: { presence?: Presence[] };
        };
        if (!disposed) setPresence(payload.data?.presence ?? []);
      } catch {
        if (!disposed) setPresence([]);
      }
    };
    void heartbeat();
    const interval = window.setInterval(
      () => void heartbeat(),
      EDITOR_PRESENCE_HEARTBEAT_MS,
    );
    return () => {
      disposed = true;
      window.clearInterval(interval);
      void heartbeat(true);
    };
  }, [courseId, lessonId, pageId]);

  if (!presence.length) return null;
  return (
    <div className="flex min-w-0 items-center gap-2" aria-label={copy.activeEditors}>
      <Users className="size-3.5 shrink-0 text-[#66727f]" />
      <div className="flex -space-x-1.5">
        {presence.slice(0, 5).map((editor) => (
          <span
            key={editor.userId}
            title={editor.displayName}
            className="grid size-7 place-items-center overflow-hidden rounded-full border-2 border-white bg-[#dce9e7] text-[9px] font-bold text-[#176f68]"
          >
            {editor.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={editor.avatarUrl}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              editor.displayName
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join("")
                .toUpperCase()
            )}
          </span>
        ))}
      </div>
      <span className="truncate text-[10px] text-[#66727f]">
        {presence.length === 1
          ? copy.single(presence[0].displayName)
          : copy.multiple(presence.length)}
      </span>
    </div>
  );
}

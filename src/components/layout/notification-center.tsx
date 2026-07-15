"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  BookOpenCheck,
  CalendarDays,
  Check,
  CheckCheck,
  ClipboardCheck,
  Inbox,
  Info,
  LoaderCircle,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  type NotificationMutationResult,
} from "@/lib/notification-actions";
import type {
  NotificationCenterData,
  NotificationCenterItem,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PushNotificationControl } from "@/components/pwa/push-notification-control";
import { getNotificationCopy } from "@/lib/i18n/notifications";
import type { AppLocale } from "@/lib/i18n/model";
import { useHydrated } from "@/lib/use-hydrated";

const iconByType = {
  submission: ClipboardCheck,
  event: CalendarDays,
  course: BookOpenCheck,
  info: Info,
} as const;

const toneByType = {
  submission: "bg-[#fdf0ee] text-[#b84e42]",
  event: "bg-[#eef3f9] text-[#365f8d]",
  course: "bg-[#e9f8f6] text-[#167e74]",
  info: "bg-[#fbf6e7] text-[#8d6a12]",
} as const;

function notificationVisual(type: string) {
  if (type in iconByType) {
    const key = type as keyof typeof iconByType;
    return { Icon: iconByType[key], tone: toneByType[key] };
  }
  return { Icon: Bell, tone: "bg-[#f1f3f5] text-[#52606d]" };
}

export type NotificationCenterProps = NotificationCenterData & {
  locale: AppLocale;
  className?: string;
};

export function NotificationCenter({
  notifications: initialNotifications,
  unreadCount: initialUnreadCount,
  locale,
  className,
}: NotificationCenterProps) {
  const copy = getNotificationCopy(locale).center;
  const hydrated = useHydrated();
  const router = useRouter();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;

    const closeOnPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const runMutation = (
    pendingId: string,
    mutation: () => Promise<NotificationMutationResult>,
    onSuccess: () => void,
  ) => {
    setPendingIds((current) => new Set(current).add(pendingId));
    startTransition(async () => {
      try {
        const result = await mutation();
        if (!result.ok) {
          toast.error(copy[result.error]);
          return;
        }
        onSuccess();
      } catch {
        toast.error(copy.updateFailed);
      } finally {
        setPendingIds((current) => {
          const next = new Set(current);
          next.delete(pendingId);
          return next;
        });
      }
    });
  };

  const markRead = (notification: NotificationCenterItem) => {
    if (notification.read || pendingIds.has(notification.id)) return;
    runMutation(
      notification.id,
      () => markNotificationReadAction(notification.id),
      () => {
        setNotifications((current) =>
          current.map((item) =>
            item.id === notification.id ? { ...item, read: true } : item,
          ),
        );
        setUnreadCount((current) => Math.max(0, current - 1));
      },
    );
  };

  const markAllRead = () => {
    if (!unreadCount || pendingIds.has("all")) return;
    runMutation("all", markAllNotificationsReadAction, () => {
      setNotifications((current) =>
        current.map((notification) => ({ ...notification, read: true })),
      );
      setUnreadCount(0);
    });
  };

  const removeNotification = (notification: NotificationCenterItem) => {
    const pendingId = `delete:${notification.id}`;
    if (pendingIds.has(pendingId)) return;
    runMutation(
      pendingId,
      () => deleteNotificationAction(notification.id),
      () => {
        setNotifications((current) =>
          current.filter((item) => item.id !== notification.id),
        );
        if (!notification.read) {
          setUnreadCount((current) => Math.max(0, current - 1));
        }
      },
    );
  };

  const visitNotification = (
    event: React.MouseEvent<HTMLAnchorElement>,
    notification: NotificationCenterItem,
  ) => {
    if (!notification.href) return;
    if (notification.read) {
      setOpen(false);
      return;
    }

    event.preventDefault();
    if (pendingIds.has(notification.id)) return;
    runMutation(
      notification.id,
      () => markNotificationReadAction(notification.id),
      () => {
        setNotifications((current) =>
          current.map((item) =>
            item.id === notification.id ? { ...item, read: true } : item,
          ),
        );
        setUnreadCount((current) => Math.max(0, current - 1));
        setOpen(false);
        router.push(notification.href!);
      },
    );
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="focus-ring relative grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3]"
        aria-label={copy.trigger(unreadCount)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        title={copy.title}
        disabled={!hydrated}
      >
        <Bell className="size-[18px]" />
        {unreadCount ? (
          <span className="absolute -right-1 -top-1 grid min-w-4.5 place-items-center rounded-full border-2 border-white bg-[#b84e42] px-1 text-[9px] font-bold leading-4 text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-[#0f263c]/30 sm:hidden"
            aria-label={copy.close}
          />
          <section
            id={panelId}
            role="dialog"
            aria-label={copy.title}
            className="fixed inset-x-3 top-[68px] z-50 flex max-h-[min(78vh,620px)] flex-col overflow-hidden rounded-md border border-[#dfe4e8] bg-white shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[410px]"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e8ebee] px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-[#243444]">
                  {copy.title}
                </h2>
                <p
                  className="mt-0.5 text-[10px] text-[#7a8690]"
                  aria-live="polite"
                >
                  {unreadCount
                    ? copy.unread(unreadCount)
                    : copy.allCurrent}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <PushNotificationControl locale={locale} />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={markAllRead}
                  disabled={!unreadCount || pendingIds.has("all")}
                >
                  {pendingIds.has("all") ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <CheckCheck className="size-3.5" />
                  )}
                  {copy.markAllRead}
                </Button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="focus-ring grid size-8 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3]"
                  aria-label={copy.close}
                  title={copy.close}
                >
                  <X className="size-4" />
                </button>
              </div>
            </header>

            {notifications.length ? (
              <div className="min-h-0 flex-1 overflow-y-auto" role="list">
                {notifications.map((notification) => {
                  const { Icon, tone } = notificationVisual(notification.type);
                  const marking = pendingIds.has(notification.id);
                  const deleting = pendingIds.has(`delete:${notification.id}`);
                  const content = (
                    <>
                      <span
                        className={cn(
                          "mt-0.5 grid size-9 shrink-0 place-items-center rounded-md",
                          tone,
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-2">
                          <strong className="min-w-0 flex-1 text-xs leading-5 text-[#2b3a48]">
                            {notification.title}
                          </strong>
                          {!notification.read ? (
                            <span
                              className="mt-1.5 size-2 shrink-0 rounded-full bg-[#2bb7a9]"
                              aria-label={copy.unreadItem}
                            />
                          ) : null}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-[#66727f]">
                          {notification.body}
                        </span>
                        <time
                          dateTime={notification.createdAt}
                          className="mt-1.5 block text-[9px] text-[#8a949d]"
                        >
                          {notification.createdAtLabel}
                        </time>
                      </span>
                    </>
                  );

                  return (
                    <article
                      key={notification.id}
                      role="listitem"
                      className={cn(
                        "group flex items-start gap-1 border-b border-[#edf0f2] px-2 py-2 last:border-b-0",
                        !notification.read && "bg-[#f7fbfa]",
                      )}
                    >
                      {notification.href ? (
                        <Link
                          href={notification.href}
                          onClick={(event) => {
                            if (marking || deleting) {
                              event.preventDefault();
                              return;
                            }
                            visitNotification(event, notification);
                          }}
                          aria-disabled={marking || deleting}
                          className="focus-ring flex min-w-0 flex-1 gap-3 rounded-md px-2 py-2 hover:bg-[#f2f5f6]"
                        >
                          {content}
                        </Link>
                      ) : (
                        <div className="flex min-w-0 flex-1 gap-3 px-2 py-2">
                          {content}
                        </div>
                      )}
                      <div className="flex shrink-0 flex-col gap-0.5 pt-1">
                        {!notification.read ? (
                          <button
                            type="button"
                            onClick={() => markRead(notification)}
                            disabled={marking || deleting}
                            className="focus-ring grid size-7 place-items-center rounded-md text-[#71808b] hover:bg-[#e9f8f6] hover:text-[#167e74] disabled:opacity-45"
                            aria-label={copy.markRead(notification.title)}
                            title={copy.markReadTitle}
                          >
                            {marking ? (
                              <LoaderCircle className="size-3.5 animate-spin" />
                            ) : (
                              <Check className="size-3.5" />
                            )}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => removeNotification(notification)}
                          disabled={marking || deleting}
                          className="focus-ring grid size-7 place-items-center rounded-md text-[#84909a] hover:bg-[#fdf0ee] hover:text-[#b84e42] disabled:opacity-45"
                          aria-label={copy.remove(notification.title)}
                          title={copy.removeTitle}
                        >
                          {deleting ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="grid min-h-56 place-items-center p-8 text-center">
                <div>
                  <span className="mx-auto grid size-11 place-items-center rounded-md bg-[#f1f4f5] text-[#71808b]">
                    <Inbox className="size-5" />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-[#354555]">
                    {copy.emptyTitle}
                  </p>
                  <p className="mt-1 text-xs text-[#7a8690]">
                    {copy.emptyBody}
                  </p>
                </div>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

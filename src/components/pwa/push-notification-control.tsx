"use client";

import { BellOff, BellRing, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { getNotificationCopy } from "@/lib/i18n/notifications";
import type { AppLocale } from "@/lib/i18n/model";

type PushConfiguration = {
  enabled: boolean;
  publicKey: string | null;
  native?: {
    platform: "ios" | "android";
    appId: string;
  };
};

type PushControlState =
  | "loading"
  | "unsupported"
  | "disabled"
  | "denied"
  | "off"
  | "on"
  | "saving";

function decodeApplicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = window.atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function matchingApplicationServerKey(
  subscription: PushSubscription,
  expected: Uint8Array<ArrayBuffer>,
) {
  const configured = subscription.options.applicationServerKey;
  if (!configured) return false;
  const bytes = new Uint8Array(configured);
  return (
    bytes.length === expected.length &&
    bytes.every((value, index) => value === expected[index])
  );
}

async function readPushConfiguration() {
  const response = await fetch("/api/push/config", {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("push_configuration_failed");
  const payload = (await response.json()) as { data?: Partial<PushConfiguration> };
  return {
    enabled: payload.data?.enabled === true,
    publicKey:
      typeof payload.data?.publicKey === "string" ? payload.data.publicKey : null,
  } satisfies PushConfiguration;
}

function nativePlatform() {
  if (!Capacitor.isNativePlatform()) return null;
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android" ? platform : null;
}

async function readNativePushConfiguration(
  platform: "ios" | "android",
): Promise<PushConfiguration> {
  const response = await fetch("/api/push/native/config", {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("native_push_configuration_failed");
  const payload = (await response.json()) as {
    data?: { platforms?: unknown; appId?: unknown };
  };
  const platforms = Array.isArray(payload.data?.platforms)
    ? payload.data.platforms
    : [];
  const appId = typeof payload.data?.appId === "string" ? payload.data.appId : "";
  const enabled = platforms.includes(platform) && appId.length >= 3;
  return {
    enabled,
    publicKey: null,
    native: enabled ? { platform, appId } : undefined,
  };
}

async function nativeSubscriptionBelongsToCurrentSession(
  platform: "ios" | "android",
) {
  const response = await fetch("/api/push/native/devices/status", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ platform }),
  });
  if (!response.ok) return false;
  const payload = (await response.json()) as { data?: { subscribed?: unknown } };
  return payload.data?.subscribed === true;
}

async function subscriptionBelongsToCurrentSession(endpoint: string) {
  const response = await fetch("/api/push/subscriptions/status", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) return false;
  const payload = (await response.json()) as { data?: { subscribed?: unknown } };
  return payload.data?.subscribed === true;
}

function supportsPush() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function PushNotificationControl({ locale }: { locale: AppLocale }) {
  const copy = getNotificationCopy(locale).push;
  const [configuration, setConfiguration] = useState<PushConfiguration | null>(null);
  const [state, setState] = useState<PushControlState>("loading");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const platform = nativePlatform();
        const current = platform
          ? await readNativePushConfiguration(platform)
          : await readPushConfiguration();
        if (!active) return;
        setConfiguration(current);
        if (platform) {
          if (!current.enabled) {
            setState("disabled");
            return;
          }
          const { PushNotifications } = await import(
            "@capacitor/push-notifications"
          );
          const permission = await PushNotifications.checkPermissions();
          if (permission.receive === "denied") {
            setState("denied");
            return;
          }
          if (permission.receive !== "granted") {
            setState("off");
            return;
          }
          setState(
            (await nativeSubscriptionBelongsToCurrentSession(platform))
              ? "on"
              : "off",
          );
          return;
        }
        if (!current.enabled || !current.publicKey) {
          setState("disabled");
          return;
        }
        if (!supportsPush()) {
          setState("unsupported");
          return;
        }
        if (Notification.permission === "denied") {
          setState("denied");
          return;
        }
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        const applicationServerKey = decodeApplicationServerKey(current.publicKey);
        if (
          !subscription ||
          !matchingApplicationServerKey(subscription, applicationServerKey)
        ) {
          setState("off");
          return;
        }
        setState(
          (await subscriptionBelongsToCurrentSession(subscription.endpoint))
            ? "on"
            : "off",
        );
      } catch {
        if (active) setState("disabled");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const enable = async () => {
    if (configuration?.native) {
      setState("saving");
      try {
        const { PushNotifications } = await import(
          "@capacitor/push-notifications"
        );
        const permission = await PushNotifications.checkPermissions();
        const result =
          permission.receive === "prompt"
            ? await PushNotifications.requestPermissions()
            : permission;
        if (result.receive !== "granted") {
          setState("denied");
          return;
        }
        if (configuration.native.platform === "android") {
          await PushNotifications.createChannel({
            id: "academy_updates",
            name: copy.channelName,
            description: copy.channelDescription,
            importance: 4,
            visibility: 1,
          });
        }
        let timeout: number | undefined;
        const listeners: Array<{ remove: () => Promise<void> }> = [];
        let token: string;
        try {
          token = await new Promise<string>((resolve, reject) => {
            timeout = window.setTimeout(
              () => reject(new Error("native_push_registration_timeout")),
              20_000,
            );
            void (async () => {
              listeners.push(
                await PushNotifications.addListener(
                  "registration",
                  ({ value }) => resolve(value),
                ),
              );
              listeners.push(
                await PushNotifications.addListener(
                  "registrationError",
                  (error) => reject(new Error(error.error)),
                ),
              );
              await PushNotifications.register();
            })().catch(reject);
          });
        } finally {
          if (timeout !== undefined) window.clearTimeout(timeout);
          await Promise.all(listeners.map((listener) => listener.remove()));
        }
        const response = await fetch("/api/push/native/devices", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            platform: configuration.native.platform,
            appId: configuration.native.appId,
            token,
          }),
        });
        if (!response.ok) {
          await PushNotifications.unregister();
          throw new Error("native_push_subscription_failed");
        }
        setState("on");
        toast.success(copy.enabled);
      } catch {
        setState("off");
        toast.error(copy.enableFailed);
      }
      return;
    }
    if (!configuration?.enabled || !configuration.publicKey || !supportsPush()) return;
    setState("saving");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;
      const applicationServerKey = decodeApplicationServerKey(configuration.publicKey);
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !matchingApplicationServerKey(subscription, applicationServerKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      let activeSubscription =
        subscription ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        }));
      const persist = (candidate: PushSubscription) =>
        fetch("/api/push/subscriptions", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(candidate.toJSON()),
        });
      let response = await persist(activeSubscription);
      if (response.status === 409) {
        await response.body?.cancel().catch(() => undefined);
        await activeSubscription.unsubscribe();
        activeSubscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
        response = await persist(activeSubscription);
      }
      if (!response.ok) {
        await activeSubscription.unsubscribe();
        throw new Error("push_subscription_failed");
      }
      setState("on");
      toast.success(copy.enabled);
    } catch {
      setState("off");
      toast.error(copy.enableFailed);
    }
  };

  const disable = async () => {
    if (configuration?.native) {
      setState("saving");
      try {
        const response = await fetch("/api/push/native/devices", {
          method: "DELETE",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ platform: configuration.native.platform }),
        });
        if (!response.ok) throw new Error("native_push_unsubscribe_failed");
        const { PushNotifications } = await import(
          "@capacitor/push-notifications"
        );
        await PushNotifications.unregister();
        setState("off");
        toast.success(copy.disabled);
      } catch {
        setState("on");
        toast.error(copy.disableFailed);
      }
      return;
    }
    if (!supportsPush()) return;
    setState("saving");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch("/api/push/subscriptions", {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!response.ok) throw new Error("push_unsubscribe_failed");
        await subscription.unsubscribe();
      }
      setState("off");
      toast.success(copy.disabled);
    } catch {
      setState("on");
      toast.error(copy.disableFailed);
    }
  };

  if (state === "disabled" || state === "unsupported") return null;
  const active = state === "on";
  const pending = state === "loading" || state === "saving";
  const denied = state === "denied";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={
        denied
          ? copy.blocked
          : copy.toggle(active)
      }
      title={
        denied
          ? copy.blockedTitle
          : copy.toggleTitle(active)
      }
      disabled={pending || denied}
      onClick={() => void (active ? disable() : enable())}
      className="focus-ring inline-flex h-8 items-center gap-2 rounded-md px-2 text-[11px] font-semibold text-[#52606d] hover:bg-[#edf1f3] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : active ? (
        <BellRing className="size-3.5 text-[#167e74]" />
      ) : (
        <BellOff className="size-3.5" />
      )}
      {copy.label}
      <span
        aria-hidden="true"
        className={`relative h-4 w-7 rounded-full transition-colors ${active ? "bg-[#2bb7a9]" : "bg-[#c8d0d6]"}`}
      >
        <span
          className={`absolute top-0.5 size-3 rounded-full bg-white transition-transform ${active ? "translate-x-3.5" : "translate-x-0.5"}`}
        />
      </span>
    </button>
  );
}

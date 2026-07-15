"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { safeNativeDeepLinkPath } from "@/lib/mobile/deep-links";
import {
  nativeStartPath,
  type NativeStartDestination,
} from "@/lib/mobile/start-destination-model";

export function NativeRuntimeBridge({
  organizationId,
  startDestination,
  urlScheme,
}: {
  organizationId: string | null;
  startDestination: NativeStartDestination;
  urlScheme: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [initialPathname] = useState(pathname);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    let initialNavigationResolved = false;
    let reconcileNativePush = async () => {};
    const removers: Array<() => Promise<void>> = [];
    const storageKey = `q-academy:native-start:${organizationId ?? "default"}`;
    const safePath = (url: string) =>
      safeNativeDeepLinkPath(url, window.location.origin, [urlScheme]);

    const markInitialNavigation = () => {
      initialNavigationResolved = true;
      try {
        window.sessionStorage.setItem(storageKey, "resolved");
      } catch {
        // Storage can be unavailable in restricted WebViews.
      }
    };
    const wasInitialNavigationResolved = () => {
      try {
        return window.sessionStorage.getItem(storageKey) === "resolved";
      } catch {
        return initialNavigationResolved;
      }
    };

    void import("@capacitor/app").then(async ({ App }) => {
      if (disposed) return;
      const deepLinkListener = await App.addListener("appUrlOpen", ({ url }) => {
        const path = safePath(url);
        if (path) {
          markInitialNavigation();
          router.push(path);
        }
      });
      const resumeListener = await App.addListener("resume", () => {
        router.refresh();
        void reconcileNativePush();
      });
      if (disposed) {
        await Promise.all([deepLinkListener.remove(), resumeListener.remove()]);
        return;
      }
      removers.push(
        () => deepLinkListener.remove(),
        () => resumeListener.remove(),
      );

      if (wasInitialNavigationResolved()) return;
      const launch = await App.getLaunchUrl();
      if (disposed) return;
      const launchPath = launch?.url
        ? safePath(launch.url)
        : null;
      if (launchPath) {
        markInitialNavigation();
        router.replace(launchPath);
        return;
      }
      if (
        initialPathname === "/academy" &&
        !window.location.search &&
        !window.location.hash
      ) {
        markInitialNavigation();
        const destination = nativeStartPath(startDestination);
        if (destination !== initialPathname) router.replace(destination);
      }
    });
    void import("@capacitor/push-notifications").then(
      async ({ PushNotifications }) => {
        if (disposed) return;
        const platform = Capacitor.getPlatform();
        if (platform !== "ios" && platform !== "android") return;
        let appId: string | null = null;
        const registrationListener = await PushNotifications.addListener(
          "registration",
          ({ value }) => {
            if (!appId || disposed) return;
            void fetch("/api/push/native/devices", {
              method: "POST",
              credentials: "same-origin",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({ platform, appId, token: value }),
            });
          },
        );
        const receivedListener = await PushNotifications.addListener(
          "pushNotificationReceived",
          () => router.refresh(),
        );
        const actionListener = await PushNotifications.addListener(
          "pushNotificationActionPerformed",
          ({ notification }) => {
            const rawHref = notification.data?.href;
            if (typeof rawHref !== "string") return;
            const absolute = rawHref.startsWith("/")
              ? new URL(rawHref, window.location.origin).toString()
              : rawHref;
            const path = safePath(absolute);
            if (path) {
              markInitialNavigation();
              router.push(path);
            }
          },
        );
        if (disposed) {
          await Promise.all([
            registrationListener.remove(),
            receivedListener.remove(),
            actionListener.remove(),
          ]);
          return;
        }
        removers.push(
          () => registrationListener.remove(),
          () => receivedListener.remove(),
          () => actionListener.remove(),
        );

        reconcileNativePush = async () => {
          try {
            const configurationResponse = await fetch(
              "/api/push/native/config",
              {
                credentials: "same-origin",
                cache: "no-store",
                headers: { Accept: "application/json" },
              },
            );
            if (!configurationResponse.ok || disposed) return;
            const configuration = (await configurationResponse.json()) as {
              data?: { platforms?: unknown; appId?: unknown };
            };
            const platforms = Array.isArray(configuration.data?.platforms)
              ? configuration.data.platforms
              : [];
            const configuredAppId = configuration.data?.appId;
            if (
              !platforms.includes(platform) ||
              typeof configuredAppId !== "string" ||
              configuredAppId.length < 3
            ) {
              return;
            }
            appId = configuredAppId;
            const statusResponse = await fetch(
              "/api/push/native/devices/status",
              {
                method: "POST",
                credentials: "same-origin",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify({ platform }),
              },
            );
            if (!statusResponse.ok || disposed) return;
            const status = (await statusResponse.json()) as {
              data?: { subscribed?: unknown };
            };
            if (status.data?.subscribed !== true) return;
            const permission = await PushNotifications.checkPermissions();
            if (permission.receive !== "granted") {
              await fetch("/api/push/native/devices", {
                method: "DELETE",
                credentials: "same-origin",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify({ platform }),
              });
              return;
            }
            if (!disposed) await PushNotifications.register();
          } catch {
            // The explicit notification control remains available for recovery.
          }
        };
        await reconcileNativePush();
      },
    );

    return () => {
      disposed = true;
      for (const remove of removers) void remove();
    };
  }, [initialPathname, organizationId, router, startDestination, urlScheme]);

  return null;
}

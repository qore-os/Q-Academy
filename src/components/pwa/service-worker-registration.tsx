"use client";

import { useEffect } from "react";

const shouldRegisterServiceWorker =
  process.env.NODE_ENV === "production" ||
  process.env.NEXT_PUBLIC_ENABLE_PWA === "true";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!shouldRegisterServiceWorker || !("serviceWorker" in navigator)) {
      return;
    }

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => undefined);
  }, []);

  return null;
}

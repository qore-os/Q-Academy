"use client";

import { useEffect } from "react";

export function TenantFavicon({ href }: { href: string }) {
  useEffect(() => {
    const icons = Array.from(
      document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
    );
    const targets = icons.length ? icons : [document.createElement("link")];
    for (const icon of targets) {
      icon.rel = "icon";
      icon.href = href;
      if (!icon.isConnected) document.head.append(icon);
    }
  }, [href]);

  return null;
}

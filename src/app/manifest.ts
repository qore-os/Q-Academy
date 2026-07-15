import type { MetadataRoute } from "next";
import { DEFAULT_TENANT_BRANDING } from "@/lib/branding-model";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: DEFAULT_TENANT_BRANDING.platformName,
    short_name: DEFAULT_TENANT_BRANDING.platformName,
    description:
      "Lernplattform fuer produktive und verantwortungsvolle KI-Nutzung.",
    lang: "de",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f9fb",
    theme_color: DEFAULT_TENANT_BRANDING.primaryColor,
    categories: ["education", "productivity"],
    icons: [
      {
        src: "/pwa/q-academy-v1-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/pwa/q-academy-v1-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}

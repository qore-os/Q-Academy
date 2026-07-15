import { safeCourseEmbedUrl } from "@/lib/hub-embed-policy";

export const COURSE_INTEGRATION_PROVIDERS = [
  {
    id: "youtube",
    name: "YouTube",
    category: "video",
    hostnames: ["www.youtube-nocookie.com"],
    placeholder: "https://www.youtube-nocookie.com/embed/...",
    defaultLayout: "video",
  },
  {
    id: "vimeo",
    name: "Vimeo",
    category: "video",
    hostnames: ["player.vimeo.com"],
    placeholder: "https://player.vimeo.com/video/...",
    defaultLayout: "video",
  },
  {
    id: "loom",
    name: "Loom",
    category: "video",
    hostnames: ["www.loom.com"],
    placeholder: "https://www.loom.com/embed/...",
    defaultLayout: "video",
  },
  {
    id: "microsoft_forms",
    name: "Microsoft Forms",
    category: "form",
    hostnames: ["forms.office.com"],
    placeholder: "https://forms.office.com/r/...",
    defaultLayout: "form",
  },
  {
    id: "google_forms",
    name: "Google Forms",
    category: "form",
    hostnames: ["docs.google.com"],
    placeholder: "https://docs.google.com/forms/d/e/.../viewform",
    defaultLayout: "form",
  },
] as const;

export const COURSE_INTEGRATION_LAYOUTS = [
  "video",
  "standard",
  "form",
] as const;

export type CourseIntegrationProviderId =
  (typeof COURSE_INTEGRATION_PROVIDERS)[number]["id"];
export type CourseIntegrationLayout =
  (typeof COURSE_INTEGRATION_LAYOUTS)[number];

type CourseIntegrationProvider =
  (typeof COURSE_INTEGRATION_PROVIDERS)[number];

const providersById = new Map<CourseIntegrationProviderId, CourseIntegrationProvider>(
  COURSE_INTEGRATION_PROVIDERS.map((provider) => [provider.id, provider]),
);
const providersByHostname = new Map<string, CourseIntegrationProvider>(
  COURSE_INTEGRATION_PROVIDERS.flatMap((provider) =>
    provider.hostnames.map((hostname) => [hostname, provider] as const),
  ),
);

export function courseIntegrationProviderById(
  value: unknown,
): CourseIntegrationProvider | null {
  if (typeof value !== "string") return null;
  return providersById.get(value as CourseIntegrationProviderId) ?? null;
}

export function courseIntegrationProviderForUrl(
  value: unknown,
): CourseIntegrationProvider | null {
  const safeUrl = safeCourseEmbedUrl(value);
  if (!safeUrl) return null;
  return providersByHostname.get(new URL(safeUrl).hostname.toLowerCase()) ?? null;
}

export function resolveCourseIntegration(
  value: unknown,
  expectedProvider?: unknown,
) {
  const url = safeCourseEmbedUrl(value);
  if (!url) return null;
  const provider = courseIntegrationProviderForUrl(url);
  if (!provider) return null;
  if (expectedProvider !== undefined && expectedProvider !== provider.id) {
    return null;
  }
  return { url, provider } as const;
}

export function resolveCourseIntegrationLayout(
  value: unknown,
  providerId?: unknown,
): CourseIntegrationLayout {
  if (
    typeof value === "string" &&
    COURSE_INTEGRATION_LAYOUTS.some((layout) => layout === value)
  ) {
    return value as CourseIntegrationLayout;
  }
  return courseIntegrationProviderById(providerId)?.defaultLayout ?? "video";
}

export function courseIntegrationFrameClass(layout: CourseIntegrationLayout) {
  if (layout === "standard") return "aspect-[4/3]";
  if (layout === "form") return "h-[70vh] min-h-[520px] max-h-[900px]";
  return "aspect-video";
}

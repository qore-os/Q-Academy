import {
  isExternalRichTextHref,
  safeRichTextHref,
} from "@/lib/rich-text/document";

export const LINK_BUTTON_DOCUMENT_VERSION = 1 as const;
export const GALLERY_DOCUMENT_VERSION = 1 as const;

const MEDIA_DOWNLOAD_PATH =
  /^\/api\/media-assets\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/download$/i;
const PUBLIC_IMAGE_PATH =
  /^\/images\/(?:[a-z0-9._-]+\/)*[a-z0-9._-]+\.(?:avif|gif|jpe?g|png|webp)$/i;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

export type LinkButtonDocument = {
  version: typeof LINK_BUTTON_DOCUMENT_VERSION;
  label: string;
  href: string;
  variant: "primary" | "secondary" | "link";
};

export type GalleryItem = {
  source: string;
  alt: string;
  caption?: string;
  mediaAssetId?: string;
  mediaAssetName?: string;
};

export type GalleryDocument = {
  version: typeof GALLERY_DOCUMENT_VERSION;
  layout: "grid" | "featured";
  items: GalleryItem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARACTERS, "").trim().slice(0, maxLength);
}

export function sanitizeLinkButtonDocument(
  input: unknown,
): LinkButtonDocument | null {
  if (!isRecord(input) || input.version !== LINK_BUTTON_DOCUMENT_VERSION) {
    return null;
  }
  const label = safeText(input.label, 160);
  const href = safeRichTextHref(input.href);
  if (!label || !href) return null;
  return {
    version: LINK_BUTTON_DOCUMENT_VERSION,
    label,
    href,
    variant:
      input.variant === "secondary" || input.variant === "link"
        ? input.variant
        : "primary",
  };
}

export function createLinkButtonDocument(
  label: string,
  href: string,
  variant: LinkButtonDocument["variant"] = "primary",
) {
  return sanitizeLinkButtonDocument({
    version: LINK_BUTTON_DOCUMENT_VERSION,
    label,
    href,
    variant,
  });
}

export function safeCourseImageSource(value: unknown) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  const hasPathTraversal = candidate
    .split("/")
    .some((segment) => segment === "." || segment === "..");
  if (
    MEDIA_DOWNLOAD_PATH.test(candidate) ||
    (PUBLIC_IMAGE_PATH.test(candidate) && !hasPathTraversal)
  ) {
    return candidate;
  }
  const href = safeRichTextHref(candidate);
  return href && isExternalRichTextHref(href) ? href : null;
}

export function sanitizeGalleryDocument(input: unknown): GalleryDocument {
  const empty: GalleryDocument = {
    version: GALLERY_DOCUMENT_VERSION,
    layout: "grid",
    items: [],
  };
  if (
    !isRecord(input) ||
    input.version !== GALLERY_DOCUMENT_VERSION ||
    !Array.isArray(input.items)
  ) {
    return empty;
  }

  const items = input.items.slice(0, 8).flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const source = safeCourseImageSource(candidate.source);
    const alt = safeText(candidate.alt, 300);
    if (!source || !alt) return [];
    const caption = safeText(candidate.caption, 1_000);
    const mediaAssetId =
      typeof candidate.mediaAssetId === "string" &&
      UUID.test(candidate.mediaAssetId) &&
      source === `/api/media-assets/${candidate.mediaAssetId}/download`
        ? candidate.mediaAssetId
        : undefined;
    const mediaAssetName = safeText(candidate.mediaAssetName, 255);
    return [
      {
        source,
        alt,
        ...(caption ? { caption } : {}),
        ...(mediaAssetId ? { mediaAssetId } : {}),
        ...(mediaAssetId && mediaAssetName ? { mediaAssetName } : {}),
      },
    ];
  });

  return {
    version: GALLERY_DOCUMENT_VERSION,
    layout: input.layout === "featured" ? "featured" : "grid",
    items,
  };
}

export function galleryDocumentHasContent(document: GalleryDocument) {
  return document.items.length > 0;
}

export function createEmptyGalleryDocument(): GalleryDocument {
  return {
    version: GALLERY_DOCUMENT_VERSION,
    layout: "grid",
    items: [],
  };
}

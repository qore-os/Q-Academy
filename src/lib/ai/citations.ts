import type { AiMessageCitation } from "@/db/schema";

const lessonCitationPath =
  /^\/academy\/courses\/[^/]+\/learn\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function safeInternalAcademyHref(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/academy/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }

  try {
    const base = "https://academy.invalid";
    const url = new URL(value, base);
    if (
      url.origin !== base ||
      !lessonCitationPath.test(url.pathname) ||
      url.hash ||
      [...url.searchParams.keys()].some((key) => key !== "page") ||
      url.searchParams.getAll("page").length > 1
    ) {
      return null;
    }
    const pageId = url.searchParams.get("page");
    if (pageId !== null && !uuid.test(pageId)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function citationIdentity(citation: AiMessageCitation) {
  const href = safeInternalAcademyHref(citation.href);
  const parsedHref = href
    ? new URL(href, "https://academy.invalid")
    : null;
  const pageId = citation.pageId?.trim() || parsedHref?.searchParams.get("page");
  if (pageId) return `page:${pageId.toLowerCase()}`;

  const lessonId =
    citation.lessonId?.trim() ||
    parsedHref?.pathname.split("/").filter(Boolean).at(-1);
  if (lessonId) return `lesson:${lessonId.toLowerCase()}`;

  const courseId = citation.courseId?.trim();
  if (courseId) return `course:${courseId.toLowerCase()}`;
  if (href) return `href:${href}`;
  return `title:${String(citation.title ?? "").trim().toLowerCase()}`;
}

export function dedupeAiMessageCitations(
  citations: readonly AiMessageCitation[],
) {
  const identities = new Set<string>();
  const unique: AiMessageCitation[] = [];
  for (const citation of citations) {
    const identity = citationIdentity(citation);
    if (identities.has(identity)) continue;
    identities.add(identity);
    unique.push(citation);
  }
  return unique;
}

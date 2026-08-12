export const MAX_GENERATED_VIDEO_DESCRIPTION_CHARACTERS = 900;

export function sanitizeGeneratedVideoDescription(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/^\s*["']|["']\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(normalized)
    .slice(0, MAX_GENERATED_VIDEO_DESCRIPTION_CHARACTERS)
    .join("")
    .trim();
}

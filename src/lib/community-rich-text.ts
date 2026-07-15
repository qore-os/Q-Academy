import { ApiError } from "@/lib/api/errors";
import { COMMUNITY_MODERATION_MAX_INPUT_BYTES } from "@/lib/community-moderation-analyzer";
import {
  createRichTextDocument,
  type RichTextDocument,
  type RichTextInline,
} from "@/lib/rich-text/document";
import {
  projectSubmissionRichTextPlainText,
  submissionRichTextDocumentSchema,
} from "@/lib/submission-rich-text";

export const COMMUNITY_CONTENT_PROJECTION_VERSION = 1 as const;
export const MAX_COMMUNITY_POST_TEXT_LENGTH = 10_000;
export const MAX_COMMUNITY_COMMENT_TEXT_LENGTH = 5_000;

export type CommunityContentKind = "post" | "comment";

export type CommunityContentInput = {
  content?: string | null;
  richText?: unknown;
};

export type NormalizedCommunityContent = {
  content: string;
  contentFormat: "plain_text" | "rich_text";
  richText: RichTextDocument | null;
  contentProjectionVersion: typeof COMMUNITY_CONTENT_PROJECTION_VERSION;
  analysisLinks: string[];
};

function contentBounds(kind: CommunityContentKind) {
  return kind === "post"
    ? { min: 3, max: MAX_COMMUNITY_POST_TEXT_LENGTH, label: "Beitrag" }
    : { min: 1, max: MAX_COMMUNITY_COMMENT_TEXT_LENGTH, label: "Antwort" };
}

function linkHrefs(nodes: readonly RichTextInline[]): string[] {
  return nodes.flatMap((node) =>
    node.type === "link" ? [node.href, ...linkHrefs(node.children)] : [],
  );
}

export function communityRichTextLinks(document: RichTextDocument) {
  return [
    ...new Set(
      document.blocks.flatMap((block) =>
        block.type === "list"
          ? block.items.flatMap((item) => linkHrefs(item.children))
          : linkHrefs(block.children),
      ),
    ),
  ];
}

export function communityContentAnalysisText(
  content: Pick<NormalizedCommunityContent, "content" | "analysisLinks">,
) {
  return communityModerationAnalysisText([
    content.content,
    ...content.analysisLinks,
  ]);
}

export function communityModerationAnalysisText(
  parts: readonly (string | null | undefined)[],
) {
  const analysisText = parts.filter(Boolean).join("\n");
  if (
    analysisText.length > COMMUNITY_MODERATION_MAX_INPUT_BYTES ||
    new TextEncoder().encode(analysisText).byteLength >
      COMMUNITY_MODERATION_MAX_INPUT_BYTES
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Der Community-Inhalt ist fuer die Moderationspruefung zu umfangreich.",
    );
  }
  return analysisText;
}

export function normalizeCommunityContent(
  input: CommunityContentInput,
  kind: CommunityContentKind,
): NormalizedCommunityContent {
  const hasPlainText = typeof input.content === "string";
  const hasRichText = input.richText !== undefined && input.richText !== null;
  if (hasPlainText === hasRichText) {
    throw new ApiError(
      422,
      "validation_error",
      "Plaintext und Rich-Text muessen genau alternativ angegeben werden.",
    );
  }

  const bounds = contentBounds(kind);
  if (hasPlainText) {
    const content = input.content!.trim();
    if (content.length < bounds.min || content.length > bounds.max) {
      throw new ApiError(
        422,
        "validation_error",
        `${bounds.label} muss zwischen ${bounds.min} und ${bounds.max} Zeichen enthalten.`,
      );
    }
    return {
      content,
      contentFormat: "plain_text",
      richText: null,
      contentProjectionVersion: COMMUNITY_CONTENT_PROJECTION_VERSION,
      analysisLinks: [],
    };
  }

  const parsed = submissionRichTextDocumentSchema.safeParse(input.richText);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "validation_error",
      parsed.error.issues[0]?.message ?? "Der formatierte Inhalt ist ungueltig.",
    );
  }
  const content = projectSubmissionRichTextPlainText(parsed.data);
  if (content.length < bounds.min || content.length > bounds.max) {
    throw new ApiError(
      422,
      "validation_error",
      `Die Textprojektion des ${bounds.label.toLowerCase()}s muss zwischen ${bounds.min} und ${bounds.max} Zeichen enthalten.`,
    );
  }
  return {
    content,
    contentFormat: "rich_text",
    richText: parsed.data,
    contentProjectionVersion: COMMUNITY_CONTENT_PROJECTION_VERSION,
    analysisLinks: communityRichTextLinks(parsed.data),
  };
}

export function communityRichTextEditorValue(input: {
  content: string;
  contentFormat: "plain_text" | "rich_text";
  richText: RichTextDocument | null;
}) {
  return input.contentFormat === "rich_text" && input.richText
    ? input.richText
    : createRichTextDocument(input.content);
}

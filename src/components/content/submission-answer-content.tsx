import { RichTextContent } from "@/components/content/rich-text-content";
import { cn } from "@/lib/utils";

export function SubmissionAnswerContent({
  content,
  contentFormat,
  richText,
  className,
  emptyLabel,
}: {
  content: string | null;
  contentFormat: "plain_text" | "rich_text";
  richText: unknown;
  className?: string;
  emptyLabel: string;
}) {
  if (contentFormat === "rich_text" && richText) {
    return (
      <RichTextContent
        document={richText}
        density="compact"
        className={className}
      />
    );
  }

  return (
    <div
      className={cn(
        "whitespace-pre-wrap text-sm leading-6 text-[#52606d]",
        className,
      )}
    >
      {content ?? emptyLabel}
    </div>
  );
}

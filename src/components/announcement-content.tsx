import type { MouseEvent } from "react";
import { ArrowUpRight, CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

import { RichTextContent } from "@/components/content/rich-text-content";
import { buttonClassName } from "@/components/ui/button";
import {
  isExternalRichTextHref,
  type RichTextDocument,
} from "@/lib/rich-text/document";
import {
  type AnnouncementContentBlock,
  type AnnouncementContentDocument,
} from "@/lib/announcement-content";
import { cn } from "@/lib/utils";

const calloutStyles = {
  info: { container: "border-[#bad0e2] bg-[#f1f6fa] text-[#294d70]", icon: Info },
  success: { container: "border-[#b8ddd9] bg-[#eef9f7] text-[#176f68]", icon: CircleCheck },
  warning: { container: "border-[#ead9a8] bg-[#fbf8ed] text-[#6f5617]", icon: TriangleAlert },
  critical: { container: "border-[#efc3bd] bg-[#fdf2f0] text-[#913c33]", icon: CircleAlert },
} as const;

function ContentCta({
  block,
  interactive,
  onClick,
}: {
  block: Extract<AnnouncementContentBlock, { type: "cta" }>;
  interactive: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>, block: Extract<AnnouncementContentBlock, { type: "cta" }>) => void;
}) {
  const external = isExternalRichTextHref(block.href);
  const className = buttonClassName({
    variant: block.style === "primary" ? "navy" : "secondary",
    size: "sm",
    className: "w-fit max-w-full",
  });
  if (!interactive) {
    return <span className={cn(className, "pointer-events-none")}>{block.label}{external ? <ArrowUpRight className="size-3.5" /> : null}</span>;
  }
  return (
    <a
      href={block.href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer nofollow" : undefined}
      referrerPolicy={external ? "no-referrer" : undefined}
      onClick={(event) => onClick?.(event, block)}
      className={className}
    >
      <span className="truncate">{block.label}</span>
      {external ? <ArrowUpRight className="size-3.5 shrink-0" /> : null}
    </a>
  );
}

export function AnnouncementContentView({
  document,
  compact = false,
  interactive = true,
  onCtaClick,
}: {
  document: AnnouncementContentDocument;
  compact?: boolean;
  interactive?: boolean;
  onCtaClick?: (event: MouseEvent<HTMLAnchorElement>, block: Extract<AnnouncementContentBlock, { type: "cta" }>) => void;
}) {
  return (
    <div
      className={cn("min-w-0", compact ? "space-y-2.5" : "space-y-4")}
      inert={interactive ? undefined : true}
    >
      {document.blocks.map((block) => {
        if (block.type === "rich_text") {
          return (
            <RichTextContent
              key={block.id}
              document={block.document as RichTextDocument}
              density="compact"
              className="whitespace-pre-wrap text-inherit [&_a]:text-inherit"
            />
          );
        }
        if (block.type === "callout") {
          const style = calloutStyles[block.tone];
          const Icon = style.icon;
          return (
            <aside key={block.id} className={cn("flex min-w-0 gap-2.5 rounded-md border p-3", style.container)}>
              <Icon className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                {block.title ? <h3 className="break-words text-xs font-bold">{block.title}</h3> : null}
                <p className={cn("whitespace-pre-wrap break-words text-xs leading-5", block.title && "mt-1")}>{block.body}</p>
              </div>
            </aside>
          );
        }
        if (block.type === "divider") {
          return <hr key={block.id} className={cn("border-0 border-t border-current opacity-25", block.style === "dashed" && "border-dashed", block.style === "dotted" && "border-dotted")} />;
        }
        return <ContentCta key={block.id} block={block} interactive={interactive} onClick={onCtaClick} />;
      })}
    </div>
  );
}

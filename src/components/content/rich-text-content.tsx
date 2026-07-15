import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  isExternalRichTextHref,
  sanitizeRichTextDocument,
  type RichTextInline,
} from "@/lib/rich-text/document";

function renderText(
  node: Extract<RichTextInline, { type: "text" }>,
  key: string,
) {
  let content: ReactNode = node.text;
  if (node.italic) content = <em>{content}</em>;
  if (node.bold) content = <strong>{content}</strong>;
  return <span key={key}>{content}</span>;
}

function renderInline(node: RichTextInline, key: string): ReactNode {
  if (node.type === "text") return renderText(node, key);
  if (node.type === "linebreak") return <br key={key} />;

  const external = isExternalRichTextHref(node.href);
  return (
    <a
      key={key}
      href={node.href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer nofollow" : undefined}
      referrerPolicy={external ? "no-referrer" : undefined}
      className="focus-ring rounded-sm font-medium text-[#276b88] underline decoration-[#8ab5c5] decoration-1 underline-offset-2 hover:text-[#174d67]"
    >
      {node.children.map((child, index) =>
        child.type === "text"
          ? renderText(child, `${key}-${index}`)
          : <br key={`${key}-${index}`} />,
      )}
    </a>
  );
}

export function RichTextContent({
  document,
  density = "reader",
  className,
}: {
  document: unknown;
  density?: "compact" | "reader";
  className?: string;
}) {
  const sanitized = sanitizeRichTextDocument(document);
  const compact = density === "compact";

  return (
    <div
      className={cn(
        "min-w-0 break-words text-[#52606d]",
        compact ? "space-y-2 text-sm leading-6" : "space-y-4 text-[15px] leading-8",
        className,
      )}
      data-rich-text-version={sanitized.version}
    >
      {sanitized.blocks.map((block, blockIndex) => {
        if (block.type === "heading") {
          const children = block.children.map((node, index) =>
            renderInline(node, `${blockIndex}-${index}`),
          );
          if (block.level === 3) {
            return (
              <h3
                key={blockIndex}
                className={cn(
                  "font-bold leading-tight text-[#243444]",
                  compact ? "text-base" : "text-xl",
                )}
              >
                {children}
              </h3>
            );
          }
          return (
            <h2
              key={blockIndex}
              className={cn(
                "font-bold leading-tight text-[#17212b]",
                compact ? "text-lg" : "text-2xl",
              )}
            >
              {children}
            </h2>
          );
        }

        if (block.type === "list") {
          const List = block.style === "number" ? "ol" : "ul";
          return (
            <List
              key={blockIndex}
              className={cn(
                "space-y-1 pl-6 marker:font-semibold marker:text-[#2b9188]",
                block.style === "number" ? "list-decimal" : "list-disc",
              )}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {item.children.map((node, index) =>
                    renderInline(node, `${blockIndex}-${itemIndex}-${index}`),
                  )}
                </li>
              ))}
            </List>
          );
        }

        return (
          <p key={blockIndex}>
            {block.children.map((node, index) =>
              renderInline(node, `${blockIndex}-${index}`),
            )}
          </p>
        );
      })}
    </div>
  );
}

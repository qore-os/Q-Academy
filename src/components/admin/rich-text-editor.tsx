"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  type ElementNode,
  type LexicalNode,
} from "lexical";
import { $setBlocksType } from "@lexical/selection";
import {
  $createHeadingNode,
  $isHeadingNode,
  HeadingNode,
} from "@lexical/rich-text";
import {
  $createListItemNode,
  $createListNode,
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import {
  $createLinkNode,
  $isLinkNode,
  LinkNode,
  TOGGLE_LINK_COMMAND,
} from "@lexical/link";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import {
  ContentEditableElement,
  type ContentEditableElementProps,
} from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import {
  Bold,
  Check,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  Undo2,
  Unlink,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import type { AppLocale } from "@/lib/i18n/model";
import {
  isExternalRichTextHref,
  richTextDocumentHasContent,
  safeRichTextHref,
  sanitizeRichTextDocument,
  type RichTextDocument,
  type RichTextInline,
} from "@/lib/rich-text/document";

const editorTheme = {
  heading: {
    h2: "text-xl font-bold leading-tight text-[#17212b]",
    h3: "text-base font-bold leading-tight text-[#243444]",
  },
  link: "font-medium text-[#276b88] underline decoration-[#8ab5c5] underline-offset-2",
  list: {
    listitem: "ml-5 my-1",
    ol: "list-decimal",
    ul: "list-disc",
  },
  paragraph: "text-sm leading-7 text-[#354555]",
  text: {
    bold: "font-bold",
    italic: "italic",
  },
};

function appendTextNode(
  parent: ElementNode,
  node: Extract<RichTextInline, { type: "text" }>,
) {
  const text = $createTextNode(node.text);
  if (node.bold) text.toggleFormat("bold");
  if (node.italic) text.toggleFormat("italic");
  parent.append(text);
}

function appendInlineNodes(parent: ElementNode, nodes: RichTextInline[]) {
  for (const node of nodes) {
    if (node.type === "text") {
      appendTextNode(parent, node);
    } else if (node.type === "linebreak") {
      parent.append($createLineBreakNode());
    } else {
      const link = $createLinkNode(node.href, {
        rel: isExternalRichTextHref(node.href)
          ? "noopener noreferrer nofollow"
          : null,
        target: isExternalRichTextHref(node.href) ? "_blank" : null,
      });
      for (const child of node.children) {
        if (child.type === "text") appendTextNode(link, child);
        else link.append($createLineBreakNode());
      }
      parent.append(link);
    }
  }
}

function initializeEditor(document: RichTextDocument) {
  const root = $getRoot();
  root.clear();

  for (const block of document.blocks) {
    if (block.type === "list") {
      const list = $createListNode(
        block.style === "number" ? "number" : "bullet",
      );
      for (const item of block.items) {
        const listItem = $createListItemNode();
        appendInlineNodes(listItem, item.children);
        list.append(listItem);
      }
      root.append(list);
      continue;
    }

    const element =
      block.type === "heading"
        ? $createHeadingNode(block.level === 3 ? "h3" : "h2")
        : $createParagraphNode();
    appendInlineNodes(element, block.children);
    root.append(element);
  }

  if (!root.getChildrenSize()) root.append($createParagraphNode());
}

function lexicalInlineNodes(nodes: LexicalNode[]): RichTextInline[] {
  const result: RichTextInline[] = [];
  for (const node of nodes) {
    if ($isTextNode(node)) {
      result.push({
        type: "text",
        text: node.getTextContent(),
        ...(node.hasFormat("bold") ? { bold: true as const } : {}),
        ...(node.hasFormat("italic") ? { italic: true as const } : {}),
      });
    } else if ($isLineBreakNode(node)) {
      result.push({ type: "linebreak" });
    } else if ($isLinkNode(node)) {
      const href = safeRichTextHref(node.getURL());
      const children = lexicalInlineNodes(node.getChildren()).flatMap(
        (child) => (child.type === "link" ? child.children : [child]),
      );
      if (href) {
        result.push({
          type: "link",
          href,
          children: children.filter(
            (child) => child.type === "text" || child.type === "linebreak",
          ),
        });
      } else {
        result.push(...children);
      }
    } else if ($isElementNode(node)) {
      result.push(...lexicalInlineNodes(node.getChildren()));
    }
  }
  return result;
}

function editorDocument() {
  const blocks: RichTextDocument["blocks"] = [];
  for (const node of $getRoot().getChildren()) {
    if ($isListNode(node)) {
      blocks.push({
        type: "list",
        style: node.getListType() === "number" ? "number" : "bullet",
        items: node.getChildren().map((item) => ({
          children: $isElementNode(item)
            ? lexicalInlineNodes(item.getChildren())
            : [],
        })),
      });
    } else if ($isHeadingNode(node)) {
      blocks.push({
        type: "heading",
        level: node.getTag() === "h3" ? 3 : 2,
        children: lexicalInlineNodes(node.getChildren()),
      });
    } else if ($isElementNode(node)) {
      blocks.push({
        type: "paragraph",
        children: lexicalInlineNodes(node.getChildren()),
      });
    }
  }
  return sanitizeRichTextDocument({ version: 1, blocks });
}

function activeLinkForNode(node: LexicalNode | null) {
  let current = node;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if ($isLinkNode(current)) return current;
    current = current.getParent();
  }
  return null;
}

function ToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "focus-ring grid size-8 shrink-0 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3] disabled:opacity-35",
        active && "bg-[#e9f8f6] text-[#176f68]",
      )}
    >
      {children}
    </button>
  );
}

function RichTextToolbar({
  variant,
  locale,
}: {
  variant: "course" | "submission";
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).editor.richText;
  const [editor] = useLexicalComposerContext();
  const editable = useLexicalEditable();
  const [blockFormat, setBlockFormat] = useState<"paragraph" | "h2" | "h3">(
    "paragraph",
  );
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [list, setList] = useState<"bullet" | "number" | null>(null);
  const [activeLink, setActiveLink] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("https://");
  const [linkError, setLinkError] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    setBold(selection.hasFormat("bold"));
    setItalic(selection.hasFormat("italic"));

    const anchor = selection.anchor.getNode();
    const topLevel =
      anchor.getKey() === "root" ? anchor : anchor.getTopLevelElementOrThrow();
    if ($isHeadingNode(topLevel)) {
      setBlockFormat(topLevel.getTag() === "h3" ? "h3" : "h2");
    } else {
      setBlockFormat("paragraph");
    }
    setList(
      $isListNode(topLevel)
        ? topLevel.getListType() === "number"
          ? "number"
          : "bullet"
        : null,
    );
    setActiveLink(activeLinkForNode(anchor)?.getURL() ?? "");
  }, []);

  useEffect(() => {
    const unregisterUpdate = editor.registerUpdateListener(({ editorState }) =>
      editorState.read(updateToolbar),
    );
    const unregisterSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        updateToolbar();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    const unregisterUndo = editor.registerCommand(
      CAN_UNDO_COMMAND,
      (value) => {
        setCanUndo(value);
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    const unregisterRedo = editor.registerCommand(
      CAN_REDO_COMMAND,
      (value) => {
        setCanRedo(value);
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    return () => {
      unregisterUpdate();
      unregisterSelection();
      unregisterUndo();
      unregisterRedo();
    };
  }, [editor, updateToolbar]);

  const setBlock = (value: "paragraph" | "h2" | "h3") => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, () =>
        value === "paragraph"
          ? $createParagraphNode()
          : $createHeadingNode(value),
      );
    });
  };

  const toggleList = (type: "bullet" | "number") => {
    editor.dispatchCommand(
      list === type
        ? REMOVE_LIST_COMMAND
        : type === "number"
          ? INSERT_ORDERED_LIST_COMMAND
          : INSERT_UNORDERED_LIST_COMMAND,
      undefined,
    );
  };

  const applyLink = () => {
    const href = safeRichTextHref(linkDraft);
    if (!href) {
      setLinkError(copy.unsafeLink);
      return;
    }
    let collapsed = true;
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      collapsed = !$isRangeSelection(selection) || selection.isCollapsed();
    });
    if (collapsed && !activeLink) {
      setLinkError(copy.selectLinkText);
      return;
    }
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, {
      url: href,
      rel: isExternalRichTextHref(href)
        ? "noopener noreferrer nofollow"
        : null,
      target: isExternalRichTextHref(href) ? "_blank" : null,
    });
    setLinkError("");
    setLinkOpen(false);
    editor.focus();
  };

  return (
    <div className="border-b border-[#e1e5e8] bg-[#f8f9fa] p-1.5">
      <fieldset
        disabled={!editable}
        className={cn(
          "m-0 min-w-0 border-0 p-0 disabled:opacity-60",
          variant === "submission" &&
            "[&_button]:size-10 [&_select]:h-10 sm:[&_button]:size-8 sm:[&_select]:h-8",
        )}
      >
        <legend className="sr-only">{copy.formatText}</legend>
        <div className="flex flex-wrap items-center gap-1">
        {variant === "course" ? (
          <>
            <select
              aria-label={copy.blockFormat}
              value={blockFormat}
              onChange={(event) => {
                const value = event.target.value as "paragraph" | "h2" | "h3";
                setBlock(value);
                editor.focus();
              }}
              className="focus-ring h-8 rounded-md border border-[#dce1e5] bg-white px-2 text-[11px] font-semibold text-[#52606d]"
            >
              <option value="paragraph">{copy.paragraph}</option>
              <option value="h2">{copy.headingTwo}</option>
              <option value="h3">{copy.headingThree}</option>
            </select>
            <span className="mx-0.5 h-5 w-px bg-[#dce1e5]" />
          </>
        ) : null}
        <ToolbarButton
          label={copy.bold}
          active={bold}
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={copy.italic}
          active={italic}
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={copy.bulletList}
          active={list === "bullet"}
          onClick={() => toggleList("bullet")}
        >
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={copy.numberedList}
          active={list === "number"}
          onClick={() => toggleList("number")}
        >
          <ListOrdered className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={copy.editLink}
          active={Boolean(activeLink)}
          onClick={() => {
            setLinkDraft(activeLink || "https://");
            setLinkError("");
            setLinkOpen((value) => !value);
          }}
        >
          <Link2 className="size-4" />
        </ToolbarButton>
        {activeLink ? (
          <ToolbarButton
            label={copy.removeLink}
            onClick={() => {
              editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
              editor.focus();
            }}
          >
            <Unlink className="size-4" />
          </ToolbarButton>
        ) : null}
        <span className="mx-0.5 h-5 w-px bg-[#dce1e5]" />
        <ToolbarButton
          label={copy.undo}
          disabled={!canUndo}
          onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
        >
          <Undo2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={copy.redo}
          disabled={!canRedo}
          onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
        >
          <Redo2 className="size-4" />
        </ToolbarButton>
        </div>
        {linkOpen ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md border border-[#dce1e5] bg-white p-2">
          <input
            aria-label={copy.linkUrl}
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
            }}
            className="focus-ring h-8 min-w-0 flex-1 rounded border border-[#dce1e5] px-2 text-xs"
          />
          <button
            type="button"
            aria-label={copy.applyLink}
            title={copy.applyLink}
            onClick={applyLink}
            className="focus-ring grid size-8 place-items-center rounded-md bg-[#17324d] text-white"
          >
            <Check className="size-4" />
          </button>
          {linkError ? (
            <p className="w-full text-[10px] text-[#a94339]" role="alert">
              {linkError}
            </p>
          ) : null}
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}

function EditorEditablePlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(editable), [editable, editor]);
  return null;
}

function RichTextContentEditable(
  props: Omit<ContentEditableElementProps, "editor">,
) {
  const [editor] = useLexicalComposerContext();
  return <ContentEditableElement {...props} editor={editor} />;
}

export function RichTextEditor({
  id,
  name,
  initialValue,
  ariaLabel,
  placeholder,
  minHeightClassName = "min-h-64",
  disabled = false,
  labelledBy,
  describedBy,
  variant = "course",
  locale,
  onDocumentChange,
}: {
  id?: string;
  name?: string;
  initialValue: unknown;
  ariaLabel?: string;
  placeholder?: string;
  minHeightClassName?: string;
  disabled?: boolean;
  labelledBy?: string;
  describedBy?: string;
  variant?: "course" | "submission";
  locale: AppLocale;
  onDocumentChange?: (document: RichTextDocument) => void;
}) {
  const copy = getMainPageDictionary(locale).editor.richText;
  const resolvedAriaLabel = ariaLabel ?? copy.contentLabel;
  const resolvedPlaceholder = placeholder ?? copy.contentPlaceholder;
  const initialDocument = useMemo(
    () => sanitizeRichTextDocument(initialValue),
    [initialValue],
  );
  const [serialized, setSerialized] = useState(() =>
    JSON.stringify(initialDocument),
  );
  const [placeholderVisible, setPlaceholderVisible] = useState(
    () => !richTextDocumentHasContent(initialDocument),
  );
  const initialConfig = useMemo(
    () => ({
      namespace: "QAcademyRichText",
      nodes: [HeadingNode, ListNode, ListItemNode, LinkNode],
      theme: editorTheme,
      editable: !disabled,
      onError(error: Error) {
        throw error;
      },
      editorState: () => initializeEditor(initialDocument),
    }),
    [disabled, initialDocument],
  );

  return (
    <div className="overflow-hidden rounded-md border border-[#dce1e5] bg-white">
      {name ? <input type="hidden" name={name} value={serialized} /> : null}
      <LexicalComposer initialConfig={initialConfig}>
        <EditorEditablePlugin editable={!disabled} />
        <RichTextToolbar variant={variant} locale={locale} />
        <div className="relative">
          <RichTextPlugin
            contentEditable={
              <RichTextContentEditable
                id={id}
                aria-label={resolvedAriaLabel}
                aria-labelledby={labelledBy}
                aria-describedby={describedBy}
                aria-placeholder={resolvedPlaceholder}
                className={cn(
                  "focus-ring w-full px-4 py-3 text-sm leading-7 outline-none",
                  minHeightClassName,
                )}
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          {placeholderVisible ? (
            <p
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-3 text-sm text-[#9aa4ac]"
            >
              {resolvedPlaceholder}
            </p>
          ) : null}
          <HistoryPlugin />
          <ListPlugin hasStrictIndent />
          <LinkPlugin validateUrl={(url) => Boolean(safeRichTextHref(url))} />
          <OnChangePlugin
            ignoreSelectionChange
            onChange={(editorState) => {
              editorState.read(() => {
                const document = editorDocument();
                setSerialized(JSON.stringify(document));
                setPlaceholderVisible(!richTextDocumentHasContent(document));
                onDocumentChange?.(document);
              });
            }}
          />
        </div>
      </LexicalComposer>
    </div>
  );
}

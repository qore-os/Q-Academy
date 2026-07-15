"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Braces,
  MessageSquareWarning,
  Minus,
  MousePointerClick,
  Text,
  Trash2,
} from "lucide-react";

import { AnnouncementContentView } from "@/components/announcement-content";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { Button } from "@/components/ui/button";
import {
  createRichTextDocument,
  type RichTextDocument,
} from "@/lib/rich-text/document";
import {
  MAX_ANNOUNCEMENT_CONTENT_BLOCKS,
  type AnnouncementContentBlock,
  type AnnouncementContentDocument,
} from "@/lib/announcement-content";
import { getAnnouncementCopy } from "@/lib/i18n/announcements";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";

type TextTarget =
  | { blockId: string; field: "rich_text" }
  | { blockId: string; field: "callout_title" | "callout_body" }
  | { blockId: string; field: "cta_label" };

function newId() {
  return crypto.randomUUID();
}

function blockLabel(
  block: AnnouncementContentBlock,
  labels: ReturnType<typeof getAnnouncementCopy>["blocks"]["labels"],
) {
  if (block.type === "rich_text") return labels.richText;
  if (block.type === "callout") return labels.callout;
  if (block.type === "divider") return labels.divider;
  return labels.cta;
}

function appendTokenToRichText(document: RichTextDocument, token: string) {
  const blocks = [...document.blocks];
  const last = blocks.at(-1);
  const text = { type: "text" as const, text: `{{${token}}}` };
  if (!last) return createRichTextDocument(text.text);
  if (last.type === "list") {
    const items = [...last.items];
    const lastItem = items.at(-1);
    if (lastItem) items[items.length - 1] = { children: [...lastItem.children, text] };
    else items.push({ children: [text] });
    blocks[blocks.length - 1] = { ...last, items };
  } else {
    blocks[blocks.length - 1] = { ...last, children: [...last.children, text] };
  }
  return { version: 1 as const, blocks };
}

export function AnnouncementBlockEditor({
  value,
  onChange,
  variables,
  locale,
}: {
  value: AnnouncementContentDocument;
  onChange: (document: AnnouncementContentDocument) => void;
  variables: Array<{ token: string; label: string }>;
  locale: AppLocale;
}) {
  const announcementCopy = getAnnouncementCopy(locale);
  const copy = announcementCopy.blocks;
  const numberFormatter = new Intl.NumberFormat(intlLocale(locale));
  const [textTarget, setTextTarget] = useState<TextTarget | null>(null);
  const [editorRevisions, setEditorRevisions] = useState<Record<string, number>>({});

  const updateBlock = (id: string, next: AnnouncementContentBlock) => {
    onChange({ ...value, blocks: value.blocks.map((block) => block.id === id ? next : block) });
  };
  const moveBlock = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= value.blocks.length) return;
    const blocks = [...value.blocks];
    [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!];
    onChange({ ...value, blocks });
  };
  const addBlock = (type: AnnouncementContentBlock["type"]) => {
    if (value.blocks.length >= MAX_ANNOUNCEMENT_CONTENT_BLOCKS) return;
    const id = newId();
    const block: AnnouncementContentBlock =
      type === "rich_text"
        ? { id, type, document: createRichTextDocument(copy.defaults.richText) }
        : type === "callout"
          ? {
              id,
              type,
              tone: "info",
              title: copy.defaults.calloutTitle,
              body: copy.defaults.calloutBody,
            }
          : type === "divider"
            ? { id, type, style: "solid" }
            : {
                id,
                type,
                label: copy.defaults.ctaLabel,
                href: "/academy",
                style: "primary",
              };
    onChange({ ...value, blocks: [...value.blocks, block] });
    if (type === "rich_text") setTextTarget({ blockId: id, field: "rich_text" });
  };
  const insertVariable = (token: string) => {
    if (!textTarget) return;
    const block = value.blocks.find((entry) => entry.id === textTarget.blockId);
    if (!block) return;
    const insertion = `{{${token}}}`;
    if (block.type === "rich_text" && textTarget.field === "rich_text") {
      updateBlock(block.id, { ...block, document: appendTokenToRichText(block.document, token) });
      setEditorRevisions((current) => ({ ...current, [block.id]: (current[block.id] ?? 0) + 1 }));
    } else if (block.type === "callout") {
      updateBlock(block.id, textTarget.field === "callout_title"
        ? { ...block, title: `${block.title ?? ""}${insertion}`.slice(0, 120) }
        : { ...block, body: `${block.body}${insertion}`.slice(0, 1_000) });
    } else if (block.type === "cta") {
      updateBlock(block.id, { ...block, label: `${block.label}${insertion}`.slice(0, 80) });
    }
  };

  return (
    <section aria-labelledby="announcement-content-title" className="space-y-3">
      <input type="hidden" name="contentDocument" value={JSON.stringify(value)} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 id="announcement-content-title" className="text-sm font-bold text-[#2b3a48]">{copy.title}</h3>
          <p className="mt-1 text-[10px] font-semibold text-[#73808a]">
            {copy.count(
              numberFormatter.format(value.blocks.length),
              numberFormatter.format(MAX_ANNOUNCEMENT_CONTENT_BLOCKS),
            )}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:flex">
          <Button type="button" size="sm" variant="secondary" onClick={() => addBlock("rich_text")} disabled={value.blocks.length >= MAX_ANNOUNCEMENT_CONTENT_BLOCKS}><Text className="size-3.5" /> {copy.addText}</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => addBlock("callout")} disabled={value.blocks.length >= MAX_ANNOUNCEMENT_CONTENT_BLOCKS}><MessageSquareWarning className="size-3.5" /> {copy.addCallout}</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => addBlock("divider")} disabled={value.blocks.length >= MAX_ANNOUNCEMENT_CONTENT_BLOCKS}><Minus className="size-3.5" /> {copy.addDivider}</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => addBlock("cta")} disabled={value.blocks.length >= MAX_ANNOUNCEMENT_CONTENT_BLOCKS}><MousePointerClick className="size-3.5" /> {copy.addButton}</Button>
        </div>
      </div>

      <div className="space-y-2">
        {value.blocks.map((block, index) => (
          <article key={block.id} className="overflow-hidden rounded-md border border-[#dce1e5] bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-[#e8ebee] bg-[#f7f9fa] px-3 py-2">
              <span className="text-[11px] font-bold text-[#52606d]">{index + 1}. {blockLabel(block, copy.labels)}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => moveBlock(index, -1)} disabled={index === 0} className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-white disabled:opacity-30" aria-label={copy.moveUp(index + 1)} title={copy.moveUpTitle}><ArrowUp className="size-3.5" /></button>
                <button type="button" onClick={() => moveBlock(index, 1)} disabled={index === value.blocks.length - 1} className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-white disabled:opacity-30" aria-label={copy.moveDown(index + 1)} title={copy.moveDownTitle}><ArrowDown className="size-3.5" /></button>
                <button type="button" onClick={() => onChange({ ...value, blocks: value.blocks.filter((entry) => entry.id !== block.id) })} className="focus-ring grid size-8 place-items-center rounded-md text-[#a94339] hover:bg-[#fdf0ee]" aria-label={copy.remove(index + 1)} title={copy.removeTitle}><Trash2 className="size-3.5" /></button>
              </div>
            </div>
            <div className="p-3">
              {block.type === "rich_text" ? (
                <div onFocusCapture={() => setTextTarget({ blockId: block.id, field: "rich_text" })}>
                  <RichTextEditor key={`${block.id}-${editorRevisions[block.id] ?? 0}`} initialValue={block.document} ariaLabel={copy.richTextAria(index + 1)} placeholder={copy.richTextPlaceholder} minHeightClassName="min-h-28" locale={locale} onDocumentChange={(document) => updateBlock(block.id, { ...block, document })} />
                </div>
              ) : block.type === "callout" ? (
                <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                  <label><span className="mb-1 block text-[10px] font-bold text-[#65727e]">{copy.tone}</span><select value={block.tone} onChange={(event) => updateBlock(block.id, { ...block, tone: event.target.value as typeof block.tone })} className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-xs"><option value="info">{announcementCopy.tone.info}</option><option value="success">{announcementCopy.tone.success}</option><option value="warning">{announcementCopy.tone.warning}</option><option value="critical">{announcementCopy.tone.critical}</option></select></label>
                  <label><span className="mb-1 block text-[10px] font-bold text-[#65727e]">{copy.heading}</span><input value={block.title ?? ""} maxLength={120} onFocus={() => setTextTarget({ blockId: block.id, field: "callout_title" })} onChange={(event) => updateBlock(block.id, { ...block, title: event.target.value || null })} className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm" /></label>
                  <label className="sm:col-span-2"><span className="mb-1 block text-[10px] font-bold text-[#65727e]">{copy.text}</span><textarea value={block.body} required maxLength={1_000} onFocus={() => setTextTarget({ blockId: block.id, field: "callout_body" })} onChange={(event) => updateBlock(block.id, { ...block, body: event.target.value })} className="focus-ring min-h-20 w-full resize-y rounded-md border border-[#dce1e5] p-3 text-sm" /></label>
                </div>
              ) : block.type === "divider" ? (
                <label><span className="mb-1 block text-[10px] font-bold text-[#65727e]">{copy.dividerStyle}</span><select value={block.style} onChange={(event) => updateBlock(block.id, { ...block, style: event.target.value as typeof block.style })} className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"><option value="solid">{copy.dividerStyles.solid}</option><option value="dashed">{copy.dividerStyles.dashed}</option><option value="dotted">{copy.dividerStyles.dotted}</option></select></label>
              ) : (
                <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_150px]">
                  <label><span className="mb-1 block text-[10px] font-bold text-[#65727e]">{copy.label}</span><input value={block.label} required maxLength={80} onFocus={() => setTextTarget({ blockId: block.id, field: "cta_label" })} onChange={(event) => updateBlock(block.id, { ...block, label: event.target.value })} className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm" /></label>
                  <label><span className="mb-1 block text-[10px] font-bold text-[#65727e]">{copy.target}</span><input value={block.href} required maxLength={2_000} placeholder="/academy/courses" onChange={(event) => updateBlock(block.id, { ...block, href: event.target.value })} className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm" /></label>
                  <label><span className="mb-1 block text-[10px] font-bold text-[#65727e]">{copy.appearance}</span><select value={block.style} onChange={(event) => updateBlock(block.id, { ...block, style: event.target.value as typeof block.style })} className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"><option value="primary">{copy.appearances.primary}</option><option value="secondary">{copy.appearances.secondary}</option></select></label>
                </div>
              )}
            </div>
          </article>
        ))}
        {!value.blocks.length ? <div className="rounded-md border border-dashed border-[#ccd4da] px-4 py-6 text-center text-xs text-[#73808a]">{copy.empty}</div> : null}
      </div>

      {variables.length ? (
        <div className="rounded-md bg-[#f4f7f8] p-3">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-[#65727e]"><Braces className="size-3.5" /> {copy.variables}</p>
          <div
            className="focus-ring mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto"
            role="region"
            aria-label={copy.variablesRegion}
            tabIndex={0}
          >
            {variables.map((variable) => <button key={variable.token} type="button" disabled={!textTarget} onClick={() => insertVariable(variable.token)} title={variable.label} className="focus-ring rounded border border-[#d9e1e5] bg-white px-2 py-1 font-mono text-[10px] text-[#425464] hover:bg-[#edf2f4] disabled:opacity-40">{`{{${variable.token}}}`}</button>)}
          </div>
        </div>
      ) : null}

      <div className="rounded-md border border-[#dfe4e8] bg-[#f7f9fa] p-4" aria-label={copy.previewAria}>
        <p className="mb-3 text-[10px] font-bold uppercase text-[#65727e]">{copy.preview}</p>
        <AnnouncementContentView document={value} interactive={false} />
      </div>
    </section>
  );
}

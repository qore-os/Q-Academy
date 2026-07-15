"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  CODE_BLOCK_LANGUAGES,
  sanitizeAccordionDocument,
  sanitizeCalloutDocument,
  sanitizeCodeDocument,
  sanitizeColumnsDocument,
  sanitizeDividerDocument,
  sanitizeQuoteDocument,
  sanitizeTableDocument,
  sanitizeTabsDocument,
  type AccordionDocument,
  type CalloutDocument,
  type CodeDocument,
  type ColumnsDocument,
  type DividerDocument,
  type QuoteDocument,
  type TableDocument,
  type TabsDocument,
} from "@/lib/content-blocks/layout-documents";
import { getCourseParityCopy, type CourseParityCopy } from "@/lib/i18n/course-parity";
import type { AppLocale } from "@/lib/i18n/model";

const inputClass =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444]";
const textareaClass =
  "focus-ring min-h-24 w-full rounded-md border border-[#dce1e5] bg-white px-3 py-2.5 text-sm leading-6 text-[#243444]";
const labelClass = "mb-1.5 block text-xs font-semibold text-[#52606d]";

type StructuredCopy = CourseParityCopy["structured"];

function HiddenDocument({ value }: { value: object }) {
  return <input type="hidden" name="structuredDocument" value={JSON.stringify(value)} />;
}

function CalloutEditor({ initialValue, copy }: { initialValue: unknown; copy: StructuredCopy }) {
  const [document, setDocument] = useState<CalloutDocument>(
    sanitizeCalloutDocument(initialValue) ?? {
      version: 1,
      tone: "info",
      heading: copy.title,
      body: copy.defaultBody,
    },
  );
  return (
    <div className="space-y-4">
      <HiddenDocument value={document} />
      <label>
        <span className={labelClass}>{copy.type}</span>
        <select
          className={inputClass}
          value={document.tone}
          onChange={(event) =>
            setDocument({ ...document, tone: event.target.value as CalloutDocument["tone"] })
          }
        >
          {Object.entries(copy.tones).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        <span className={labelClass}>{copy.title}</span>
        <input
          className={inputClass}
          maxLength={220}
          value={document.heading ?? ""}
          onChange={(event) => setDocument({ ...document, heading: event.target.value })}
        />
      </label>
      <label>
        <span className={labelClass}>{copy.content}</span>
        <textarea
          className={textareaClass}
          required
          maxLength={12_000}
          value={document.body}
          onChange={(event) => setDocument({ ...document, body: event.target.value })}
        />
      </label>
    </div>
  );
}

function QuoteEditor({ initialValue, copy }: { initialValue: unknown; copy: StructuredCopy }) {
  const [document, setDocument] = useState<QuoteDocument>(
    sanitizeQuoteDocument(initialValue) ?? { version: 1, quote: copy.quote },
  );
  return (
    <div className="space-y-4">
      <HiddenDocument value={document} />
      <label>
        <span className={labelClass}>{copy.quote}</span>
        <textarea className={textareaClass} required maxLength={12_000} value={document.quote} onChange={(event) => setDocument({ ...document, quote: event.target.value })} />
      </label>
      <label>
        <span className={labelClass}>{copy.attribution}</span>
        <input className={inputClass} maxLength={500} value={document.attribution ?? ""} onChange={(event) => setDocument({ ...document, attribution: event.target.value })} />
      </label>
      <label>
        <span className={labelClass}>{copy.sourceOptional}</span>
        <input className={inputClass} maxLength={2_000} value={document.sourceUrl ?? ""} onChange={(event) => setDocument({ ...document, sourceUrl: event.target.value })} />
      </label>
    </div>
  );
}

function DividerEditor({ initialValue, copy }: { initialValue: unknown; copy: StructuredCopy }) {
  const [document, setDocument] = useState<DividerDocument>(
    sanitizeDividerDocument(initialValue) ?? { version: 1, style: "solid", spacing: "normal" },
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <HiddenDocument value={document} />
      <label>
        <span className={labelClass}>{copy.line}</span>
        <select className={inputClass} value={document.style} onChange={(event) => setDocument({ ...document, style: event.target.value as DividerDocument["style"] })}>
          {Object.entries(copy.lineStyles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        <span className={labelClass}>{copy.spacing}</span>
        <select className={inputClass} value={document.spacing} onChange={(event) => setDocument({ ...document, spacing: event.target.value as DividerDocument["spacing"] })}>
          {Object.entries(copy.spacings).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </div>
  );
}

function AccordionEditor({ initialValue, copy }: { initialValue: unknown; copy: StructuredCopy }) {
  const [document, setDocument] = useState<AccordionDocument>(
    sanitizeAccordionDocument(initialValue) ?? {
      version: 1,
      items: [{ id: "item-1", title: copy.newItemTitle(1), body: copy.defaultBody, openByDefault: false }],
    },
  );
  return (
    <div className="space-y-3">
      <HiddenDocument value={document} />
      {document.items.map((item, index) => (
        <section key={item.id} className="rounded-md border border-[#dce3e8] p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-3">
              <label><span className={labelClass}>{copy.itemTitle(index + 1)}</span><input className={inputClass} required maxLength={220} value={item.title} onChange={(event) => setDocument({ ...document, items: document.items.map((candidate) => candidate.id === item.id ? { ...candidate, title: event.target.value } : candidate) })} /></label>
              <label><span className={labelClass}>{copy.content}</span><textarea className={textareaClass} required maxLength={12_000} value={item.body} onChange={(event) => setDocument({ ...document, items: document.items.map((candidate) => candidate.id === item.id ? { ...candidate, body: event.target.value } : candidate) })} /></label>
              <label className="flex items-center gap-2 text-xs font-semibold text-[#52606d]"><input type="checkbox" checked={item.openByDefault} onChange={(event) => setDocument({ ...document, items: document.items.map((candidate) => candidate.id === item.id ? { ...candidate, openByDefault: event.target.checked } : candidate) })} />{copy.initiallyOpen}</label>
            </div>
            <button type="button" title={copy.removeItem(index + 1)} aria-label={copy.removeItem(index + 1)} disabled={document.items.length === 1} onClick={() => setDocument({ ...document, items: document.items.filter((candidate) => candidate.id !== item.id) })} className="focus-ring grid size-9 shrink-0 place-items-center rounded-md text-[#8a5960] hover:bg-[#fdf0ee] disabled:opacity-30"><Trash2 className="size-4" /></button>
          </div>
        </section>
      ))}
      <button type="button" disabled={document.items.length >= 20} onClick={() => setDocument({ ...document, items: [...document.items, { id: crypto.randomUUID(), title: copy.newItemTitle(document.items.length + 1), body: copy.defaultBody, openByDefault: false }] })} className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-[#b8c7d2] bg-white px-3 text-xs font-bold text-[#365f8d] disabled:opacity-40"><Plus className="size-4" />{copy.item}</button>
    </div>
  );
}

function TabsEditor({ initialValue, copy }: { initialValue: unknown; copy: StructuredCopy }) {
  const [document, setDocument] = useState<TabsDocument>(
    sanitizeTabsDocument(initialValue) ?? {
      version: 1,
      tabs: [1, 2].map((number) => ({ id: `tab-${number}`, label: copy.newTabLabel(number), body: copy.defaultBody })),
      defaultTabId: "tab-1",
    },
  );
  return (
    <div className="space-y-3">
      <HiddenDocument value={document} />
      {document.tabs.map((tab, index) => (
        <section key={tab.id} className="rounded-md border border-[#dce3e8] p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-3">
              <label><span className={labelClass}>{copy.tab(index + 1)}</span><input className={inputClass} required maxLength={120} value={tab.label} onChange={(event) => setDocument({ ...document, tabs: document.tabs.map((candidate) => candidate.id === tab.id ? { ...candidate, label: event.target.value } : candidate) })} /></label>
              <label><span className={labelClass}>{copy.content}</span><textarea className={textareaClass} required maxLength={12_000} value={tab.body} onChange={(event) => setDocument({ ...document, tabs: document.tabs.map((candidate) => candidate.id === tab.id ? { ...candidate, body: event.target.value } : candidate) })} /></label>
              <label className="flex items-center gap-2 text-xs font-semibold text-[#52606d]"><input type="radio" name="structuredDefaultTab" checked={document.defaultTabId === tab.id} onChange={() => setDocument({ ...document, defaultTabId: tab.id })} />{copy.initiallyActive}</label>
            </div>
            <button type="button" title={copy.removeTab(index + 1)} aria-label={copy.removeTab(index + 1)} disabled={document.tabs.length <= 2} onClick={() => { const tabs = document.tabs.filter((candidate) => candidate.id !== tab.id); setDocument({ ...document, tabs, defaultTabId: document.defaultTabId === tab.id ? tabs[0]!.id : document.defaultTabId }); }} className="focus-ring grid size-9 shrink-0 place-items-center rounded-md text-[#8a5960] hover:bg-[#fdf0ee] disabled:opacity-30"><Trash2 className="size-4" /></button>
          </div>
        </section>
      ))}
      <button type="button" disabled={document.tabs.length >= 12} onClick={() => { const id = crypto.randomUUID(); setDocument({ ...document, tabs: [...document.tabs, { id, label: copy.newTabLabel(document.tabs.length + 1), body: copy.defaultBody }] }); }} className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-[#b8c7d2] bg-white px-3 text-xs font-bold text-[#365f8d] disabled:opacity-40"><Plus className="size-4" />{copy.tab(document.tabs.length + 1)}</button>
    </div>
  );
}

function ColumnsEditor({ initialValue, copy }: { initialValue: unknown; copy: StructuredCopy }) {
  const [document, setDocument] = useState<ColumnsDocument>(
    sanitizeColumnsDocument(initialValue) ?? {
      version: 1,
      layout: "equal",
      columns: [1, 2].map((number) => ({ id: `column-${number}`, heading: copy.newColumnHeading(number), body: copy.defaultBody })),
    },
  );
  return (
    <div className="space-y-3">
      <HiddenDocument value={document} />
      <label><span className={labelClass}>{copy.layout}</span><select className={inputClass} value={document.layout} onChange={(event) => setDocument({ ...document, layout: event.target.value as ColumnsDocument["layout"] })}>{Object.entries(copy.layouts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {document.columns.map((column, index) => (
        <section key={column.id} className="rounded-md border border-[#dce3e8] p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-3">
              <label><span className={labelClass}>{copy.column(index + 1)}</span><input className={inputClass} maxLength={220} value={column.heading ?? ""} onChange={(event) => setDocument({ ...document, columns: document.columns.map((candidate) => candidate.id === column.id ? { ...candidate, heading: event.target.value } : candidate) })} /></label>
              <label><span className={labelClass}>{copy.content}</span><textarea className={textareaClass} required maxLength={12_000} value={column.body} onChange={(event) => setDocument({ ...document, columns: document.columns.map((candidate) => candidate.id === column.id ? { ...candidate, body: event.target.value } : candidate) })} /></label>
            </div>
            <button type="button" title={copy.removeColumn(index + 1)} aria-label={copy.removeColumn(index + 1)} disabled={document.columns.length <= 2} onClick={() => setDocument({ ...document, columns: document.columns.filter((candidate) => candidate.id !== column.id) })} className="focus-ring grid size-9 shrink-0 place-items-center rounded-md text-[#8a5960] hover:bg-[#fdf0ee] disabled:opacity-30"><Trash2 className="size-4" /></button>
          </div>
        </section>
      ))}
      <button type="button" disabled={document.columns.length >= 3} onClick={() => setDocument({ ...document, columns: [...document.columns, { id: crypto.randomUUID(), heading: copy.newColumnHeading(document.columns.length + 1), body: copy.defaultBody }] })} className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-[#b8c7d2] bg-white px-3 text-xs font-bold text-[#365f8d] disabled:opacity-40"><Plus className="size-4" />{copy.column(document.columns.length + 1)}</button>
    </div>
  );
}

function CodeEditor({ initialValue, copy }: { initialValue: unknown; copy: StructuredCopy }) {
  const [document, setDocument] = useState<CodeDocument>(
    sanitizeCodeDocument(initialValue) ?? {
      version: 1,
      language: "plaintext",
      code: copy.defaultCode,
      lineNumbers: true,
      wrap: false,
    },
  );
  return (
    <div className="space-y-4">
      <HiddenDocument value={document} />
      <label>
        <span className={labelClass}>{copy.codeLanguage}</span>
        <select
          className={inputClass}
          value={document.language}
          onChange={(event) =>
            setDocument({
              ...document,
              language: event.target.value as CodeDocument["language"],
            })
          }
        >
          {CODE_BLOCK_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {copy.codeLanguages[language]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className={labelClass}>{copy.code}</span>
        <textarea
          className={`${textareaClass} min-h-64 font-mono text-xs`}
          required
          maxLength={30_000}
          spellCheck={false}
          value={document.code}
          onChange={(event) => setDocument({ ...document, code: event.target.value })}
        />
      </label>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-xs font-semibold text-[#52606d]">
          <input type="checkbox" checked={document.lineNumbers} onChange={(event) => setDocument({ ...document, lineNumbers: event.target.checked })} />
          {copy.lineNumbers}
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-[#52606d]">
          <input type="checkbox" checked={document.wrap} onChange={(event) => setDocument({ ...document, wrap: event.target.checked })} />
          {copy.wrapLines}
        </label>
      </div>
    </div>
  );
}

function TableEditor({ initialValue, copy }: { initialValue: unknown; copy: StructuredCopy }) {
  const [document, setDocument] = useState<TableDocument>(
    sanitizeTableDocument(initialValue) ?? {
      version: 1,
      caption: copy.defaultTableCaption,
      headers: [copy.newTableHeader(1), copy.newTableHeader(2)],
      rows: [[copy.defaultTableCell, copy.defaultTableCell]],
      striped: true,
    },
  );
  const updateHeader = (index: number, value: string) =>
    setDocument({
      ...document,
      headers: document.headers.map((header, candidate) =>
        candidate === index ? value : header,
      ),
    });
  const updateCell = (rowIndex: number, columnIndex: number, value: string) =>
    setDocument({
      ...document,
      rows: document.rows.map((row, candidateRow) =>
        candidateRow === rowIndex
          ? row.map((cell, candidateColumn) =>
              candidateColumn === columnIndex ? value : cell,
            )
          : row,
      ),
    });
  return (
    <div className="space-y-4">
      <HiddenDocument value={document} />
      <label>
        <span className={labelClass}>{copy.tableCaption}</span>
        <input className={inputClass} maxLength={500} value={document.caption ?? ""} onChange={(event) => setDocument({ ...document, caption: event.target.value })} />
      </label>
      <div className="overflow-x-auto pb-2">
        <div className="min-w-max space-y-2">
          <div className="flex gap-2">
            {document.headers.map((header, columnIndex) => (
              <div key={`header-${columnIndex}`} className="flex w-52 items-center gap-1">
                <input className={inputClass} required maxLength={500} value={header} onChange={(event) => updateHeader(columnIndex, event.target.value)} aria-label={copy.newTableHeader(columnIndex + 1)} />
                <button
                  type="button"
                  disabled={document.headers.length <= 1}
                  onClick={() => setDocument({ ...document, headers: document.headers.filter((_, index) => index !== columnIndex), rows: document.rows.map((row) => row.filter((_, index) => index !== columnIndex)) })}
                  title={copy.removeColumnLabel(columnIndex + 1)}
                  aria-label={copy.removeColumnLabel(columnIndex + 1)}
                  className="focus-ring grid size-9 shrink-0 place-items-center rounded-md text-[#8a5960] hover:bg-[#fdf0ee] disabled:opacity-30"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          {document.rows.map((row, rowIndex) => (
            <div key={`row-${rowIndex}`} className="flex items-center gap-2">
              {row.map((cell, columnIndex) => (
                <input key={`cell-${rowIndex}-${columnIndex}`} className={`${inputClass} w-52`} maxLength={2_000} value={cell} onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)} aria-label={`${copy.newTableHeader(columnIndex + 1)} ${rowIndex + 1}`} />
              ))}
              <button
                type="button"
                disabled={document.rows.length <= 1}
                onClick={() => setDocument({ ...document, rows: document.rows.filter((_, index) => index !== rowIndex) })}
                title={copy.removeRow(rowIndex + 1)}
                aria-label={copy.removeRow(rowIndex + 1)}
                className="focus-ring grid size-9 shrink-0 place-items-center rounded-md text-[#8a5960] hover:bg-[#fdf0ee] disabled:opacity-30"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={document.rows.length >= 100} onClick={() => setDocument({ ...document, rows: [...document.rows, document.headers.map(() => copy.defaultTableCell)] })} className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-[#b8c7d2] bg-white px-3 text-xs font-bold text-[#365f8d] disabled:opacity-40"><Plus className="size-4" />{copy.addRow}</button>
        <button type="button" disabled={document.headers.length >= 12} onClick={() => setDocument({ ...document, headers: [...document.headers, copy.newTableHeader(document.headers.length + 1)], rows: document.rows.map((row) => [...row, copy.defaultTableCell]) })} className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-[#b8c7d2] bg-white px-3 text-xs font-bold text-[#365f8d] disabled:opacity-40"><Plus className="size-4" />{copy.addColumn}</button>
      </div>
      <label className="flex items-center gap-2 text-xs font-semibold text-[#52606d]">
        <input type="checkbox" checked={document.striped} onChange={(event) => setDocument({ ...document, striped: event.target.checked })} />
        {copy.stripedRows}
      </label>
    </div>
  );
}

export function StructuredContentBlockEditor({
  type,
  initialValue,
  locale,
}: {
  type: "callout" | "quote" | "divider" | "accordion" | "tabs" | "columns" | "code" | "table";
  initialValue: unknown;
  locale: AppLocale;
}) {
  const copy = getCourseParityCopy(locale).structured;
  if (type === "callout") return <CalloutEditor initialValue={initialValue} copy={copy} />;
  if (type === "quote") return <QuoteEditor initialValue={initialValue} copy={copy} />;
  if (type === "divider") return <DividerEditor initialValue={initialValue} copy={copy} />;
  if (type === "accordion") return <AccordionEditor initialValue={initialValue} copy={copy} />;
  if (type === "tabs") return <TabsEditor initialValue={initialValue} copy={copy} />;
  if (type === "columns") return <ColumnsEditor initialValue={initialValue} copy={copy} />;
  if (type === "code") return <CodeEditor initialValue={initialValue} copy={copy} />;
  return <TableEditor initialValue={initialValue} copy={copy} />;
}

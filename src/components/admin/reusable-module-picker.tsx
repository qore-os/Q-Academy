"use client";

import {
  BookOpenCheck,
  ClipboardCheck,
  FolderOpen,
  Link2,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";

import { getCourseParityCopy } from "@/lib/i18n/course-parity";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import {
  filterReusableModules,
  type ReusableModuleOption,
} from "@/lib/reusable-module-picker";
import { cn } from "@/lib/utils";

const KIND_ICONS = {
  learning: BookOpenCheck,
  exam: ClipboardCheck,
  link: Link2,
} as const;

export function ReusableModulePicker({
  modules,
  value,
  onChange,
  locale,
  disabled = false,
}: {
  modules: ReusableModuleOption[];
  value: string;
  onChange: (moduleId: string) => void;
  locale: AppLocale;
  disabled?: boolean;
}) {
  const copy = getCourseParityCopy(locale).modulePicker;
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState("all");
  const [kind, setKind] = useState<"all" | ReusableModuleOption["kind"]>(
    "all",
  );
  const collator = useMemo(
    () => new Intl.Collator(intlLocale(locale), { sensitivity: "base" }),
    [locale],
  );
  const folders = useMemo(
    () =>
      [...new Set(modules.map((module) => module.folder))].sort(collator.compare),
    [collator, modules],
  );
  const visible = filterReusableModules(modules, {
    query,
    folder,
    kind,
    locale,
  });

  return (
    <div className="mt-3 space-y-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_150px]">
        <label className="relative block">
          <span className="sr-only">{copy.search}</span>
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-[#71808b]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={copy.search}
            disabled={disabled}
            className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white pl-9 pr-3 text-sm text-[#243444]"
          />
        </label>
        <label>
          <span className="sr-only">{copy.folder}</span>
          <select
            value={folder}
            onChange={(event) => setFolder(event.currentTarget.value)}
            disabled={disabled}
            className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-xs text-[#354555]"
            aria-label={copy.folder}
          >
            <option value="all">{copy.allFolders}</option>
            {folders.map((entry) => (
              <option key={entry} value={entry}>{entry}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{copy.kind}</span>
          <select
            value={kind}
            onChange={(event) =>
              setKind(event.currentTarget.value as typeof kind)
            }
            disabled={disabled}
            className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-xs text-[#354555]"
            aria-label={copy.kind}
          >
            <option value="all">{copy.allKinds}</option>
            <option value="learning">{copy.kinds.learning}</option>
            <option value="exam">{copy.kinds.exam}</option>
            <option value="link">{copy.kinds.link}</option>
          </select>
        </label>
      </div>

      <p className="text-[10px] font-semibold text-[#71808b]" role="status">
        {copy.resultCount(visible.length, modules.length)}
      </p>

      <div
        role="radiogroup"
        aria-label={copy.kind}
        className="min-h-48 max-h-72 overflow-y-auto rounded-md border border-[#dce1e5] bg-white"
      >
        {visible.map((module) => {
          const Icon = KIND_ICONS[module.kind];
          const selected = value === module.id;
          return (
            <button
              key={module.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={copy.select(module.title)}
              disabled={disabled}
              onClick={() => onChange(module.id)}
              className={cn(
                "focus-ring flex min-h-14 w-full items-center gap-3 border-b border-[#edf0f2] px-3 py-2 text-left last:border-b-0 disabled:opacity-50",
                selected ? "bg-[#eff9f7]" : "hover:bg-[#f8fafb]",
              )}
            >
              <span className={cn(
                "grid size-8 shrink-0 place-items-center rounded-md",
                selected ? "bg-[#d7f0ec] text-[#167e74]" : "bg-[#f0f3f5] text-[#526b83]",
              )}>
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-[#354555]">
                  {module.title}
                </span>
                <span className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-[#71808b]">
                  <FolderOpen className="size-3 shrink-0" />
                  {module.folder}
                </span>
              </span>
              <span className="shrink-0 rounded bg-[#f0f3f5] px-2 py-1 text-[9px] font-semibold text-[#52606d]">
                {copy.kinds[module.kind]}
              </span>
            </button>
          );
        })}
        {!visible.length ? (
          <div className="grid min-h-48 place-items-center px-4 text-center text-xs text-[#71808b]">
            {copy.empty}
          </div>
        ) : null}
      </div>
    </div>
  );
}

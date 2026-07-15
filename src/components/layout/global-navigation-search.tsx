"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  Boxes,
  CalendarDays,
  Compass,
  LoaderCircle,
  MessageCircleMore,
  Search,
  UserRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import type { AppLocale } from "@/lib/i18n/model";
type SearchMode = "admin" | "member";
type SearchKind =
  "course" | "module" | "member" | "community" | "hub" | "event";

type SearchResult = {
  id: string;
  kind: SearchKind;
  title: string;
  description: string | null;
  href: string;
};

const categories = [
  { kind: "course", icon: BookOpen },
  { kind: "module", icon: Boxes },
  { kind: "member", icon: UserRound },
  { kind: "community", icon: MessageCircleMore },
  { kind: "hub", icon: Compass },
  { kind: "event", icon: CalendarDays },
] as const satisfies ReadonlyArray<{
  kind: SearchKind;
  icon: typeof Search;
}>;

const SEARCH_COPY: Record<AppLocale, {
  adminTrigger: string;
  memberTrigger: string;
  open: string;
  close: string;
  title: string;
  placeholder: string;
  loading: string;
  unavailable: string;
  failed: string;
  empty: (query: string) => string;
  categories: Record<SearchKind, string>;
}> = {
  de: { adminTrigger: "Kurse, Mitglieder und Inhalte suchen", memberTrigger: "Kurse und Bereiche suchen", open: "Globale Suche oeffnen", close: "Suche schliessen", title: "Globale Suche", placeholder: "Wonach suchst du?", loading: "Suche laeuft", unavailable: "Die Suche ist gerade nicht verfuegbar.", failed: "Suche fehlgeschlagen", empty: (query) => `Keine Treffer fuer \"${query}\"`, categories: { course: "Kurse", module: "Module", member: "Mitglieder", community: "Community", hub: "Hubs", event: "Events" } },
  en: { adminTrigger: "Search courses, members and content", memberTrigger: "Search courses and areas", open: "Open global search", close: "Close search", title: "Global search", placeholder: "What are you looking for?", loading: "Searching", unavailable: "Search is currently unavailable.", failed: "Search failed", empty: (query) => `No results for \"${query}\"`, categories: { course: "Courses", module: "Modules", member: "Members", community: "Community", hub: "Hubs", event: "Events" } },
  it: { adminTrigger: "Cerca corsi, membri e contenuti", memberTrigger: "Cerca corsi e aree", open: "Apri ricerca globale", close: "Chiudi ricerca", title: "Ricerca globale", placeholder: "Cosa stai cercando?", loading: "Ricerca in corso", unavailable: "La ricerca non è disponibile.", failed: "Ricerca non riuscita", empty: (query) => `Nessun risultato per \"${query}\"`, categories: { course: "Corsi", module: "Moduli", member: "Membri", community: "Community", hub: "Hub", event: "Eventi" } },
  es: { adminTrigger: "Buscar cursos, miembros y contenidos", memberTrigger: "Buscar cursos y áreas", open: "Abrir búsqueda global", close: "Cerrar búsqueda", title: "Búsqueda global", placeholder: "¿Qué estás buscando?", loading: "Buscando", unavailable: "La búsqueda no está disponible.", failed: "Error en la búsqueda", empty: (query) => `No hay resultados para \"${query}\"`, categories: { course: "Cursos", module: "Módulos", member: "Miembros", community: "Comunidad", hub: "Hubs", event: "Eventos" } },
  fr: { adminTrigger: "Rechercher des cours, membres et contenus", memberTrigger: "Rechercher des cours et espaces", open: "Ouvrir la recherche globale", close: "Fermer la recherche", title: "Recherche globale", placeholder: "Que recherchez-vous ?", loading: "Recherche en cours", unavailable: "La recherche est indisponible.", failed: "Échec de la recherche", empty: (query) => `Aucun résultat pour \"${query}\"`, categories: { course: "Cours", module: "Modules", member: "Membres", community: "Communauté", hub: "Hubs", event: "Événements" } },
};

export function GlobalNavigationSearch({ mode, locale }: { mode: SearchMode; locale: AppLocale }) {
  const copy = SEARCH_COPY[locale];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const cancelPendingSearch = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);

  const closeDialog = useCallback(() => {
    cancelPendingSearch();
    setOpen(false);
    setQuery("");
    setResults([]);
    setLoading(false);
    setError(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, [cancelPendingSearch]);

  const openDialog = useCallback(() => setOpen(true), []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === "k"
      ) {
        event.preventDefault();
        openDialog();
      } else if (event.key === "Escape" && open) {
        event.preventDefault();
        closeDialog();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeDialog, open, openDialog]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => cancelPendingSearch, [cancelPendingSearch]);

  const runSearch = useCallback(
    async (nextQuery: string) => {
      const controller = new AbortController();
      requestRef.current = controller;

      try {
        const params = new URLSearchParams({ q: nextQuery, mode });
        const response = await fetch(`/api/navigation-search?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await response.json()) as {
          data?: SearchResult[];
        };
        if (!response.ok || !body.data) {
          setResults([]);
          setError(copy.unavailable);
          return;
        }
        setResults(body.data);
        setError(null);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }
        setResults([]);
        setError(copy.unavailable);
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          setLoading(false);
        }
      }
    },
    [copy.unavailable, mode],
  );

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextQuery = event.target.value;
    const trimmedQuery = nextQuery.trim();
    setQuery(nextQuery);
    cancelPendingSearch();
    setError(null);

    if (trimmedQuery.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runSearch(trimmedQuery);
    }, 180);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        aria-label={copy.open}
        aria-keyshortcuts="Control+K Meta+K"
        className="focus-ring flex size-9 shrink-0 items-center justify-center rounded-md border border-[#dfe4e8] bg-[#f8f9fa] text-[#66727f] hover:border-[#cbd3d9] hover:bg-[#f2f4f5] sm:h-9 sm:w-[min(42vw,420px)] sm:justify-start sm:gap-2.5 sm:px-3"
      >
        <Search className="size-4 shrink-0" />
        <span className="hidden truncate text-xs sm:block">
          {mode === "admin"
            ? copy.adminTrigger
            : copy.memberTrigger}
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90] flex items-start justify-center p-3 pt-[8vh] sm:p-5 sm:pt-[10vh]">
          <button
            type="button"
            className="absolute inset-0 bg-[#0f263c]/50 backdrop-blur-[1px]"
            onClick={closeDialog}
            aria-label={copy.close}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label={copy.title}
            className="relative flex max-h-[min(78vh,680px)] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
          >
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[#e5e9ec] px-3 sm:px-4">
              {loading ? (
                <LoaderCircle className="size-5 shrink-0 animate-spin text-[#2b9188]" />
              ) : (
                <Search className="size-5 shrink-0 text-[#5f6f7b]" />
              )}
              <input
                autoFocus
                type="search"
                value={query}
                onChange={handleQueryChange}
                aria-label={copy.title}
                placeholder={copy.placeholder}
                className="focus-ring h-10 min-w-0 flex-1 rounded-md border-0 bg-transparent px-1 text-sm text-[#243444] outline-none placeholder:text-[var(--theme-muted-text)]"
              />
              <button
                type="button"
                onClick={closeDialog}
                className="focus-ring grid size-9 shrink-0 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3]"
                aria-label={copy.close}
              >
                <X className="size-4.5" />
              </button>
            </div>

            <div className="min-h-44 flex-1 overflow-y-auto p-2 sm:p-3">
              {loading ? (
                <div
                  className="grid min-h-44 place-items-center text-center"
                  aria-live="polite"
                >
                  <div>
                    <LoaderCircle className="mx-auto size-6 animate-spin text-[#2b9188]" />
                    <p className="mt-2 text-xs font-medium text-[#71808b]">
                      {copy.loading}
                    </p>
                  </div>
                </div>
              ) : error ? (
                <div
                  role="alert"
                  className="grid min-h-44 place-items-center px-5 text-center"
                >
                  <div>
                    <Search className="mx-auto size-6 text-[#b84e42]" />
                    <p className="mt-2 text-sm font-semibold text-[#354555]">
                      {copy.failed}
                    </p>
                    <p className="mt-1 text-xs text-[#71808b]">{error}</p>
                  </div>
                </div>
              ) : query.trim().length < 2 ? (
                <div className="grid min-h-44 place-items-center text-center">
                  <div>
                    <Search className="mx-auto size-6 text-[#93a0aa]" />
                    <p className="mt-2 text-sm font-semibold text-[#455463]">
                      {copy.title}
                    </p>
                  </div>
                </div>
              ) : !results.length ? (
                <div
                  className="grid min-h-44 place-items-center px-5 text-center"
                  aria-live="polite"
                >
                  <div>
                    <Search className="mx-auto size-6 text-[#93a0aa]" />
                    <p className="mt-2 text-sm font-semibold text-[#455463]">
                      {copy.empty(query.trim())}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {categories.map((category) => {
                    const categoryResults = results.filter(
                      (result) => result.kind === category.kind,
                    );
                    if (!categoryResults.length) return null;
                    const Icon = category.icon;
                    return (
                      <section key={category.kind}>
                        <h2 className="flex items-center gap-2 px-2 py-1 text-[9px] font-bold uppercase text-[#7d8891]">
                          <Icon className="size-3.5" />
                          {copy.categories[category.kind]}
                        </h2>
                        <div className="space-y-0.5">
                          {categoryResults.map((result) => (
                            <Link
                              key={`${result.kind}-${result.id}`}
                              href={result.href}
                              onClick={closeDialog}
                              className="focus-ring group flex min-h-14 items-center gap-3 rounded-md px-2.5 py-2 hover:bg-[#f2f5f6]"
                            >
                              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#edf3f5] text-[#365f8d] group-hover:bg-white">
                                <Icon className="size-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-semibold text-[#354555]">
                                  {result.title}
                                </span>
                                {result.description ? (
                                  <span className="mt-0.5 block truncate text-[10px] text-[#7b8791]">
                                    {result.description}
                                  </span>
                                ) : null}
                              </span>
                              <ArrowUpRight className="size-4 shrink-0 text-[#9aa4ac] group-hover:text-[#2b9188]" />
                            </Link>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

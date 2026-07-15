import { intlLocale, type AppLocale } from "@/lib/i18n/model";

export type ReusableModuleOption = {
  id: string;
  title: string;
  kind: "learning" | "exam" | "link";
  folder: string;
  estimatedMinutes: number;
  lessonCount: number;
  usageCount: number;
};

export function filterReusableModules(
  modules: ReusableModuleOption[],
  filters: {
    query: string;
    folder: string;
    kind: "all" | ReusableModuleOption["kind"];
    locale: AppLocale;
  },
) {
  const normalizedQuery = filters.query
    .trim()
    .toLocaleLowerCase(intlLocale(filters.locale));
  return modules.filter((module) => {
    if (filters.folder !== "all" && module.folder !== filters.folder) {
      return false;
    }
    if (filters.kind !== "all" && module.kind !== filters.kind) return false;
    if (!normalizedQuery) return true;
    return `${module.title}\n${module.folder}`
      .toLocaleLowerCase(intlLocale(filters.locale))
      .includes(normalizedQuery);
  });
}

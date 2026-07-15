import type { HubLayout } from "@/db/schema";

export function hubLayoutFormIds(layout: HubLayout) {
  return [
    ...new Set(
      layout.flatMap((row) =>
        row.columns.flatMap((widget) =>
          widget.type === "data_form" && widget.formId ? [widget.formId] : [],
        ),
      ),
    ),
  ].sort();
}

export function hubLayoutTransitionFormIds(
  currentLayout: HubLayout,
  nextLayout: HubLayout,
) {
  return [
    ...new Set([
      ...hubLayoutFormIds(currentLayout),
      ...hubLayoutFormIds(nextLayout),
    ]),
  ].sort();
}

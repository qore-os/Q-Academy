import type { HubLayout } from "@/db/schema";
import { renderPersonalizedTemplateText } from "@/lib/member-property-model";

export type HubVariableContext = Readonly<{
  member: {
    firstName: string;
    lastName: string;
  };
  course: null | {
    title: string;
    progress: number;
  };
  properties?: Readonly<Record<string, string>>;
}>;

const VARIABLE_PATTERN =
  /\{\{\s*([a-z]+(?:\.[a-zA-Z][a-zA-Z0-9_]*){1,2})\s*\}\}/g;

export function resolveHubText(
  value: string | undefined,
  context: HubVariableContext,
) {
  if (value === undefined) return undefined;
  const values: Record<string, string> = {
    "member.firstName": context.member.firstName,
    "member.lastName": context.member.lastName,
    "member.fullName": `${context.member.firstName} ${context.member.lastName}`.trim(),
    "course.title": context.course?.title ?? "deinem Lernpfad",
    "course.progress": String(context.course?.progress ?? 0),
  };
  const resolved = value.replace(VARIABLE_PATTERN, (match, key: string) => {
    return Object.hasOwn(values, key) ? values[key]! : match;
  });
  return renderPersonalizedTemplateText(resolved, context.properties ?? {});
}

export function resolveHubLayoutVariables(
  layout: HubLayout,
  context: HubVariableContext,
): HubLayout {
  return layout.map((row) => ({
    ...row,
    columns: row.columns.map((widget) => ({
      ...widget,
      title: resolveHubText(widget.title, context) ?? widget.title,
      description:
        widget.type === "code"
          ? widget.description
          : resolveHubText(widget.description, context),
    })),
  }));
}

import { createHash } from "node:crypto";

export type ModuleReleaseAccess = Readonly<{
  module: Readonly<{ id: string; title: string }>;
  access: Readonly<{ accessible: boolean }>;
}>;

export function newlyAccessibleModules(
  previous: readonly ModuleReleaseAccess[] | null,
  next: readonly ModuleReleaseAccess[],
) {
  const previousAccess = new Map(
    (previous ?? []).map((entry) => [
      entry.module.id,
      entry.access.accessible,
    ]),
  );
  return next
    .filter(
      (entry) =>
        entry.access.accessible && previousAccess.get(entry.module.id) !== true,
    )
    .map((entry) => ({ id: entry.module.id, title: entry.module.title }));
}

export function releasedModuleList(
  modules: readonly Readonly<{ title: string }>[],
  limit = 20,
) {
  const visible = modules.slice(0, Math.max(1, limit));
  const remaining = Math.max(0, modules.length - visible.length);
  return [
    ...visible.map((module) => `- ${module.title.trim().slice(0, 220)}`),
    ...(remaining ? [`- + ${remaining} weitere Module`] : []),
  ].join("\n");
}

export function courseModuleReleaseDeliveryId(input: {
  organizationId: string;
  courseVersionId: string;
  userId: string;
}) {
  const hex = createHash("sha256")
    .update("q-academy:course-module-release:v1\0")
    .update(input.organizationId)
    .update("\0")
    .update(input.courseVersionId)
    .update("\0")
    .update(input.userId)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ["8", "9", "a", "b"][
    Number.parseInt(hex[16] ?? "0", 16) % 4
  ]!;
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

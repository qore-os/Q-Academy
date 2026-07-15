"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import {
  BellRing,
  CalendarClock,
  Eye,
  EyeOff,
  LoaderCircle,
  LayoutTemplate,
  Megaphone,
  Pencil,
  Plus,
  Search,
  Target,
  Trash2,
  MousePointerClick,
  Users,
  X,
} from "lucide-react";
import {
  deleteAnnouncementAction,
  previewAnnouncementAudienceAction,
  saveAnnouncementAction,
  toggleAnnouncementAction,
  type AnnouncementActionState,
} from "@/lib/announcement-actions";
import {
  type AnnouncementTargetRule,
  type AnnouncementTargetRuleSet,
} from "@/lib/announcement-rules";
import { cn, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AnnouncementBlockEditor } from "@/components/admin/announcement-block-editor";
import {
  announcementContentFromLegacy,
  type AnnouncementContentDocument,
} from "@/lib/announcement-content";
import {
  getAnnouncementCopy,
  type AnnouncementCopy,
  type AnnouncementTemplateKey,
} from "@/lib/i18n/announcements";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { useHydrated } from "@/lib/use-hydrated";
import { useModalFocus } from "@/lib/use-modal-focus";

type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  tone: string;
  placement: string;
  audience: string;
  audienceId: string | null;
  targetRuleSet: AnnouncementTargetRuleSet;
  contentDocument: AnnouncementContentDocument;
  href: string | null;
  actionLabel: string | null;
  startsAt: Date;
  endsAt: Date | null;
  dismissible: boolean;
  active: boolean;
  impressionCount: number;
  clickCount: number;
  dismissalCount: number;
  deliveryStatus: "live" | "scheduled" | "ended" | "inactive";
};

type Target = { id: string; label: string };
type RuleTargets = {
  groups: Target[];
  bundles: Target[];
  courses: Target[];
};
const initialState: AnnouncementActionState = {};

function dateTimeLocal(value: Date | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function targetRuleForType(
  type: AnnouncementTargetRule["type"],
  targets: RuleTargets,
): AnnouncementTargetRule {
  switch (type) {
    case "role":
      return { type, role: "member" };
    case "group":
      return { type, groupId: targets.groups[0]?.id ?? "", match: "member" };
    case "bundle":
      return { type, bundleId: targets.bundles[0]?.id ?? "", match: "member" };
    case "course_access":
      return {
        type,
        courseId: targets.courses[0]?.id ?? "",
        access: "granted",
      };
    case "course_progress":
      return {
        type,
        courseId: targets.courses[0]?.id ?? "",
        comparison: "at_least",
        percent: 50,
        maxPercent: null,
      };
  }
}

function TargetRuleEditor({
  index,
  condition,
  targets,
  copy,
  onChange,
  onRemove,
}: {
  index: number;
  condition: AnnouncementTargetRule;
  targets: RuleTargets;
  copy: AnnouncementCopy["targetRules"];
  onChange: (condition: AnnouncementTargetRule) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-2 rounded-md border border-[#dce1e5] bg-white p-3 sm:grid-cols-[minmax(150px,0.8fr)_minmax(180px,1.2fr)_auto] sm:items-center">
      <label className="min-w-0">
        <span className="sr-only">{copy.ruleType(index + 1)}</span>
        <select
          aria-label={copy.ruleType(index + 1)}
          value={condition.type}
          onChange={(event) =>
            onChange(
              targetRuleForType(
                event.target.value as AnnouncementTargetRule["type"],
                targets,
              ),
            )
          }
          className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-xs font-semibold"
        >
          <option value="role">{copy.types.role}</option>
          <option value="group" disabled={!targets.groups.length}>
            {copy.types.group}
          </option>
          <option value="bundle" disabled={!targets.bundles.length}>
            {copy.types.bundle}
          </option>
          <option value="course_access" disabled={!targets.courses.length}>
            {copy.types.courseAccess}
          </option>
          <option value="course_progress" disabled={!targets.courses.length}>
            {copy.types.courseProgress}
          </option>
        </select>
      </label>

      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        {condition.type === "role" ? (
          <select
            aria-label={copy.role(index + 1)}
            value={condition.role}
            onChange={(event) =>
              onChange({
                type: "role",
                role: event.target.value as
                  | "owner"
                  | "admin"
                  | "trainer"
                  | "member",
              })
            }
            className="focus-ring col-span-full h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-xs"
          >
            <option value="member">{copy.roles.member}</option>
            <option value="trainer">{copy.roles.trainer}</option>
            <option value="admin">{copy.roles.admin}</option>
            <option value="owner">{copy.roles.owner}</option>
          </select>
        ) : null}
        {condition.type === "group" ? (
          <>
            <select
              aria-label={copy.group(index + 1)}
              value={condition.groupId}
              onChange={(event) =>
                onChange({ ...condition, groupId: event.target.value })
              }
              className="focus-ring h-10 min-w-0 rounded-md border border-[#dce1e5] bg-white px-3 text-xs"
            >
              {targets.groups.map((target) => (
                <option key={target.id} value={target.id}>{target.label}</option>
              ))}
            </select>
            <select
              aria-label={copy.groupMatch(index + 1)}
              value={condition.match}
              onChange={(event) =>
                onChange({
                  ...condition,
                  match: event.target.value as "member" | "not_member",
                })
              }
              className="focus-ring h-10 min-w-0 rounded-md border border-[#dce1e5] bg-white px-3 text-xs"
            >
              <option value="member">{copy.groupMatches.member}</option>
              <option value="not_member">{copy.groupMatches.notMember}</option>
            </select>
          </>
        ) : null}
        {condition.type === "bundle" ? (
          <>
            <select
              aria-label={copy.bundle(index + 1)}
              value={condition.bundleId}
              onChange={(event) =>
                onChange({ ...condition, bundleId: event.target.value })
              }
              className="focus-ring h-10 min-w-0 rounded-md border border-[#dce1e5] bg-white px-3 text-xs"
            >
              {targets.bundles.map((target) => (
                <option key={target.id} value={target.id}>{target.label}</option>
              ))}
            </select>
            <select
              aria-label={copy.bundleMatch(index + 1)}
              value={condition.match}
              onChange={(event) =>
                onChange({
                  ...condition,
                  match: event.target.value as "member" | "not_member",
                })
              }
              className="focus-ring h-10 min-w-0 rounded-md border border-[#dce1e5] bg-white px-3 text-xs"
            >
              <option value="member">{copy.bundleMatches.member}</option>
              <option value="not_member">{copy.bundleMatches.notMember}</option>
            </select>
          </>
        ) : null}
        {condition.type === "course_access" ? (
          <>
            <select
              aria-label={copy.course(index + 1)}
              value={condition.courseId}
              onChange={(event) =>
                onChange({ ...condition, courseId: event.target.value })
              }
              className="focus-ring h-10 min-w-0 rounded-md border border-[#dce1e5] bg-white px-3 text-xs"
            >
              {targets.courses.map((target) => (
                <option key={target.id} value={target.id}>{target.label}</option>
              ))}
            </select>
            <select
              aria-label={copy.courseAccess(index + 1)}
              value={condition.access}
              onChange={(event) =>
                onChange({
                  ...condition,
                  access: event.target.value as "granted" | "not_granted",
                })
              }
              className="focus-ring h-10 min-w-0 rounded-md border border-[#dce1e5] bg-white px-3 text-xs"
            >
              <option value="granted">{copy.access.granted}</option>
              <option value="not_granted">{copy.access.notGranted}</option>
            </select>
          </>
        ) : null}
        {condition.type === "course_progress" ? (
          <>
            <select
              aria-label={copy.progressCourse(index + 1)}
              value={condition.courseId}
              onChange={(event) =>
                onChange({ ...condition, courseId: event.target.value })
              }
              className="focus-ring h-10 min-w-0 rounded-md border border-[#dce1e5] bg-white px-3 text-xs sm:col-span-2"
            >
              {targets.courses.map((target) => (
                <option key={target.id} value={target.id}>{target.label}</option>
              ))}
            </select>
            <select
              aria-label={copy.progressComparison(index + 1)}
              value={condition.comparison}
              onChange={(event) => {
                const comparison = event.target.value as
                  | "at_least"
                  | "at_most"
                  | "between";
                onChange({
                  ...condition,
                  comparison,
                  maxPercent:
                    comparison === "between"
                      ? (condition.maxPercent ?? condition.percent)
                      : null,
                });
              }}
              className="focus-ring h-10 min-w-0 rounded-md border border-[#dce1e5] bg-white px-3 text-xs"
            >
              <option value="at_least">{copy.comparison.atLeast}</option>
              <option value="at_most">{copy.comparison.atMost}</option>
              <option value="between">{copy.comparison.between}</option>
            </select>
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <input
                type="number"
                min={0}
                max={100}
                aria-label={copy.progressValue(index + 1)}
                value={condition.percent}
                onChange={(event) =>
                  onChange({ ...condition, percent: Number(event.target.value) })
                }
                className="focus-ring h-10 min-w-0 rounded-md border border-[#dce1e5] px-2 text-xs"
              />
              {condition.comparison === "between" ? (
                <input
                  type="number"
                  min={condition.percent}
                  max={100}
                  aria-label={copy.progressMaximum(index + 1)}
                  value={condition.maxPercent ?? condition.percent}
                  onChange={(event) =>
                    onChange({ ...condition, maxPercent: Number(event.target.value) })
                  }
                  className="focus-ring h-10 min-w-0 rounded-md border border-[#dce1e5] px-2 text-xs"
                />
              ) : (
                <span className="grid h-10 place-items-center rounded-md bg-[#f4f6f7] text-xs text-[#73808a]">%</span>
              )}
            </div>
          </>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="focus-ring grid size-9 place-items-center justify-self-end rounded-md text-[#b84e42] hover:bg-[#fdf0ee]"
        aria-label={copy.remove(index + 1)}
        title={copy.removeTitle}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

function AnnouncementEditor({
  announcement,
  users,
  groups,
  bundles,
  courses,
  defaultStartsAt,
  variables,
  locale,
  onClose,
}: {
  announcement: AnnouncementRow | null;
  users: Target[];
  groups: Target[];
  bundles: Target[];
  courses: Target[];
  defaultStartsAt: Date;
  variables: Array<{ token: string; label: string }>;
  locale: AppLocale;
  onClose: () => void;
}) {
  const copy = getAnnouncementCopy(locale);
  const ANNOUNCEMENT_TEMPLATES = copy.templates;
  const [state, action, pending] = useActionState(
    saveAnnouncementAction,
    initialState,
  );
  const [audience, setAudience] = useState(announcement?.audience ?? "all");
  const [audienceId, setAudienceId] = useState(announcement?.audienceId ?? "");
  const [conditions, setConditions] = useState<AnnouncementTargetRule[]>(
    announcement?.targetRuleSet.conditions ?? [],
  );
  const [title, setTitle] = useState(announcement?.title ?? "");
  const [contentDocument, setContentDocument] = useState(
    announcement?.contentDocument ??
      announcementContentFromLegacy({ body: copy.blocks.defaults.richText }),
  );
  const [placement, setPlacement] = useState(
    announcement?.placement ?? "banner",
  );
  const [tone, setTone] = useState(announcement?.tone ?? "info");
  const [templateKey, setTemplateKey] =
    useState<AnnouncementTemplateKey>("welcome");
  const [preview, setPreview] = useState<
    | { count: number; sample: Array<{ id: string; label: string; role: string }> }
    | { error: string }
    | null
  >(null);
  const [previewPending, startPreviewTransition] = useTransition();
  const dialogRef = useModalFocus<HTMLDivElement>({
    open: true,
    onClose,
    closeDisabled: pending,
  });
  const targets =
    audience === "user" ? users : audience === "group" ? groups : [];
  const ruleTargets = { groups, bundles, courses };
  const targetRuleSet: AnnouncementTargetRuleSet = {
    version: 1,
    conjunction: "and",
    conditions,
  };

  const updateCondition = (index: number, condition: AnnouncementTargetRule) => {
    setConditions((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? condition : entry,
      ),
    );
    setPreview(null);
  };

  const addCondition = () => {
    setConditions((current) => [
      ...current,
      { type: "role", role: "member" },
    ]);
    setPreview(null);
  };

  const calculatePreview = () => {
    startPreviewTransition(async () => {
      const result = await previewAnnouncementAudienceAction({
        locale,
        audience,
        audienceId: audience === "all" ? null : audienceId || null,
        targetRuleSet,
      });
      setPreview(
        result.ok
          ? { count: result.count, sample: result.sample }
          : { error: result.error },
      );
    });
  };

  const applyTemplate = () => {
    const template = ANNOUNCEMENT_TEMPLATES[templateKey];
    setTitle(template.title);
    const document = announcementContentFromLegacy(template);
    setContentDocument({
      ...document,
      blocks: document.blocks.map((block) => ({
        ...block,
        id: crypto.randomUUID(),
      })),
    });
    setPlacement(template.placement);
    setTone(template.tone);
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[80] grid place-items-center bg-[#0f263c]/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-editor-title"
    >
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-md bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e5e9ec] bg-white px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase text-[#2b9188]">
              {copy.editor.eyebrow}
            </p>
            <h2
              id="announcement-editor-title"
              className="mt-1 text-lg font-bold text-[#243444]"
            >
              {announcement ? copy.editor.editTitle : copy.editor.createTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring grid size-9 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3]"
            aria-label={copy.editor.close}
          >
            <X className="size-5" />
          </button>
        </div>

        <form action={action} className="space-y-5 p-5">
          {announcement ? (
            <input type="hidden" name="id" value={announcement.id} />
          ) : null}
          <input type="hidden" name="locale" value={locale} />
          <input
            type="hidden"
            name="targetRuleSet"
            value={JSON.stringify(targetRuleSet)}
          />
          <section className="rounded-md border border-[#dfe4e8] bg-[#f7f9fa] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1">
                <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#52606d]">
                  <LayoutTemplate className="size-3.5" /> {copy.editor.template}
                </span>
                <select
                  value={templateKey}
                  onChange={(event) =>
                    setTemplateKey(
                      event.target.value as AnnouncementTemplateKey,
                    )
                  }
                  className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
                  aria-label={copy.editor.templateAria}
                >
                  {Object.entries(ANNOUNCEMENT_TEMPLATES).map(
                    ([key, template]) => (
                      <option key={key} value={key}>
                        {template.label}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <Button type="button" variant="secondary" onClick={applyTemplate}>
                <LayoutTemplate className="size-4" />
                {copy.editor.applyTemplate}
              </Button>
            </div>
          </section>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="md:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.editor.title}
              </span>
              <input
                name="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
                required
                maxLength={180}
              />
            </label>
            <div className="md:col-span-2">
              <AnnouncementBlockEditor
                value={contentDocument}
                onChange={setContentDocument}
                variables={variables}
                locale={locale}
              />
            </div>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.editor.placement}
              </span>
              <select
                name="placement"
                value={placement}
                onChange={(event) => setPlacement(event.target.value)}
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
              >
                <option value="banner">{copy.placement.bannerDescription}</option>
                <option value="modal">{copy.placement.modalDescription}</option>
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.editor.tone}
              </span>
              <select
                name="tone"
                value={tone}
                onChange={(event) => setTone(event.target.value)}
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
              >
                <option value="info">{copy.tone.info}</option>
                <option value="success">{copy.tone.success}</option>
                <option value="warning">{copy.tone.warning}</option>
                <option value="critical">{copy.tone.critical}</option>
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.editor.audience}
              </span>
              <select
                name="audience"
                value={audience}
                onChange={(event) => {
                  setAudience(event.target.value);
                  setAudienceId("");
                  setPreview(null);
                }}
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
              >
                <option value="all">{copy.audience.all}</option>
                <option value="group">{copy.audience.group}</option>
                <option value="user">{copy.audience.user}</option>
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.editor.recipient}
              </span>
              <select
                name="audienceId"
                value={audienceId}
                onChange={(event) => {
                  setAudienceId(event.target.value);
                  setPreview(null);
                }}
                disabled={audience === "all"}
                required={audience !== "all"}
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm disabled:bg-[#f1f3f5]"
              >
                <option value="">
                  {audience === "all"
                    ? copy.editor.allRecipients
                    : copy.editor.selectRecipient}
                </option>
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.editor.start}
              </span>
              <input
                type="datetime-local"
                name="startsAt"
                defaultValue={dateTimeLocal(
                  announcement?.startsAt ?? defaultStartsAt,
                )}
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
                required
              />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                {copy.editor.endOptional}
              </span>
              <input
                type="datetime-local"
                name="endsAt"
                defaultValue={dateTimeLocal(announcement?.endsAt ?? null)}
                className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
              />
            </label>
          </div>

          <section className="border-y border-[#e5e9ec] py-5" aria-labelledby="target-rules-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 id="target-rules-title" className="text-sm font-bold text-[#2b3a48]">
                  {copy.targetRules.title}
                </h3>
                <div className="mt-1 flex items-center gap-2 text-[10px] font-semibold text-[#73808a]">
                  <span className="rounded bg-[#edf1f3] px-1.5 py-0.5">{copy.targetRules.conjunction}</span>
                  <span>
                    {copy.targetRules.conditions(
                      new Intl.NumberFormat(intlLocale(locale)).format(
                        conditions.length,
                      ),
                    )}
                  </span>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={addCondition}
                disabled={conditions.length >= 20}
              >
                <Plus className="size-4" />
                {copy.targetRules.add}
              </Button>
            </div>
            <div className="mt-4 space-y-2">
              {conditions.map((condition, index) => (
                <TargetRuleEditor
                  key={`${index}-${condition.type}`}
                  index={index}
                  condition={condition}
                  targets={ruleTargets}
                  copy={copy.targetRules}
                  onChange={(next) => updateCondition(index, next)}
                  onRemove={() => {
                    setConditions((current) =>
                      current.filter((_, entryIndex) => entryIndex !== index),
                    );
                    setPreview(null);
                  }}
                />
              ))}
              {!conditions.length ? (
                <div className="rounded-md border border-dashed border-[#ccd4da] px-4 py-5 text-center text-xs text-[#73808a]">
                  {copy.targetRules.empty}
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex flex-col gap-3 rounded-md bg-[#f4f7f8] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0" aria-live="polite">
                {preview && "error" in preview ? (
                  <p className="text-xs font-semibold text-[#a94339]">{preview.error}</p>
                ) : preview ? (
                  <>
                    <p className="text-sm font-bold text-[#243444]">
                      {copy.targetRules.matchingMembers(
                        new Intl.NumberFormat(intlLocale(locale)).format(
                          preview.count,
                        ),
                      )}
                    </p>
                    <p className="truncate text-[10px] text-[#73808a]">
                      {preview.sample.map((member) => member.label).join(", ") ||
                        copy.targetRules.noMatches}
                    </p>
                  </>
                ) : (
                  <p className="text-xs font-semibold text-[#73808a]">{copy.targetRules.previewTitle}</p>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={calculatePreview}
                disabled={previewPending}
              >
                {previewPending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Target className="size-4" />
                )}
                {previewPending
                  ? copy.targetRules.calculating
                  : copy.targetRules.calculate}
              </Button>
            </div>
          </section>

          <div className="flex flex-wrap gap-5 py-1">
            <label className="flex items-center gap-2 text-xs font-semibold text-[#52606d]">
              <input
                type="checkbox"
                name="active"
                defaultChecked={announcement?.active ?? true}
                className="size-4 accent-[#2b9188]"
              />
              {copy.editor.active}
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-[#52606d]">
              <input
                type="checkbox"
                name="dismissible"
                defaultChecked={announcement?.dismissible ?? true}
                className="size-4 accent-[#2b9188]"
              />
              {copy.editor.dismissible}
            </label>
          </div>

          {state.error ? (
            <p className="rounded-md bg-[#fdf0ee] p-3 text-xs text-[#a94339]">
              {state.error}
            </p>
          ) : null}
          {state.success ? (
            <p className="rounded-md bg-[#e9f8f6] p-3 text-xs text-[#167e74]">
              {state.success}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {copy.editor.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Megaphone className="size-4" />
              )}
              {pending ? copy.editor.saving : copy.editor.save}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AnnouncementManager({
  announcements,
  users,
  groups,
  bundles,
  courses,
  defaultStartsAt,
  variables,
  locale,
}: {
  announcements: AnnouncementRow[];
  users: Target[];
  groups: Target[];
  bundles: Target[];
  courses: Target[];
  defaultStartsAt: Date;
  variables: Array<{ token: string; label: string }>;
  locale: AppLocale;
}) {
  const copy = getAnnouncementCopy(locale);
  const hydrated = useHydrated();
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(intlLocale(locale)),
    [locale],
  );
  const percentFormatter = useMemo(
    () =>
      new Intl.NumberFormat(intlLocale(locale), {
        style: "percent",
        maximumFractionDigits: 0,
      }),
    [locale],
  );
  const [editor, setEditor] = useState<AnnouncementRow | null | undefined>();
  const [query, setQuery] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(intlLocale(locale));
    if (!normalized) return announcements;
    return announcements.filter((entry) =>
      `${entry.title} ${entry.body}`
        .toLocaleLowerCase(intlLocale(locale))
        .includes(normalized),
    );
  }, [announcements, locale, query]);

  return (
    <>
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#e8ebee] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#87929b]" />
            <input
              value={query}
              disabled={!hydrated}
              onChange={(event) => setQuery(event.target.value)}
              className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-[#f8f9fa] pl-9 pr-3 text-sm"
              placeholder={copy.manager.search}
              aria-label={copy.manager.search}
            />
          </div>
          <Button disabled={!hydrated} onClick={() => setEditor(null)}>
            <Plus className="size-4" />
            {copy.manager.create}
          </Button>
        </div>

        <div className="divide-y divide-[#edf0f2]">
          {filtered.map((announcement) => {
            const toggle = toggleAnnouncementAction.bind(null, announcement.id);
            const remove = deleteAnnouncementAction.bind(null, announcement.id);
            return (
              <article
                key={announcement.id}
                className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        announcement.tone === "critical" && "bg-[#d65345]",
                        announcement.tone === "warning" && "bg-[#d6a536]",
                        announcement.tone === "success" && "bg-[#2b9188]",
                        announcement.tone === "info" && "bg-[#4f7cac]",
                      )}
                    />
                    <h2 className="truncate text-sm font-bold text-[#2b3a48]">
                      {announcement.title}
                    </h2>
                    <Badge
                      tone={
                        announcement.deliveryStatus === "live"
                          ? "teal"
                          : announcement.deliveryStatus === "ended"
                            ? "neutral"
                            : "amber"
                      }
                    >
                      {copy.status[announcement.deliveryStatus]}
                    </Badge>
                    <Badge tone="neutral">
                      {announcement.placement === "modal"
                        ? copy.placement.modal
                        : copy.placement.banner}
                    </Badge>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[#687580]">
                    {announcement.body}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[#87919a]">
                    <span className="flex items-center gap-1">
                      <CalendarClock className="size-3" />
                      {formatDateTime(announcement.startsAt, locale)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="size-3" />
                      {announcement.audience === "all"
                        ? copy.audience.all
                        : announcement.audience === "group"
                          ? copy.audience.groupShort
                          : copy.audience.userShort}
                    </span>
                    <span
                      className="flex items-center gap-1"
                      title={copy.metrics.impressions}
                      aria-label={copy.metrics.impressionsAria(
                        numberFormatter.format(announcement.impressionCount),
                      )}
                    >
                      <Eye className="size-3" />
                      {numberFormatter.format(announcement.impressionCount)}
                    </span>
                    <span
                      className="flex items-center gap-1"
                      title={copy.metrics.clicks}
                      aria-label={copy.metrics.clicksAria(
                        numberFormatter.format(announcement.clickCount),
                      )}
                    >
                      <MousePointerClick className="size-3" />
                      {numberFormatter.format(announcement.clickCount)}
                    </span>
                    <span
                      className="flex items-center gap-1"
                      title={copy.metrics.dismissals}
                      aria-label={copy.metrics.dismissalsAria(
                        numberFormatter.format(announcement.dismissalCount),
                      )}
                    >
                      <X className="size-3" />
                      {numberFormatter.format(announcement.dismissalCount)}
                    </span>
                    <span>
                      {copy.metrics.clickRate(
                        percentFormatter.format(
                          announcement.impressionCount
                            ? announcement.clickCount /
                                announcement.impressionCount
                            : 0,
                        ),
                      )}
                    </span>
                    <span>
                      {copy.metrics.rules(
                        numberFormatter.format(
                          announcement.targetRuleSet.conditions.length,
                        ),
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1">
                  {deleteId === announcement.id ? (
                    <>
                      <span className="mr-1 text-[10px] font-semibold text-[#a94339]">
                        {copy.manager.confirmDelete}
                      </span>
                      <form action={remove}>
                        <button
                          type="submit"
                          className="focus-ring rounded-md bg-[#b84e42] px-2.5 py-2 text-[10px] font-bold text-white"
                        >
                          {copy.manager.delete}
                        </button>
                      </form>
                      <button
                        type="button"
                        disabled={!hydrated}
                        onClick={() => setDeleteId(null)}
                        className="focus-ring rounded-md px-2.5 py-2 text-[10px] font-bold text-[#66727f] hover:bg-[#edf1f3]"
                      >
                        {copy.manager.cancel}
                      </button>
                    </>
                  ) : (
                    <>
                      <form action={toggle}>
                        <button
                          type="submit"
                          className="focus-ring grid size-9 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3]"
                          aria-label={
                            announcement.active
                              ? copy.manager.deactivate
                              : copy.manager.activate
                          }
                          title={
                            announcement.active
                              ? copy.manager.deactivate
                              : copy.manager.activate
                          }
                        >
                          {announcement.active ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </button>
                      </form>
                      <button
                        type="button"
                        disabled={!hydrated}
                        onClick={() => setEditor(announcement)}
                        className="focus-ring grid size-9 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3]"
                        aria-label={copy.manager.editAnnouncement}
                        title={copy.manager.edit}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        disabled={!hydrated}
                        onClick={() => setDeleteId(announcement.id)}
                        className="focus-ring grid size-9 place-items-center rounded-md text-[#b84e42] hover:bg-[#fdf0ee]"
                        aria-label={copy.manager.deleteAnnouncement}
                        title={copy.manager.delete}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
          {!filtered.length ? (
            <div className="px-5 py-14 text-center">
              <BellRing className="mx-auto size-6 text-[#93a0a9]" />
              <p className="mt-3 text-sm font-semibold text-[#52606d]">
                {copy.manager.empty}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {editor !== undefined ? (
        <AnnouncementEditor
          key={editor?.id ?? "new"}
          announcement={editor}
          users={users}
          groups={groups}
          bundles={bundles}
          courses={courses}
          defaultStartsAt={defaultStartsAt}
          variables={variables}
          locale={locale}
          onClose={() => setEditor(undefined)}
        />
      ) : null}
    </>
  );
}

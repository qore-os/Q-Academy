"use client";

import {
  Bot,
  CircleGauge,
  Globe2,
  History,
  LoaderCircle,
  MessageSquareCode,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  RotateCcw,
  Route,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  WandSparkles,
  X,
} from "lucide-react";
import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  deleteAiAgentAdminAction,
  toggleAiAgentAdminAction,
} from "@/lib/admin/ai-agent-actions";
import {
  previewAiAgentDraftAsMemberAdminAction,
  publishAiAgentDraftAdminAction,
  rollbackAiAgentVersionAdminAction,
  updateAiAgentDraftAdminAction,
  type AiAgentDraftPreviewActionState,
  type AiAgentStudioActionState,
} from "@/lib/admin/ai-agent-studio-actions";
import {
  formatAiAdminDateTime,
  localizeAiAdminMessage,
} from "@/lib/i18n/ai-admin";
import {
  getAiManagerCopy,
  type AiManagerCopy,
} from "@/lib/i18n/ai-manager";
import type { AppLocale } from "@/lib/i18n/model";
import { cn } from "@/lib/utils";

type AgentType =
  | "learning_coach"
  | "knowledge_assistant"
  | "form_assistant";
type KnowledgeMode = "all_accessible_courses" | "selected_sources";
type AccessMode = "open" | "restricted";
type UserRole = "owner" | "admin" | "trainer" | "member";

export type AiAgentStudioVersion = {
  id: string;
  version: number;
  draftRevision: number;
  state: "draft" | "published";
  type: AgentType;
  name: string;
  description: string;
  systemPrompt: string;
  color: string;
  icon: string;
  knowledgeMode: KnowledgeMode;
  accessMode: AccessMode;
  profileFieldIds: string[];
  additionalPrompts: Array<{ label: string; prompt: string }>;
  publishedAt: Date | null;
  updatedAt: Date;
};

export type AiAgentStudioSource = {
  id: string;
  sourceType: "course_version" | "manual_text" | "media_asset" | "web_url";
  courseId: string | null;
  mediaAssetId: string | null;
  title: string | null;
  content: string | null;
  sourceUrl: string | null;
  contentDigest: string | null;
  fetchedAt: Date | null;
};

export type AiAgentStudioGrant = {
  id: string;
  subjectType: "role" | "user" | "group" | "bundle";
  subjectRole: UserRole | null;
  subjectUserId: string | null;
  subjectGroupId: string | null;
  subjectBundleId: string | null;
};

export type AiAgentStudioAction = {
  id: string;
  actionType:
    | "course_enrollment"
    | "course_unenrollment"
    | "group_membership_add"
    | "group_membership_remove"
    | "bundle_assignment_add"
    | "bundle_assignment_remove";
  targetType: "course" | "group" | "bundle";
  courseId: string | null;
  groupId: string | null;
  bundleId: string | null;
  label: string;
  description: string;
};

export type AiAgentStudioOptions = {
  courses: Array<{
    id: string;
    title: string;
    publishedVersionId: string | null;
  }>;
  users: Array<{ id: string; label: string }>;
  groups: Array<{ id: string; name: string }>;
  bundles: Array<{ id: string; name: string }>;
  mediaAssets: Array<{ id: string; fileName: string; kind: string }>;
  profileFields: Array<{
    id: string;
    label: string;
    category: string;
    type: string;
  }>;
};

export type AiAgentManagementRow = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  systemPrompt: string;
  color: string;
  icon: string;
  active: boolean;
  draftVersionId: string;
  publishedVersionId: string | null;
  createdAt: Date;
  draft: AiAgentStudioVersion;
  published: AiAgentStudioVersion | null;
  history: AiAgentStudioVersion[];
  draftSources: AiAgentStudioSource[];
  draftAccessGrants: AiAgentStudioGrant[];
  draftActions: AiAgentStudioAction[];
  conversationCount: number;
  messageCount: number;
  memberCount: number;
  lastMessageAt: Date | null;
};

const initialState: AiAgentStudioActionState = { ok: null, message: "" };
const inputClassName =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#2b3a48]";
const textareaClassName =
  "focus-ring w-full resize-y rounded-md border border-[#dce1e5] bg-white p-3 text-sm text-[#2b3a48]";
const labelClassName = "mb-1.5 block text-xs font-semibold text-[#52606d]";
const optionClassName =
  "flex min-w-0 cursor-pointer items-start gap-2.5 border-b border-[#edf0f2] px-3 py-2.5 last:border-b-0";

const AiManagerI18nContext = createContext<{
  locale: AppLocale;
  copy: AiManagerCopy;
} | null>(null);

function useAiManagerI18n() {
  const context = useContext(AiManagerI18nContext);
  if (!context) {
    throw new Error("AiAgentManager locale context is missing");
  }
  return context;
}

function iconOptions(copy: AiManagerCopy) {
  return [
    { value: "sparkles", label: copy.icons.sparkles },
    { value: "message-square-code", label: copy.icons.promptReview },
    { value: "route", label: copy.icons.learningPath },
    { value: "wand", label: copy.icons.wand },
    { value: "bot", label: copy.icons.bot },
  ] as const;
}

function agentTypeLabels(copy: AiManagerCopy): Record<AgentType, string> {
  return {
    learning_coach: copy.agentTypes.learningCoach,
    knowledge_assistant: copy.agentTypes.knowledgeAssistant,
    form_assistant: copy.agentTypes.formAssistant,
  };
}

function knowledgeModeLabels(
  copy: AiManagerCopy,
): Record<KnowledgeMode, string> {
  return {
    all_accessible_courses: copy.knowledgeModes.allCourses,
    selected_sources: copy.knowledgeModes.selectedSources,
  };
}

function accessModeLabels(copy: AiManagerCopy): Record<AccessMode, string> {
  return {
    open: copy.accessModes.open,
    restricted: copy.accessModes.restricted,
  };
}

function roleOptions(copy: AiManagerCopy): Array<{
  value: UserRole;
  label: string;
}> {
  return [
    { value: "owner", label: copy.roles.owner },
    { value: "admin", label: copy.roles.admin },
    { value: "trainer", label: copy.roles.trainer },
    { value: "member", label: copy.roles.member },
  ];
}

function AgentIcon({ value, className }: { value: string; className: string }) {
  if (value === "sparkles") return <Sparkles className={className} />;
  if (value === "message-square-code") {
    return <MessageSquareCode className={className} />;
  }
  if (value === "route") return <Route className={className} />;
  if (value === "wand") return <WandSparkles className={className} />;
  return <Bot className={className} />;
}

function AgentMark({
  agent,
  size = "md",
}: {
  agent: AiAgentManagementRow;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-md text-white",
        size === "sm" ? "size-9" : "size-11",
      )}
      style={{ backgroundColor: agent.draft.color }}
      aria-hidden="true"
    >
      <AgentIcon
        value={agent.draft.icon}
        className={size === "sm" ? "size-4" : "size-5"}
      />
    </span>
  );
}

function LiveStatus({ agent }: { agent: AiAgentManagementRow }) {
  const { copy } = useAiManagerI18n();
  if (!agent.published) {
    return <Badge tone="amber">{copy.common.draftOnly}</Badge>;
  }
  return (
    <Badge tone={agent.active ? "teal" : "neutral"}>
      <span
        className={cn(
          "mr-1 size-1.5 rounded-full",
          agent.active ? "bg-[#2b9188]" : "bg-[#8d98a1]",
        )}
      />
      {agent.active ? copy.common.liveActive : copy.common.livePaused}
    </Badge>
  );
}

function useDialogLifecycle(onClose: () => void, pending: boolean) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, pending]);
}

function DialogBackdrop({
  onClose,
  pending,
}: {
  onClose: () => void;
  pending: boolean;
}) {
  const { copy } = useAiManagerI18n();
  return (
    <button
      type="button"
      className="absolute inset-0 bg-[#0f263c]/55 backdrop-blur-[1px] disabled:cursor-wait"
      onClick={onClose}
      disabled={pending}
      aria-label={copy.common.dialogClose}
    />
  );
}

function CheckOption({
  name,
  value,
  label,
  detail,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  detail?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className={optionClassName}>
      <input
        name={name}
        value={value}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 shrink-0 accent-[#2b9188]"
      />
      <span className="min-w-0">
        <span className="block break-words text-xs font-semibold text-[#354555]">
          {label}
        </span>
        {detail ? (
          <span className="mt-0.5 block break-words text-[10px] text-[#7a8690]">
            {detail}
          </span>
        ) : null}
      </span>
    </label>
  );
}

type AssignmentActionType =
  | "group_membership_add"
  | "group_membership_remove"
  | "bundle_assignment_add"
  | "bundle_assignment_remove";

function AssignmentActionSelector({
  title,
  emptyLabel,
  fieldName,
  actionType,
  items,
  selectedIds,
  copyById,
  onToggle,
  onCopyChange,
}: {
  title: string;
  emptyLabel: string;
  fieldName: string;
  actionType: AssignmentActionType;
  items: Array<{ id: string; name: string }>;
  selectedIds: Set<string>;
  copyById: Record<string, { label: string; description: string }>;
  onToggle: (item: { id: string; name: string }) => void;
  onCopyChange: (
    id: string,
    field: "label" | "description",
    value: string,
  ) => void;
}) {
  const { copy } = useAiManagerI18n();
  return (
    <div>
      <h4 className="mb-2 text-xs font-bold text-[#52606d]">{title}</h4>
      <div className="grid gap-0 overflow-hidden rounded-md border border-[#e1e5e8]">
        {items.map((item) => {
          const selected = selectedIds.has(item.id);
          const actionText = copyById[item.id];
          return (
            <div
              key={item.id}
              className="border-b border-[#edf0f2] last:border-b-0"
            >
              <label className={optionClassName}>
                <input
                  name={fieldName}
                  value={item.id}
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggle(item)}
                  className="mt-0.5 size-4 shrink-0 accent-[#2b9188]"
                />
                <span className="min-w-0 break-words text-xs font-semibold text-[#354555]">
                  {item.name}
                </span>
              </label>
              {selected && actionText ? (
                <div className="grid gap-3 bg-[#f8f9fa] px-3 py-3 sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
                  <label>
                    <span className={labelClassName}>{copy.common.label}</span>
                    <input
                      name={`actionLabel:${actionType}:${item.id}`}
                      value={actionText.label}
                      onChange={(event) =>
                        onCopyChange(item.id, "label", event.target.value)
                      }
                      required
                      minLength={2}
                      maxLength={120}
                      className={inputClassName}
                    />
                  </label>
                  <label>
                    <span className={labelClassName}>
                      {copy.common.description}
                    </span>
                    <input
                      name={`actionDescription:${actionType}:${item.id}`}
                      value={actionText.description}
                      onChange={(event) =>
                        onCopyChange(item.id, "description", event.target.value)
                      }
                      required
                      minLength={3}
                      maxLength={500}
                      className={inputClassName}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          );
        })}
        {!items.length ? (
          <p className="p-3 text-xs text-[#7a8690]">{emptyLabel}</p>
        ) : null}
      </div>
    </div>
  );
}

type ManualSourceState = {
  key: string;
  title: string;
  content: string;
};

type WebSourceState = {
  key: string;
  url: string;
  title: string;
  content: string;
  contentDigest: string;
  fetchedAt: Date | null;
};

type AdditionalPromptState = {
  key: string;
  label: string;
  prompt: string;
};

function useAssignmentActionConfiguration(
  actions: AiAgentStudioAction[],
  actionType: AssignmentActionType,
  defaults: (name: string) => { label: string; description: string },
) {
  const configured = actions.filter((action) => action.actionType === actionType);
  const targetId = (action: AiAgentStudioAction) =>
    action.targetType === "group" ? action.groupId : action.bundleId;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(configured.flatMap((action) => targetId(action) ?? [])),
  );
  const [copyById, setCopyById] = useState<
    Record<string, { label: string; description: string }>
  >(() =>
    Object.fromEntries(
      configured.flatMap((action) => {
        const id = targetId(action);
        return id
          ? [[id, { label: action.label, description: action.description }]]
          : [];
      }),
    ),
  );
  const toggle = (item: { id: string; name: string }) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    setCopyById((current) => ({
      ...current,
      [item.id]: current[item.id] ?? defaults(item.name),
    }));
  };
  const updateCopy = (
    id: string,
    field: "label" | "description",
    value: string,
  ) => {
    setCopyById((current) => ({
      ...current,
      [id]: { ...current[id]!, [field]: value },
    }));
  };
  return { selectedIds, copyById, toggle, updateCopy };
}

function DraftMemberPreview({
  agent,
  members,
  disabled,
}: {
  agent: AiAgentManagementRow;
  members: AiAgentStudioOptions["users"];
  disabled: boolean;
}) {
  const { copy, locale } = useAiManagerI18n();
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [message, setMessage] = useState(copy.preview.defaultQuestion);
  const [result, setResult] =
    useState<AiAgentDraftPreviewActionState | null>(null);
  const [pending, startTransition] = useTransition();

  function runPreview() {
    if (!memberId || !message.trim()) return;
    setResult(null);
    startTransition(async () => {
      const nextResult = await previewAiAgentDraftAsMemberAdminAction({
        agentId: agent.id,
        expectedDraftVersionId: agent.draft.id,
        expectedDraftRevision: agent.draft.draftRevision,
        memberId,
        message,
      });
      setResult(nextResult);
      if (!nextResult.ok) {
        toast.error(localizeAiAdminMessage(locale, nextResult));
      }
    });
  }

  const preview = result?.ok ? result.preview : null;
  return (
    <section
      className="grid gap-4 border-b border-[#e8ebee] p-4 sm:p-5"
      aria-labelledby="draft-member-preview-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3
            id="draft-member-preview-title"
            className="text-sm font-bold text-[#2b3a48]"
          >
            {copy.preview.title}
          </h3>
          <p className="mt-1 text-xs text-[#71808b]">
            {copy.preview.draftMeta(
              agent.draft.version,
              agent.draft.draftRevision,
            )}
          </p>
        </div>
        {preview ? (
          <Badge tone={preview.allowed ? "teal" : "coral"}>
            {preview.allowed ? copy.preview.allowed : copy.preview.denied}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)_auto] md:items-end">
        <label>
          <span className={labelClassName}>{copy.preview.member}</span>
          <select
            value={memberId}
            onChange={(event) => {
              setMemberId(event.target.value);
              setResult(null);
            }}
            className={inputClassName}
            disabled={disabled || pending || members.length === 0}
          >
            {members.length === 0 ? (
              <option value="">{copy.preview.noMembers}</option>
            ) : null}
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelClassName}>{copy.preview.testQuestion}</span>
          <input
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              setResult(null);
            }}
            maxLength={600}
            className={inputClassName}
            disabled={disabled || pending}
          />
        </label>
        <Button
          type="button"
          onClick={runPreview}
          disabled={
            disabled || pending || !memberId || message.trim().length === 0
          }
          className="md:min-w-32"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <PlayCircle className="size-4" />
          )}
          {pending ? copy.preview.checking : copy.preview.run}
        </Button>
      </div>

      <div aria-live="polite">
        {result && !result.ok ? (
          <p
            className="rounded-md border border-[#f4c8c2] bg-[#fdf0ee] p-3 text-xs text-[#a94339]"
            role="alert"
          >
            {localizeAiAdminMessage(locale, result)}
          </p>
        ) : null}
        {preview ? (
          <div className="grid gap-3">
            <p
              className={cn(
                "rounded-md border p-3 text-xs font-medium",
                preview.allowed
                  ? "border-[#cde7df] bg-[#f0f8f5] text-[#25746c]"
                  : "border-[#f4c8c2] bg-[#fdf0ee] text-[#a94339]",
              )}
            >
              {preview.message}
            </p>
            {preview.allowed ? (
              <>
                <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[#e1e5e8] bg-[#e1e5e8] sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    [copy.preview.courses, preview.coverage.courseCount],
                    [copy.preview.manual, preview.coverage.manualSourceCount],
                    [copy.preview.media, preview.coverage.mediaSourceCount],
                    [copy.preview.web, preview.coverage.webSourceCount],
                    [copy.preview.references, preview.coverage.referenceCount],
                    [
                      copy.preview.unavailable,
                      preview.coverage.unavailableSourceCount,
                    ],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0 bg-white p-2.5">
                      <dt className="truncate text-[10px] font-semibold text-[#71808b]">
                        {label}
                      </dt>
                      <dd className="mt-1 text-sm font-bold text-[#2b3a48]">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                {preview.answer ? (
                  <div className="border-l-2 border-[#2b9188] py-1 pl-3">
                    <p className="break-words whitespace-pre-wrap text-sm leading-6 text-[#354555] [overflow-wrap:anywhere]">
                      {preview.answer}
                    </p>
                  </div>
                ) : null}
                {preview.suggestions.length ? (
                  <div className="flex flex-wrap gap-2">
                    {preview.suggestions.map((suggestion) => (
                      <Button
                        key={suggestion}
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setMessage(suggestion);
                          setResult(null);
                        }}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function EditAgentDialog({
  agent,
  options,
  onClose,
  onRollback,
}: {
  agent: AiAgentManagementRow;
  options: AiAgentStudioOptions;
  onClose: () => void;
  onRollback: (version: AiAgentStudioVersion) => void;
}) {
  const { copy, locale } = useAiManagerI18n();
  const localizedIconOptions = iconOptions(copy);
  const localizedAgentTypeLabels = agentTypeLabels(copy);
  const localizedKnowledgeModeLabels = knowledgeModeLabels(copy);
  const localizedAccessModeLabels = accessModeLabels(copy);
  const localizedRoleOptions = roleOptions(copy);
  const updateAction = updateAiAgentDraftAdminAction.bind(null, agent.id);
  const [state, action, pending] = useActionState(updateAction, initialState);
  const [knowledgeMode, setKnowledgeMode] = useState<KnowledgeMode>(
    agent.draft.knowledgeMode,
  );
  const [accessMode, setAccessMode] = useState<AccessMode>(
    agent.draft.accessMode,
  );
  const manualKey = useRef(0);
  const webKey = useRef(0);
  const promptKey = useRef(0);
  const [additionalPrompts, setAdditionalPrompts] = useState<
    AdditionalPromptState[]
  >(() =>
    agent.draft.additionalPrompts.map((prompt, index) => ({
      key: `stored-prompt-${index}`,
      ...prompt,
    })),
  );
  const [manualSources, setManualSources] = useState<ManualSourceState[]>(() =>
    agent.draftSources
      .filter((source) => source.sourceType === "manual_text")
      .map((source) => ({
        key: source.id,
        title: source.title ?? "",
        content: source.content ?? "",
      })),
  );
  const [webSources, setWebSources] = useState<WebSourceState[]>(() =>
    agent.draftSources
      .filter(
        (source) => source.sourceType === "web_url" && source.sourceUrl,
      )
      .map((source) => ({
        key: source.id,
        url: source.sourceUrl ?? "",
        title: source.title ?? "",
        content: source.content ?? "",
        contentDigest: source.contentDigest ?? "",
        fetchedAt: source.fetchedAt,
      })),
  );
  const initialMediaSources = useMemo(
    () =>
      agent.draftSources.filter(
        (source) => source.sourceType === "media_asset" && source.mediaAssetId,
      ),
    [agent.draftSources],
  );
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(
    () => new Set(initialMediaSources.map((source) => source.mediaAssetId!)),
  );
  const [selectedActionCourseIds, setSelectedActionCourseIds] = useState<
    Set<string>
  >(
    () =>
      new Set(
        agent.draftActions
          .filter((item) => item.actionType === "course_enrollment")
          .flatMap((item) => item.courseId ?? []),
      ),
  );
  const [actionCopy, setActionCopy] = useState<
    Record<string, { label: string; description: string }>
  >(() =>
    Object.fromEntries(
      agent.draftActions
        .filter((item) => item.actionType === "course_enrollment")
        .flatMap((item) =>
          item.courseId
            ? [
                [
                  item.courseId,
                  { label: item.label, description: item.description },
                ],
              ]
            : [],
        ),
    ),
  );
  const [selectedUnenrollmentCourseIds, setSelectedUnenrollmentCourseIds] =
    useState<Set<string>>(
      () =>
        new Set(
          agent.draftActions
            .filter((item) => item.actionType === "course_unenrollment")
            .flatMap((item) => item.courseId ?? []),
        ),
    );
  const [unenrollmentActionCopy, setUnenrollmentActionCopy] = useState<
    Record<string, { label: string; description: string }>
  >(() =>
    Object.fromEntries(
      agent.draftActions
        .filter((item) => item.actionType === "course_unenrollment")
        .flatMap((item) =>
          item.courseId
            ? [
                [
                  item.courseId,
                  { label: item.label, description: item.description },
                ],
              ]
            : [],
        ),
    ),
  );
  const groupAssignment = useAssignmentActionConfiguration(
    agent.draftActions,
    "group_membership_add",
    (name) => ({
      label: copy.editor.joinGroupLabel(name),
      description: copy.editor.joinGroupDescription,
    }),
  );
  const groupRemoval = useAssignmentActionConfiguration(
    agent.draftActions,
    "group_membership_remove",
    (name) => ({
      label: copy.editor.leaveGroupLabel(name),
      description: copy.editor.leaveGroupDescription,
    }),
  );
  const bundleAssignment = useAssignmentActionConfiguration(
    agent.draftActions,
    "bundle_assignment_add",
    (name) => ({
      label: copy.editor.assignBundleLabel(name),
      description: copy.editor.assignBundleDescription,
    }),
  );
  const bundleRemoval = useAssignmentActionConfiguration(
    agent.draftActions,
    "bundle_assignment_remove",
    (name) => ({
      label: copy.editor.removeBundleLabel(name),
      description: copy.editor.removeBundleDescription,
    }),
  );
  useDialogLifecycle(onClose, pending);

  useEffect(() => {
    const feedbackMessage = localizeAiAdminMessage(locale, state);
    if (state.ok === true) {
      toast.success(feedbackMessage);
      onClose();
    } else if (state.ok === false) {
      toast.error(feedbackMessage);
    }
  }, [locale, onClose, state]);

  const selectedCourseIds = new Set(
    agent.draftSources.flatMap((source) =>
      source.sourceType === "course_version" && source.courseId
        ? [source.courseId]
        : [],
    ),
  );
  const knownIcon = localizedIconOptions.some(
    (option) => option.value === agent.draft.icon,
  );
  const hasGrant = (type: AiAgentStudioGrant["subjectType"], id: string) =>
    agent.draftAccessGrants.some((grant) => {
      if (grant.subjectType !== type) return false;
      if (type === "role") return grant.subjectRole === id;
      if (type === "user") return grant.subjectUserId === id;
      if (type === "group") return grant.subjectGroupId === id;
      return grant.subjectBundleId === id;
    });

  function addManualSource() {
    manualKey.current += 1;
    setManualSources((current) => [
      ...current,
      { key: `new-${manualKey.current}`, title: "", content: "" },
    ]);
  }

  function updateManualSource(
    key: string,
    field: "title" | "content",
    nextValue: string,
  ) {
    setManualSources((current) =>
      current.map((source) =>
        source.key === key ? { ...source, [field]: nextValue } : source,
      ),
    );
  }

  function addWebSource() {
    webKey.current += 1;
    setWebSources((current) => [
      ...current,
      {
        key: `new-web-${webKey.current}`,
        url: "https://",
        title: "",
        content: "",
        contentDigest: "",
        fetchedAt: null,
      },
    ]);
  }

  function addAdditionalPrompt() {
    promptKey.current += 1;
    setAdditionalPrompts((current) => [
      ...current,
      { key: `new-prompt-${promptKey.current}`, label: "", prompt: "" },
    ]);
  }

  function updateAdditionalPrompt(
    key: string,
    field: "label" | "prompt",
    nextValue: string,
  ) {
    setAdditionalPrompts((current) =>
      current.map((entry) =>
        entry.key === key ? { ...entry, [field]: nextValue } : entry,
      ),
    );
  }

  function updateWebSource(key: string, url: string) {
    setWebSources((current) =>
      current.map((source) =>
        source.key === key ? { ...source, url } : source,
      ),
    );
  }

  function toggleMedia(media: AiAgentStudioOptions["mediaAssets"][number]) {
    setSelectedMediaIds((current) => {
      const next = new Set(current);
      if (next.has(media.id)) next.delete(media.id);
      else next.add(media.id);
      return next;
    });
  }

  function toggleAction(course: AiAgentStudioOptions["courses"][number]) {
    setSelectedActionCourseIds((current) => {
      const next = new Set(current);
      if (next.has(course.id)) next.delete(course.id);
      else next.add(course.id);
      return next;
    });
    setActionCopy((current) => ({
      ...current,
      [course.id]: current[course.id] ?? {
        label: copy.editor.requestCourseLabel(course.title),
        description: copy.editor.requestCourseDescription,
      },
    }));
  }

  function toggleUnenrollmentAction(
    course: AiAgentStudioOptions["courses"][number],
  ) {
    setSelectedUnenrollmentCourseIds((current) => {
      const next = new Set(current);
      if (next.has(course.id)) next.delete(course.id);
      else next.add(course.id);
      return next;
    });
    setUnenrollmentActionCopy((current) => ({
      ...current,
      [course.id]: current[course.id] ?? {
        label: copy.editor.removeCourseLabel(course.title),
        description: copy.editor.removeCourseDescription,
      },
    }));
  }

  const history = [...agent.history].sort(
    (left, right) => right.version - left.version,
  );

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-2 sm:p-5">
      <DialogBackdrop onClose={onClose} pending={pending} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={copy.editor.editAria(agent.draft.name)}
        className="relative flex max-h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl sm:max-h-[94vh]"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e8ebee] px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <AgentMark agent={agent} size="sm" />
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase text-[#2b9188]">
                {copy.editor.draftMeta(
                  agent.draft.version,
                  agent.draft.draftRevision,
                )}
              </p>
              <h2 className="truncate text-sm font-bold text-[#243444] sm:text-base">
                {copy.editor.configure(agent.draft.name)}
              </h2>
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-9"
            onClick={onClose}
            disabled={pending}
            aria-label={copy.common.dialogClose}
          >
            <X className="size-4" />
          </Button>
        </header>

        <form action={action} className="flex min-h-0 flex-1 flex-col">
          <input
            type="hidden"
            name="expectedDraftVersionId"
            value={agent.draft.id}
          />
          <input
            type="hidden"
            name="expectedDraftRevision"
            value={agent.draft.draftRevision}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <fieldset className="grid gap-4 border-b border-[#e8ebee] p-4 sm:p-5">
              <legend className="sr-only">{copy.editor.basics}</legend>
              <div>
                <h3 className="text-sm font-bold text-[#2b3a48]">
                  {copy.editor.basics}
                </h3>
                <p className="mt-1 text-xs text-[#71808b]">
                  {copy.editor.basicsHint}
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_190px_170px]">
                <label>
                  <span className={labelClassName}>{copy.editor.name}</span>
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={120}
                    defaultValue={agent.draft.name}
                    className={inputClassName}
                    autoFocus
                  />
                </label>
                <label>
                  <span className={labelClassName}>
                    {copy.editor.agentType}
                  </span>
                  <select
                    name="agentType"
                    defaultValue={agent.draft.type}
                    className={inputClassName}
                  >
                    {Object.entries(localizedAgentTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={labelClassName}>{copy.editor.symbol}</span>
                  <select
                    name="icon"
                    defaultValue={agent.draft.icon}
                    className={inputClassName}
                  >
                    {!knownIcon ? (
                      <option value={agent.draft.icon}>{agent.draft.icon}</option>
                    ) : null}
                    {localizedIconOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                <span className={labelClassName}>
                  {copy.common.description}
                </span>
                <textarea
                  name="description"
                  required
                  minLength={3}
                  maxLength={5000}
                  defaultValue={agent.draft.description}
                  className={cn(textareaClassName, "min-h-20")}
                />
              </label>
              <label>
                <span className={labelClassName}>
                  {copy.editor.systemPrompt}
                </span>
                <textarea
                  name="systemPrompt"
                  required
                  minLength={10}
                  maxLength={50000}
                  defaultValue={agent.draft.systemPrompt}
                  className={cn(
                    textareaClassName,
                    "min-h-40 font-mono text-xs leading-5",
                  )}
                />
              </label>
              <label className="max-w-xs">
                <span className={labelClassName}>{copy.editor.color}</span>
                <span className="flex h-10 items-center gap-3 rounded-md border border-[#dce1e5] bg-white px-2">
                  <input
                    name="color"
                    type="color"
                    defaultValue={agent.draft.color}
                    className="size-7 cursor-pointer border-0 bg-transparent p-0"
                  />
                  <span className="font-mono text-xs text-[#71808b]">
                    {agent.draft.color.toUpperCase()}
                  </span>
                </span>
              </label>
            </fieldset>

            <fieldset className="grid gap-4 border-b border-[#e8ebee] p-4 sm:p-5">
              <legend className="sr-only">{copy.editor.knowledge}</legend>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_280px] sm:items-end">
                <div>
                  <h3 className="text-sm font-bold text-[#2b3a48]">
                    {copy.editor.knowledge}
                  </h3>
                  <p className="mt-1 text-xs text-[#71808b]">
                    {copy.editor.knowledgeHint}
                  </p>
                </div>
                <label>
                  <span className={labelClassName}>
                    {copy.editor.knowledgeMode}
                  </span>
                  <select
                    name="knowledgeMode"
                    value={knowledgeMode}
                    onChange={(event) =>
                      setKnowledgeMode(event.target.value as KnowledgeMode)
                    }
                    className={inputClassName}
                  >
                    {Object.entries(localizedKnowledgeModeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {knowledgeMode === "selected_sources" ? (
                <div className="grid gap-5">
                  <div>
                    <h4 className="mb-2 text-xs font-bold text-[#52606d]">
                      {copy.editor.publishedCourses}
                    </h4>
                    <div className="max-h-48 overflow-y-auto rounded-md border border-[#e1e5e8]">
                      {options.courses.map((course) => (
                        <CheckOption
                          key={course.id}
                          name="courseIds"
                          value={course.id}
                          label={course.title}
                          detail={copy.editor.currentCourseVersion}
                          defaultChecked={selectedCourseIds.has(course.id)}
                        />
                      ))}
                      {!options.courses.length ? (
                        <p className="p-3 text-xs text-[#7a8690]">
                          {copy.editor.noCourses}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h4 className="text-xs font-bold text-[#52606d]">
                        {copy.editor.manualSources}
                      </h4>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={addManualSource}
                      >
                        <Plus className="size-3.5" />
                        {copy.editor.addTextSource}
                      </Button>
                    </div>
                    <div className="grid gap-3">
                      {manualSources.map((source, index) => (
                        <div
                          key={source.key}
                          className="grid gap-3 border-t border-[#e8ebee] pt-3 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)_36px]"
                        >
                          <label>
                            <span className={labelClassName}>
                              {copy.editor.sourceTitle(index + 1)}
                            </span>
                            <input
                              name="manualTitles"
                              value={source.title}
                              onChange={(event) =>
                                updateManualSource(
                                  source.key,
                                  "title",
                                  event.target.value,
                                )
                              }
                              minLength={2}
                              maxLength={220}
                              className={inputClassName}
                            />
                          </label>
                          <label>
                            <span className={labelClassName}>
                              {copy.editor.curatedText}
                            </span>
                            <textarea
                              name="manualContents"
                              value={source.content}
                              onChange={(event) =>
                                updateManualSource(
                                  source.key,
                                  "content",
                                  event.target.value,
                                )
                              }
                              minLength={10}
                              maxLength={50000}
                              className={cn(textareaClassName, "min-h-20")}
                            />
                          </label>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-9 self-end text-[#ad493e]"
                            onClick={() =>
                              setManualSources((current) =>
                                current.filter((item) => item.key !== source.key),
                              )
                            }
                            aria-label={copy.editor.removeTextSourceAria(index + 1)}
                            title={copy.editor.removeTextSource}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                      {!manualSources.length ? (
                        <p className="text-xs text-[#7a8690]">
                          {copy.editor.noManualSources}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <h4 className="mb-2 text-xs font-bold text-[#52606d]">
                      {copy.editor.mediaSources}
                    </h4>
                    <div className="grid gap-0 overflow-hidden rounded-md border border-[#e1e5e8]">
                      {options.mediaAssets.map((media) => {
                        const selected = selectedMediaIds.has(media.id);
                        return (
                          <div
                            key={media.id}
                            className="border-b border-[#edf0f2] last:border-b-0"
                          >
                            <label className={optionClassName}>
                              <input
                                name="mediaAssetIds"
                                value={media.id}
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleMedia(media)}
                                className="mt-0.5 size-4 shrink-0 accent-[#2b9188]"
                              />
                              <span className="min-w-0">
                                <span className="block break-words text-xs font-semibold text-[#354555]">
                                  {media.fileName}
                                </span>
                                <span className="mt-0.5 block text-[10px] uppercase text-[#7a8690]">
                                  {media.kind}
                                </span>
                              </span>
                            </label>
                            {selected ? (
                              <div className="bg-[#f8f9fa] px-3 py-3 text-xs leading-5 text-[#52606d]">
                                {copy.editor.mediaHint}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                      {!options.mediaAssets.length ? (
                        <p className="p-3 text-xs text-[#7a8690]">
                          {copy.editor.noMedia}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h4 className="text-xs font-bold text-[#52606d]">
                        {copy.editor.webSnapshots}
                      </h4>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={addWebSource}
                        disabled={webSources.length >= 10}
                      >
                        <Globe2 className="size-3.5" />
                        {copy.editor.addWebSource}
                      </Button>
                    </div>
                    <div className="grid gap-3">
                      {webSources.map((source, index) => (
                        <div
                          key={source.key}
                          className="grid min-w-0 gap-3 border-t border-[#e8ebee] pt-3 first:border-t-0 first:pt-0"
                        >
                          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_36px]">
                            <label className="min-w-0">
                              <span className={labelClassName}>
                                {copy.editor.webAddress(index + 1)}
                              </span>
                              <input
                                name="webUrls"
                                type="url"
                                inputMode="url"
                                value={source.url}
                                onChange={(event) =>
                                  updateWebSource(source.key, event.target.value)
                                }
                                required
                                minLength={12}
                                maxLength={2048}
                                pattern="https://.*"
                                className={inputClassName}
                              />
                            </label>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="size-9 self-end text-[#ad493e]"
                              onClick={() =>
                                setWebSources((current) =>
                                  current.filter(
                                    (item) => item.key !== source.key,
                                  ),
                                )
                              }
                              aria-label={copy.editor.removeWebSourceAria(index + 1)}
                              title={copy.editor.removeWebSource}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                          {source.contentDigest && source.fetchedAt ? (
                            <details className="min-w-0 rounded-md border border-[#e1e5e8] bg-[#f8f9fa] px-3 py-2.5">
                              <summary className="cursor-pointer break-words text-xs font-semibold text-[#354555]">
                                {source.title || copy.editor.savedSnapshot} -{" "}
                                {formatAiAdminDateTime(source.fetchedAt, locale)}
                              </summary>
                              <p className="mt-2 break-all font-mono text-[10px] text-[#71808b]">
                                SHA-256 {source.contentDigest}
                              </p>
                              <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-[#2b9188] pl-3 text-xs leading-5 text-[#52606d] [overflow-wrap:anywhere]">
                                {source.content}
                              </p>
                            </details>
                          ) : null}
                        </div>
                      ))}
                      {!webSources.length ? (
                        <p className="text-xs text-[#7a8690]">
                          {copy.editor.noWebSnapshots}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="rounded-md border border-[#cfe0ed] bg-[#f2f7fa] p-3 text-xs leading-5 text-[#365f8d]">
                  {copy.editor.allCoursesHint}
                </p>
              )}
            </fieldset>

            <fieldset className="grid gap-5 border-b border-[#e8ebee] p-4 sm:p-5">
              <legend className="sr-only">{copy.editor.personalization}</legend>
              <div>
                <h3 className="text-sm font-bold text-[#2b3a48]">
                  {copy.editor.personalizationTitle}
                </h3>
                <p className="mt-1 text-xs leading-5 text-[#71808b]">
                  {copy.editor.personalizationHint}
                </p>
              </div>

              <div>
                <h4 className="mb-2 text-xs font-bold text-[#52606d]">
                  {copy.editor.profileFields}
                </h4>
                <div className="max-h-56 overflow-y-auto rounded-md border border-[#e1e5e8]">
                  {options.profileFields.map((field) => (
                    <CheckOption
                      key={field.id}
                      name="profileFieldIds"
                      value={field.id}
                      label={field.label}
                      detail={`${field.category} - ${field.type}`}
                      defaultChecked={agent.draft.profileFieldIds.includes(field.id)}
                    />
                  ))}
                  {!options.profileFields.length ? (
                    <p className="p-3 text-xs text-[#7a8690]">
                      {copy.editor.noProfileFields}
                    </p>
                  ) : null}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h4 className="text-xs font-bold text-[#52606d]">
                    {copy.editor.guidelines}
                  </h4>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={addAdditionalPrompt}
                    disabled={additionalPrompts.length >= 20}
                  >
                    <Plus className="size-3.5" />
                    {copy.editor.addPrompt}
                  </Button>
                </div>
                <div className="grid gap-3">
                  {additionalPrompts.map((entry, index) => (
                    <div
                      key={entry.key}
                      className="grid gap-3 border-t border-[#e8ebee] pt-3 first:border-t-0 first:pt-0 sm:grid-cols-[220px_minmax(0,1fr)_36px]"
                    >
                      <label>
                        <span className={labelClassName}>
                          {copy.editor.promptLabel(index + 1)}
                        </span>
                        <input
                          name="additionalPromptLabels"
                          value={entry.label}
                          onChange={(event) =>
                            updateAdditionalPrompt(
                              entry.key,
                              "label",
                              event.target.value,
                            )
                          }
                          required
                          minLength={2}
                          maxLength={120}
                          className={inputClassName}
                        />
                      </label>
                      <label>
                        <span className={labelClassName}>
                          {copy.editor.guideline}
                        </span>
                        <textarea
                          name="additionalPromptContents"
                          value={entry.prompt}
                          onChange={(event) =>
                            updateAdditionalPrompt(
                              entry.key,
                              "prompt",
                              event.target.value,
                            )
                          }
                          required
                          minLength={10}
                          maxLength={4000}
                          className={cn(textareaClassName, "min-h-20")}
                        />
                      </label>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-9 self-end text-[#ad493e]"
                        onClick={() =>
                          setAdditionalPrompts((current) =>
                            current.filter((item) => item.key !== entry.key),
                          )
                        }
                        aria-label={copy.editor.removePromptAria(index + 1)}
                        title={copy.editor.removePrompt}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  {!additionalPrompts.length ? (
                    <p className="text-xs text-[#7a8690]">
                      {copy.editor.noGuidelines}
                    </p>
                  ) : null}
                </div>
              </div>
            </fieldset>

            <fieldset className="grid gap-4 border-b border-[#e8ebee] p-4 sm:p-5">
              <legend className="sr-only">{copy.editor.access}</legend>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_280px] sm:items-end">
                <div>
                  <h3 className="text-sm font-bold text-[#2b3a48]">
                    {copy.editor.access}
                  </h3>
                  <p className="mt-1 text-xs text-[#71808b]">
                    {copy.editor.accessHint}
                  </p>
                </div>
                <label>
                  <span className={labelClassName}>
                    {copy.editor.accessMode}
                  </span>
                  <select
                    name="accessMode"
                    value={accessMode}
                    onChange={(event) =>
                      setAccessMode(event.target.value as AccessMode)
                    }
                    className={inputClassName}
                  >
                    {Object.entries(localizedAccessModeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {accessMode === "restricted" ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <h4 className="mb-2 text-xs font-bold text-[#52606d]">
                      {copy.editor.roles}
                    </h4>
                    <div className="overflow-hidden rounded-md border border-[#e1e5e8]">
                      {localizedRoleOptions.map((role) => (
                        <CheckOption
                          key={role.value}
                          name="grantRoles"
                          value={role.value}
                          label={role.label}
                          defaultChecked={hasGrant("role", role.value)}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="mb-2 text-xs font-bold text-[#52606d]">
                      {copy.editor.groups}
                    </h4>
                    <div className="max-h-48 overflow-y-auto rounded-md border border-[#e1e5e8]">
                      {options.groups.map((group) => (
                        <CheckOption
                          key={group.id}
                          name="grantGroupIds"
                          value={group.id}
                          label={group.name}
                          defaultChecked={hasGrant("group", group.id)}
                        />
                      ))}
                      {!options.groups.length ? (
                        <p className="p-3 text-xs text-[#7a8690]">
                          {copy.editor.noGroups}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <h4 className="mb-2 text-xs font-bold text-[#52606d]">
                      {copy.editor.members}
                    </h4>
                    <div className="max-h-56 overflow-y-auto rounded-md border border-[#e1e5e8]">
                      {options.users.map((member) => (
                        <CheckOption
                          key={member.id}
                          name="grantUserIds"
                          value={member.id}
                          label={member.label}
                          defaultChecked={hasGrant("user", member.id)}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="mb-2 text-xs font-bold text-[#52606d]">
                      {copy.editor.bundles}
                    </h4>
                    <div className="max-h-56 overflow-y-auto rounded-md border border-[#e1e5e8]">
                      {options.bundles.map((bundle) => (
                        <CheckOption
                          key={bundle.id}
                          name="grantBundleIds"
                          value={bundle.id}
                          label={bundle.name}
                          defaultChecked={hasGrant("bundle", bundle.id)}
                        />
                      ))}
                      {!options.bundles.length ? (
                        <p className="p-3 text-xs text-[#7a8690]">
                          {copy.editor.noBundles}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="rounded-md border border-[#cde7df] bg-[#f0f8f5] p-3 text-xs leading-5 text-[#25746c]">
                  {copy.editor.openAccessHint}
                </p>
              )}
            </fieldset>

            <fieldset className="grid gap-4 border-b border-[#e8ebee] p-4 sm:p-5">
              <legend className="sr-only">{copy.editor.actions}</legend>
              <div>
                <h3 className="text-sm font-bold text-[#2b3a48]">
                  {copy.editor.actions}
                </h3>
                <p className="mt-1 text-xs leading-5 text-[#71808b]">
                  {copy.editor.actionsHint}
                </p>
              </div>
              <div>
                <h4 className="mb-2 text-xs font-bold text-[#52606d]">
                  {copy.editor.grantAccess}
                </h4>
                <div className="grid gap-0 overflow-hidden rounded-md border border-[#e1e5e8]">
                {options.courses.map((course) => {
                  const selected = selectedActionCourseIds.has(course.id);
                  const actionText = actionCopy[course.id] ?? {
                    label: copy.editor.requestCourseLabel(course.title),
                    description: copy.editor.requestCourseDescription,
                  };
                  return (
                    <div
                      key={course.id}
                      className="border-b border-[#edf0f2] last:border-b-0"
                    >
                      <label className={optionClassName}>
                        <input
                          name="actionCourseIds"
                          value={course.id}
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleAction(course)}
                          className="mt-0.5 size-4 shrink-0 accent-[#2b9188]"
                        />
                        <span className="min-w-0">
                          <span className="block break-words text-xs font-semibold text-[#354555]">
                            {course.title}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-[#7a8690]">
                            {copy.editor.requestCourseAccess}
                          </span>
                        </span>
                      </label>
                      {selected ? (
                        <div className="grid gap-3 bg-[#f8f9fa] px-3 py-3 sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
                          <label>
                            <span className={labelClassName}>
                              {copy.common.label}
                            </span>
                            <input
                              name={`actionLabel:course_enrollment:${course.id}`}
                              value={actionText.label}
                              onChange={(event) =>
                                setActionCopy((current) => ({
                                  ...current,
                                  [course.id]: {
                                    ...actionText,
                                    label: event.target.value,
                                  },
                                }))
                              }
                              required
                              minLength={2}
                              maxLength={120}
                              className={inputClassName}
                            />
                          </label>
                          <label>
                            <span className={labelClassName}>
                              {copy.common.description}
                            </span>
                            <input
                              name={`actionDescription:course_enrollment:${course.id}`}
                              value={actionText.description}
                              onChange={(event) =>
                                setActionCopy((current) => ({
                                  ...current,
                                  [course.id]: {
                                    ...actionText,
                                    description: event.target.value,
                                  },
                                }))
                              }
                              required
                              minLength={3}
                              maxLength={500}
                              className={inputClassName}
                            />
                          </label>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {!options.courses.length ? (
                  <p className="p-3 text-xs text-[#7a8690]">
                    {copy.editor.noCourseTargets}
                  </p>
                ) : null}
                </div>
              </div>
              <div>
                <h4 className="mb-2 text-xs font-bold text-[#52606d]">
                  {copy.editor.revokeDirectAccess}
                </h4>
                <div className="grid gap-0 overflow-hidden rounded-md border border-[#e1e5e8]">
                  {options.courses.map((course) => {
                    const selected = selectedUnenrollmentCourseIds.has(
                      course.id,
                    );
                    const actionText = unenrollmentActionCopy[course.id] ?? {
                      label: copy.editor.removeCourseLabel(course.title),
                      description: copy.editor.removeCourseDescription,
                    };
                    return (
                      <div
                        key={course.id}
                        className="border-b border-[#edf0f2] last:border-b-0"
                      >
                        <label className={optionClassName}>
                          <input
                            name="actionUnenrollmentCourseIds"
                            value={course.id}
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleUnenrollmentAction(course)}
                            className="mt-0.5 size-4 shrink-0 accent-[#2b9188]"
                          />
                          <span className="min-w-0">
                            <span className="block break-words text-xs font-semibold text-[#354555]">
                              {course.title}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-[#7a8690]">
                              {copy.editor.removeCourseAccess}
                            </span>
                          </span>
                        </label>
                        {selected ? (
                          <div className="grid gap-3 bg-[#f8f9fa] px-3 py-3 sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
                            <label>
                              <span className={labelClassName}>
                                {copy.common.label}
                              </span>
                              <input
                                name={`actionLabel:course_unenrollment:${course.id}`}
                                value={actionText.label}
                                onChange={(event) =>
                                  setUnenrollmentActionCopy((current) => ({
                                    ...current,
                                    [course.id]: {
                                      ...actionText,
                                      label: event.target.value,
                                    },
                                  }))
                                }
                                required
                                minLength={2}
                                maxLength={120}
                                className={inputClassName}
                              />
                            </label>
                            <label>
                              <span className={labelClassName}>
                                {copy.common.description}
                              </span>
                              <input
                                name={`actionDescription:course_unenrollment:${course.id}`}
                                value={actionText.description}
                                onChange={(event) =>
                                  setUnenrollmentActionCopy((current) => ({
                                    ...current,
                                    [course.id]: {
                                      ...actionText,
                                      description: event.target.value,
                                    },
                                  }))
                                }
                                required
                                minLength={3}
                                maxLength={500}
                                className={inputClassName}
                              />
                            </label>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {!options.courses.length ? (
                    <p className="p-3 text-xs text-[#7a8690]">
                      {copy.editor.noCourseTargets}
                    </p>
                  ) : null}
                </div>
              </div>
              <AssignmentActionSelector
                title={copy.editor.assignGroup}
                emptyLabel={copy.editor.noGroupTargets}
                fieldName="actionGroupAssignmentIds"
                actionType="group_membership_add"
                items={options.groups}
                selectedIds={groupAssignment.selectedIds}
                copyById={groupAssignment.copyById}
                onToggle={groupAssignment.toggle}
                onCopyChange={groupAssignment.updateCopy}
              />
              <AssignmentActionSelector
                title={copy.editor.removeAiGroup}
                emptyLabel={copy.editor.noGroupTargets}
                fieldName="actionGroupRemovalIds"
                actionType="group_membership_remove"
                items={options.groups}
                selectedIds={groupRemoval.selectedIds}
                copyById={groupRemoval.copyById}
                onToggle={groupRemoval.toggle}
                onCopyChange={groupRemoval.updateCopy}
              />
              <AssignmentActionSelector
                title={copy.editor.assignBundle}
                emptyLabel={copy.editor.noBundleTargets}
                fieldName="actionBundleAssignmentIds"
                actionType="bundle_assignment_add"
                items={options.bundles}
                selectedIds={bundleAssignment.selectedIds}
                copyById={bundleAssignment.copyById}
                onToggle={bundleAssignment.toggle}
                onCopyChange={bundleAssignment.updateCopy}
              />
              <AssignmentActionSelector
                title={copy.editor.removeAiBundle}
                emptyLabel={copy.editor.noBundleTargets}
                fieldName="actionBundleRemovalIds"
                actionType="bundle_assignment_remove"
                items={options.bundles}
                selectedIds={bundleRemoval.selectedIds}
                copyById={bundleRemoval.copyById}
                onToggle={bundleRemoval.toggle}
                onCopyChange={bundleRemoval.updateCopy}
              />
            </fieldset>

            <DraftMemberPreview
              agent={agent}
              members={options.users}
              disabled={pending}
            />

            <section className="grid gap-3 p-4 sm:p-5" aria-labelledby="version-history-title">
              <div>
                <h3 id="version-history-title" className="text-sm font-bold text-[#2b3a48]">
                  {copy.editor.history}
                </h3>
                <p className="mt-1 text-xs text-[#71808b]">
                  {copy.editor.historyHint}
                </p>
              </div>
              <div className="divide-y divide-[#edf0f2] border-y border-[#e1e5e8]">
                {history.map((version) => {
                  const current = agent.publishedVersionId === version.id;
                  return (
                    <div
                      key={version.id}
                      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-bold text-[#354555]">
                            {copy.common.version} {version.version}
                          </p>
                          {current ? (
                            <Badge tone="teal">{copy.editor.currentLive}</Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-[10px] text-[#7a8690]">
                          {version.publishedAt
                            ? formatAiAdminDateTime(version.publishedAt, locale)
                            : copy.common.published}
                          {` - ${localizedAgentTypeLabels[version.type]}`}
                        </p>
                      </div>
                      {!current ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => onRollback(version)}
                        >
                          <RotateCcw className="size-3.5" />
                          {copy.editor.restore}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
                {!history.length ? (
                  <p className="py-4 text-xs text-[#7a8690]">
                    {copy.editor.noVersions}
                  </p>
                ) : null}
              </div>
            </section>

            {state.ok === false ? (
              <p
                className="mx-4 mb-4 rounded-md border border-[#f4c8c2] bg-[#fdf0ee] p-3 text-xs text-[#a94339] sm:mx-5"
                role="alert"
              >
                {localizeAiAdminMessage(locale, state)}
              </p>
            ) : null}
          </div>

          <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-[#edf0f2] bg-[#fafbfb] px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              {copy.common.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {pending ? copy.editor.saving : copy.editor.saveDraft}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function PublishAgentDialog({
  agent,
  onClose,
}: {
  agent: AiAgentManagementRow;
  onClose: () => void;
}) {
  const { copy, locale } = useAiManagerI18n();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  useDialogLifecycle(onClose, pending);

  function publish() {
    setError("");
    startTransition(async () => {
      const result = await publishAiAgentDraftAdminAction({
        agentId: agent.id,
        expectedDraftVersionId: agent.draft.id,
        expectedDraftRevision: agent.draft.draftRevision,
        confirmed,
      });
      const feedbackMessage = localizeAiAdminMessage(locale, result);
      if (result.ok) {
        toast.success(feedbackMessage);
        onClose();
      } else {
        setError(feedbackMessage);
        toast.error(feedbackMessage);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-3 sm:p-5">
      <DialogBackdrop onClose={onClose} pending={pending} />
      <section
        role="alertdialog"
        aria-modal="true"
        aria-label={copy.publish.aria}
        className="relative w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[#d6e7e3] bg-[#f2f9f7] px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-md bg-[#dff2ed] text-[#25746c]">
              <Send className="size-4" />
            </span>
            <div>
              <p className="text-[9px] font-bold uppercase text-[#2b9188]">
                 {copy.publish.eyebrow}
              </p>
              <h2 className="text-base font-bold text-[#243444]">
                 {copy.publish.title(agent.draft.version)}
              </h2>
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-9"
            onClick={onClose}
            disabled={pending}
            aria-label={copy.common.dialogClose}
          >
            <X className="size-4" />
          </Button>
        </header>
        <div className="grid gap-4 p-4 sm:p-5">
          <p className="text-sm leading-6 text-[#52606d]">
             {copy.publish.description}
          </p>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-[#dce3e1] bg-[#f8fbfa] p-3">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5 size-4 accent-[#2b9188]"
            />
            <span className="text-xs font-semibold leading-5 text-[#354555]">
              {copy.publish.confirm(agent.draft.version)}
            </span>
          </label>
          {error ? (
            <p className="rounded-md border border-[#f4c8c2] bg-[#fdf0ee] p-3 text-xs text-[#a94339]" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-[#edf0f2] bg-[#fafbfb] px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {copy.common.cancel}
          </Button>
          <Button onClick={publish} disabled={pending || !confirmed}>
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            {pending ? copy.publish.pending : copy.publish.submit}
          </Button>
        </footer>
      </section>
    </div>
  );
}

function RollbackAgentDialog({
  agent,
  version,
  onClose,
}: {
  agent: AiAgentManagementRow;
  version: AiAgentStudioVersion;
  onClose: () => void;
}) {
  const { copy, locale } = useAiManagerI18n();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  useDialogLifecycle(onClose, pending);

  function rollback() {
    setError("");
    startTransition(async () => {
      const result = await rollbackAiAgentVersionAdminAction({
        agentId: agent.id,
        publishedVersionId: version.id,
        confirmed,
      });
      const feedbackMessage = localizeAiAdminMessage(locale, result);
      if (result.ok) {
        toast.success(feedbackMessage);
        onClose();
      } else {
        setError(feedbackMessage);
        toast.error(feedbackMessage);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-3 sm:p-5">
      <DialogBackdrop onClose={onClose} pending={pending} />
      <section
        role="alertdialog"
        aria-modal="true"
        aria-label={copy.rollback.aria}
        className="relative w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[#ead9a8] bg-[#fbf8ef] px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-md bg-[#f5ebca] text-[#8d6a12]">
              <RotateCcw className="size-4" />
            </span>
            <div>
              <p className="text-[9px] font-bold uppercase text-[#8d6a12]">
                {copy.rollback.eyebrow}
              </p>
              <h2 className="text-base font-bold text-[#243444]">
                {copy.rollback.title(version.version)}
              </h2>
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-9"
            onClick={onClose}
            disabled={pending}
            aria-label={copy.common.dialogClose}
          >
            <X className="size-4" />
          </Button>
        </header>
        <div className="grid gap-4 p-4 sm:p-5">
          <p className="text-sm leading-6 text-[#52606d]">
            {copy.rollback.description(version.version)}
          </p>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-[#e7dfc7] bg-[#fbfaf6] p-3">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5 size-4 accent-[#8d6a12]"
            />
            <span className="text-xs font-semibold leading-5 text-[#354555]">
              {copy.rollback.confirm(version.version)}
            </span>
          </label>
          {error ? (
            <p className="rounded-md border border-[#f4c8c2] bg-[#fdf0ee] p-3 text-xs text-[#a94339]" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-[#edf0f2] bg-[#fafbfb] px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {copy.common.cancel}
          </Button>
          <Button variant="navy" onClick={rollback} disabled={pending || !confirmed}>
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            {pending ? copy.rollback.pending : copy.rollback.submit}
          </Button>
        </footer>
      </section>
    </div>
  );
}

function DeleteAgentDialog({
  agent,
  onClose,
}: {
  agent: AiAgentManagementRow;
  onClose: () => void;
}) {
  const { copy, locale } = useAiManagerI18n();
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  useDialogLifecycle(onClose, pending);

  function remove() {
    setError("");
    startTransition(async () => {
      const result = await deleteAiAgentAdminAction(agent.id, confirmation);
      const feedbackMessage = localizeAiAdminMessage(locale, result);
      if (result.ok) {
        toast.success(feedbackMessage);
        onClose();
      } else {
        setError(feedbackMessage);
        toast.error(feedbackMessage);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-3 sm:p-5">
      <DialogBackdrop onClose={onClose} pending={pending} />
      <section
        role="alertdialog"
        aria-modal="true"
        aria-label={copy.deletion.aria}
        className="relative w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[#f0d9d6] bg-[#fdf7f6] px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-md bg-[#fbe5e2] text-[#b84e42]">
              <Trash2 className="size-4" />
            </span>
            <div>
              <p className="text-[9px] font-bold uppercase text-[#b84e42]">
                {copy.deletion.eyebrow}
              </p>
              <h2 className="text-base font-bold text-[#243444]">
                {copy.deletion.title}
              </h2>
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-9"
            onClick={onClose}
            disabled={pending}
            aria-label={copy.common.dialogClose}
          >
            <X className="size-4" />
          </Button>
        </header>
        <div className="grid gap-4 p-4 sm:p-5">
          <p className="text-sm leading-6 text-[#52606d]">
            {copy.deletion.description(agent.draft.name)}
          </p>
          <label>
            <span className={labelClassName}>
              {copy.deletion.confirmation}
            </span>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className={inputClassName}
              placeholder={agent.draft.name}
              autoComplete="off"
              autoFocus
            />
          </label>
          {error ? (
            <p className="rounded-md border border-[#f4c8c2] bg-[#fdf0ee] p-3 text-xs text-[#a94339]" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-[#edf0f2] bg-[#fafbfb] px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {copy.common.cancel}
          </Button>
          <Button
            variant="danger"
            onClick={remove}
            disabled={pending || confirmation !== agent.draft.name}
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            {pending ? copy.deletion.pending : copy.deletion.submit}
          </Button>
        </footer>
      </section>
    </div>
  );
}

function AgentActions({
  agent,
  onEdit,
  onPublish,
  onDelete,
}: {
  agent: AiAgentManagementRow;
  onEdit: () => void;
  onPublish: () => void;
  onDelete: () => void;
}) {
  const { copy, locale } = useAiManagerI18n();
  const [pending, startTransition] = useTransition();
  const canToggle = Boolean(agent.published);

  function toggle() {
    if (!canToggle) return;
    startTransition(async () => {
      const result = await toggleAiAgentAdminAction(agent.id);
      const feedbackMessage = localizeAiAdminMessage(locale, result);
      if (result.ok) toast.success(feedbackMessage);
      else toast.error(feedbackMessage);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        size="sm"
        variant="secondary"
        onClick={onEdit}
        disabled={pending}
        aria-label={copy.row.editAria(agent.draft.name)}
      >
        <Pencil className="size-3.5" />
        {copy.row.edit}
      </Button>
      <Button
        size="sm"
        onClick={onPublish}
        disabled={pending}
        aria-label={copy.row.publishAria(agent.draft.name)}
      >
        <Send className="size-3.5" />
        {copy.row.publish}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        onClick={toggle}
        disabled={pending || !canToggle}
        aria-label={
          canToggle
            ? copy.row.toggleAria(agent.draft.name, agent.active)
            : copy.row.unavailableToggleAria(agent.draft.name)
        }
        title={
          canToggle
            ? agent.active
              ? copy.row.pause
              : copy.row.activate
            : copy.row.publishFirst
        }
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : agent.active ? (
          <PauseCircle className="size-3.5" />
        ) : (
          <PlayCircle className="size-3.5" />
        )}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-8 text-[#ad493e] hover:bg-[#fdf0ee] hover:text-[#923c32]"
        onClick={onDelete}
        disabled={pending}
        aria-label={copy.row.deleteAria(agent.draft.name)}
        title={copy.row.delete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

function AgentRow({
  agent,
  canManage,
  onEdit,
  onPublish,
  onDelete,
}: {
  agent: AiAgentManagementRow;
  canManage: boolean;
  onEdit: () => void;
  onPublish: () => void;
  onDelete: () => void;
}) {
  const { copy, locale } = useAiManagerI18n();
  const localizedAgentTypeLabels = agentTypeLabels(copy);
  const localizedKnowledgeModeLabels = knowledgeModeLabels(copy);
  return (
    <article
      id={`agent-${agent.id}`}
      className="scroll-mt-24 overflow-hidden rounded-lg border border-[#dfe4e8] bg-white"
    >
      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)] lg:items-start">
        <div className="flex min-w-0 items-start gap-3">
          <AgentMark agent={agent} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words text-base font-bold text-[#243444]">
                {agent.draft.name}
              </h3>
              <LiveStatus agent={agent} />
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#71808b]">
              {agent.draft.description}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone="blue">
                {localizedAgentTypeLabels[agent.draft.type]}
              </Badge>
              <Badge tone="neutral">
                {localizedKnowledgeModeLabels[agent.draft.knowledgeMode]}
              </Badge>
              <Badge tone={agent.draft.accessMode === "open" ? "teal" : "amber"}>
                {agent.draft.accessMode === "open"
                  ? copy.row.openAccess
                  : copy.row.restricted}
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="border-l-2 border-[#2b9188] pl-3">
            <p className="text-[9px] font-bold uppercase text-[#2b9188]">
              {copy.row.draft}
            </p>
            <p className="mt-1 text-sm font-bold text-[#354555]">
              {copy.common.version} {agent.draft.version}
            </p>
            <p className="mt-0.5 text-[10px] text-[#7a8690]">
              {copy.row.revision(
                agent.draft.draftRevision,
                formatAiAdminDateTime(agent.draft.updatedAt, locale),
              )}
            </p>
            <p className="mt-1 text-[10px] leading-4 text-[#52606d]">
              {localizedAgentTypeLabels[agent.draft.type]} -{" "}
              {localizedKnowledgeModeLabels[agent.draft.knowledgeMode]} -{" "}
              {agent.draft.accessMode === "open"
                ? copy.common.open
                : copy.common.restricted}
            </p>
          </div>
          <div className="border-l-2 border-[#8a949d] pl-3">
            <p className="text-[9px] font-bold uppercase text-[#71808b]">
              {copy.row.live}
            </p>
            {agent.published ? (
              <>
                <p className="mt-1 text-sm font-bold text-[#354555]">
                  {copy.common.version} {agent.published.version}
                </p>
                <p className="mt-0.5 text-[10px] text-[#7a8690]">
                  {agent.published.publishedAt
                    ? formatAiAdminDateTime(
                        agent.published.publishedAt,
                        locale,
                      )
                    : copy.common.published}
                </p>
                <p className="mt-1 text-[10px] leading-4 text-[#52606d]">
                  {localizedAgentTypeLabels[agent.published.type]} -{" "}
                  {localizedKnowledgeModeLabels[agent.published.knowledgeMode]} -{" "}
                  {agent.published.accessMode === "open"
                    ? copy.common.open
                    : copy.common.restricted}
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs font-semibold text-[#8d6a12]">
                {copy.row.notPublished}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-[#edf0f2] bg-[#f8f9fa] px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-2 sm:flex sm:flex-wrap sm:items-center">
          <div className="flex items-center gap-2">
            <MessageSquareCode className="size-3.5 text-[#71808b]" />
            <dt className="sr-only">{copy.row.conversations}</dt>
            <dd className="text-xs text-[#52606d]">
              {copy.row.chats(agent.conversationCount)}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <CircleGauge className="size-3.5 text-[#71808b]" />
            <dt className="sr-only">{copy.row.messages}</dt>
            <dd className="text-xs text-[#52606d]">
              {copy.row.messageCount(agent.messageCount)}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <Users className="size-3.5 text-[#71808b]" />
            <dt className="sr-only">{copy.row.users}</dt>
            <dd className="text-xs text-[#52606d]">
              {copy.row.userCount(agent.memberCount)}
            </dd>
          </div>
          <div className="col-span-2 flex min-w-0 items-center gap-2">
            <History className="size-3.5 shrink-0 text-[#71808b]" />
            <dt className="sr-only">{copy.row.lastActivity}</dt>
            <dd className="truncate text-xs text-[#71808b]">
              {agent.lastMessageAt
                ? formatAiAdminDateTime(agent.lastMessageAt, locale)
                : copy.row.noUsage}
            </dd>
          </div>
        </dl>
        {canManage ? (
          <AgentActions
            agent={agent}
            onEdit={onEdit}
            onPublish={onPublish}
            onDelete={onDelete}
          />
        ) : null}
      </div>
    </article>
  );
}

export function AiAgentManager({
  locale,
  agents,
  options,
  canManage,
}: {
  locale: AppLocale;
  agents: AiAgentManagementRow[];
  options: AiAgentStudioOptions;
  canManage: boolean;
}) {
  const copy = getAiManagerCopy(locale);
  const [editId, setEditId] = useState<string | null>(null);
  const [publishId, setPublishId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<{
    agentId: string;
    version: AiAgentStudioVersion;
  } | null>(null);
  const byId = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const editAgent = editId ? byId.get(editId) ?? null : null;
  const publishAgent = publishId ? byId.get(publishId) ?? null : null;
  const deleteAgent = deleteId ? byId.get(deleteId) ?? null : null;
  const rollbackAgent = rollbackTarget
    ? byId.get(rollbackTarget.agentId) ?? null
    : null;

  return (
    <AiManagerI18nContext.Provider value={{ locale, copy }}>
      <section aria-labelledby="configured-agents-title">
        <header className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 id="configured-agents-title" className="text-base font-bold text-[#243444]">
              {copy.studio.title}
            </h2>
            <p className="mt-1 text-[11px] text-[#7a8690]">
              {copy.studio.count(agents.length)}
            </p>
          </div>
          <ShieldCheck className="size-5 text-[#2b9188]" aria-hidden="true" />
        </header>
        <div className="grid gap-3">
          {agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              canManage={canManage}
              onEdit={() => setEditId(agent.id)}
              onPublish={() => setPublishId(agent.id)}
              onDelete={() => setDeleteId(agent.id)}
            />
          ))}
          {!agents.length ? (
            <div className="grid min-h-52 place-items-center rounded-lg border border-dashed border-[#cfd6db] p-8 text-center">
              <div>
                <Bot className="mx-auto size-7 text-[#a2abb3]" />
                <p className="mt-3 text-sm font-semibold text-[#354555]">
                  {copy.studio.empty}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {editAgent && canManage ? (
        <EditAgentDialog
          key={editAgent.id}
          agent={editAgent}
          options={options}
          onClose={() => setEditId(null)}
          onRollback={(version) => {
            setEditId(null);
            setRollbackTarget({ agentId: editAgent.id, version });
          }}
        />
      ) : null}
      {publishAgent && canManage ? (
        <PublishAgentDialog
          key={publishAgent.id}
          agent={publishAgent}
          onClose={() => setPublishId(null)}
        />
      ) : null}
      {rollbackAgent && rollbackTarget && canManage ? (
        <RollbackAgentDialog
          key={`${rollbackAgent.id}:${rollbackTarget.version.id}`}
          agent={rollbackAgent}
          version={rollbackTarget.version}
          onClose={() => setRollbackTarget(null)}
        />
      ) : null}
      {deleteAgent && canManage ? (
        <DeleteAgentDialog
          key={deleteAgent.id}
          agent={deleteAgent}
          onClose={() => setDeleteId(null)}
        />
      ) : null}
    </AiManagerI18nContext.Provider>
  );
}

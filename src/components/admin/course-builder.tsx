"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  AudioLines,
  BarChart3,
  BookOpen,
  Bot,
  Braces,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  CircleHelp,
  CirclePlay,
  ClipboardList,
  Code2,
  Copy,
  Clock3,
  FileDown,
  FileQuestion,
  GripVertical,
  Heading2,
  Info,
  ImageIcon,
  Images,
  IndentDecrease,
  IndentIncrease,
  Layers3,
  LayoutTemplate,
  Link2,
  ListChecks,
  ListOrdered,
  LoaderCircle,
  MessageSquareText,
  MonitorPlay,
  MousePointerClick,
  Pencil,
  Plus,
  Save,
  Eye,
  EyeOff,
  RefreshCw,
  Send,
  Share2,
  Table2,
  TextQuote,
  Trash2,
  TextCursorInput,
  Unlink,
  Users,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  addCourseContentBlockAction,
  attachReusableModuleAction,
  createCourseModuleAction,
  createLessonPageAction,
  createModuleLessonAction,
  createModuleSectionAction,
  commandLessonPageAction,
  copyCourseLessonAction,
  copyCourseSectionAction,
  detachCourseModuleAction,
  deleteCourseContentBlockAction,
  duplicateCourseContentBlockAction,
  listCourseBuilderPublishedAiAgentsAction,
  reorderCourseContentBlocksAction,
  updateCourseContentBlockAction,
  updateCourseInformationAction,
  updateCourseLinkModuleAction,
  updateCourseLessonAssessmentAction,
  updateCourseLessonAccessAction,
  updateCourseModuleAccessAction,
  updateCourseModuleOutlineAction,
  updateCourseLessonTitleAction,
  updateLessonPageTitleAction,
  updateModuleSectionAccessAction,
  type CourseBuilderAiAgentOption,
  type CourseBuilderActionResult,
} from "@/lib/course-builder-actions";
import { cn, formatDate, formatDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { CourseMediaSourceField } from "@/components/admin/course-media-source-field";
import { CourseCoverEditor } from "@/components/admin/course-cover-editor";
import { ReusableModulePicker } from "@/components/admin/reusable-module-picker";
import { GalleryBlockEditor } from "@/components/admin/gallery-block-editor";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { TranscriptWizardControls } from "@/components/admin/transcript-wizard-controls";
import { VideoTranscriptEditor } from "@/components/admin/video-transcript-editor";
import { StructuredContentBlockEditor } from "@/components/admin/structured-content-block-editor";
import { CourseWidgetsEditor } from "@/components/admin/course-widgets-editor";
import { CourseInformationListsEditor } from "@/components/admin/course-information-lists-editor";
import { SectionLessonVisibilityActions } from "@/components/admin/section-lesson-visibility-actions";
import { EditorPresenceStrip } from "@/components/admin/editor-presence-strip";
import { RichTextContent } from "@/components/content/rich-text-content";
import {
  GalleryContent,
  LinkButtonContent,
  StructuredBlockContent,
} from "@/components/content/interactive-block-content";
import type { RichTextDocument } from "@/lib/rich-text/document";
import type {
  GalleryDocument,
  LinkButtonDocument,
} from "@/lib/content-blocks/interactive-documents";
import type { VideoTranscriptDocument } from "@/lib/content-blocks/video-transcript";
import type { VideoPlaybackPolicy } from "@/lib/media/video-playback-policy";
import type { VideoEndCard } from "@/lib/media/video-end-card";
import type { VideoCompositionDocument } from "@/lib/media/video-composition";
import type {
  AccordionDocument,
  CalloutDocument,
  CodeDocument,
  ColumnsDocument,
  DividerDocument,
  DownloadDocument,
  QuoteDocument,
  TableDocument,
  TabsDocument,
} from "@/lib/content-blocks/layout-documents";
import {
  COURSE_INTEGRATION_LAYOUTS,
  COURSE_INTEGRATION_PROVIDERS,
  courseIntegrationFrameClass,
  courseIntegrationProviderById,
  courseIntegrationProviderForUrl,
  resolveCourseIntegrationLayout,
  type CourseIntegrationLayout,
  type CourseIntegrationProviderId,
} from "@/lib/content-blocks/integration-catalog";
import type { CourseChangeGroupKey } from "@/lib/course-change-log";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import type { CourseBuilderCopy } from "@/lib/i18n/course-builder";
import type { AppLocale } from "@/lib/i18n/model";
import { getCourseIntegrationCopy } from "@/lib/i18n/course-integrations";
import { getCourseContentCopyCopy } from "@/lib/i18n/course-content-copy";
import { getCourseBuilderActionMessage } from "@/lib/i18n/course-builder-actions";
import { useHydrated } from "@/lib/use-hydrated";

type BlockData = {
  agentId?: string;
  text?: string;
  richText?: RichTextDocument;
  button?: LinkButtonDocument;
  gallery?: GalleryDocument;
  callout?: CalloutDocument;
  quote?: QuoteDocument;
  divider?: DividerDocument;
  accordion?: AccordionDocument;
  tabs?: TabsDocument;
  columns?: ColumnsDocument;
  code?: CodeDocument;
  table?: TableDocument;
  download?: DownloadDocument;
  items?: string[];
  imageUrl?: string;
  videoUrl?: string;
  transcript?: VideoTranscriptDocument;
  videoEndCard?: VideoEndCard;
  videoPlayback?: VideoPlaybackPolicy;
  videoComposition?: VideoCompositionDocument;
  formId?: string;
  audioUrl?: string;
  fileUrl?: string;
  fileName?: string;
  mediaAssetId?: string;
  mediaAssetName?: string;
  embedUrl?: string;
  embedProvider?: CourseIntegrationProviderId;
  embedLayout?: CourseIntegrationLayout;
  caption?: string;
  options?: string[];
  correctOption?: number;
  correctOptions?: number[];
  acceptedAnswers?: string[];
  caseSensitive?: boolean;
  prompt?: string;
  feedback?: string;
  accent?: "navy" | "teal" | "coral" | "amber";
  stockImage?: {
    selectionId: string;
    provider: string;
    externalId: string;
    author: string;
    authorUrl?: string;
    sourceUrl: string;
    attribution: string;
  };
};
type Block = {
  id: string;
  type: string;
  title: string | null;
  sortOrder: number;
  required: boolean;
  data: BlockData;
  revision: number;
  style: {
    width: "compact" | "content" | "full";
    alignment: "left" | "center";
    surface: "plain" | "bordered" | "muted";
  };
};
type LessonPage = {
  id: string;
  title: string;
  titleSyncedWithLesson: boolean;
  sortOrder: number;
  status: string;
  revision: number;
  layoutWidth: "narrow" | "standard" | "wide";
  backgroundTone: "plain" | "soft" | "contrast";
  contentSpacing: "compact" | "comfortable" | "spacious";
  blocks: Block[];
};
type Lesson = {
  id: string;
  sectionId: string | null;
  title: string;
  type: string;
  durationMinutes: number;
  passingScore: number;
  maxAttempts: number | null;
  shuffleQuestions: boolean;
  examDurationSeconds: number | null;
  examQuestionPools: Array<{
    id: string;
    questionIds: string[];
    drawCount: number;
  }>;
  examResultReleaseMode: "immediate" | "after_deadline" | "manual";
  examReviewReleaseMode: "never" | "after_result" | "manual";
  examContentAccessMode: "allow" | "block_course" | "block_academy";
  sortOrder: number;
  status: string;
  visibility: "visible" | "draft" | "coming_soon";
  availableAt: Date | string | null;
  blocks: Block[];
  pages: LessonPage[];
};
type Section = {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
  status: string;
  visibility: "visible" | "draft" | "coming_soon";
  dripDays: number;
  unlockAfterPrevious: boolean;
};
type Module = {
  id: string;
  title: string;
  kind: "learning" | "exam" | "link";
  linkedCourseId: string | null;
  description: string | null;
  folder: string;
  isReusable: boolean;
  estimatedMinutes: number;
  sortOrder: number;
  indentLevel: number;
  accessMode:
    | "visible"
    | "after_previous"
    | "delay_days"
    | "date_window"
    | "coming_soon"
    | "locked"
    | "hidden";
  dripDays: number;
  delayPendingState: "locked" | "hidden";
  availableFrom: Date | string | null;
  availableUntil: Date | string | null;
  windowDefaultState: "available" | "read_only" | "locked" | "hidden";
  windowState: "available" | "read_only" | "locked" | "hidden";
  requestAccessEnabled: boolean;
  isRequired: boolean;
  usageCount: number;
  sections: Section[];
  lessons: Lesson[];
};
type BuilderData = {
  course: {
    id: string;
    categoryId: string | null;
    title: string;
    slug: string;
    description: string;
    shortDescription: string;
    coverImage: string | null;
    status: string;
    difficulty: string;
    estimatedMinutes: number;
    certificateEnabled: boolean;
    featured: boolean;
    visibleInCatalog: boolean;
    showProgressPercentage: boolean;
    notifyMembersOnModuleRelease: boolean;
    categoryName: string | null;
  };
  categories: Array<{ id: string; name: string }>;
  modules: Module[];
  availableModules: Array<{
    id: string;
    title: string;
    kind: "learning" | "exam" | "link";
    linkedCourseId: string | null;
    folder: string;
    estimatedMinutes: number;
    lessonCount: number;
    usageCount: number;
  }>;
  linkTargets: Array<{
    id: string;
    title: string;
    status: "draft" | "published" | "archived";
    visibleInCatalog: boolean;
  }>;
  copyTargets: Array<{
    id: string;
    title: string;
    modules: Array<{
      id: string;
      title: string;
      sections: Array<{ id: string; title: string }>;
    }>;
  }>;
  access: {
    total: number;
    active: number;
    inactive: number;
    completed: number;
    inProgress: number;
    notStarted: number;
    averageProgress: number;
    grants: { direct: number; groups: number; bundles: number; total: number };
  };
  statistics: {
    total: number;
    active: number;
    inactive: number;
    completed: number;
    inProgress: number;
    notStarted: number;
    averageProgress: number;
    submissions: { total: number; open: number; approved: number };
  };
  recentSubmissions: Array<{
    id: string;
    title: string;
    status: string;
    score: number | null;
    submittedAt: string;
    firstName: string;
    lastName: string;
  }>;
  dataForms: Array<{
    id: string;
    name: string;
    profileDefinitionId: string;
  }>;
  widgets: Array<{
    id: string;
    type: "author" | "info" | "image_link";
    sortOrder: number;
    authorUserId: string | null;
    authorRole: string | null;
    authorDescription: string | null;
    title: string | null;
    text: string | null;
    linkUrl: string | null;
    imageUrl: string | null;
    altText: string | null;
    author: {
      id: string;
      firstName: string;
      lastName: string;
      avatarUrl: string | null;
      jobTitle: string | null;
      bio: string | null;
    } | null;
  }>;
  widgetTeamMembers: Array<{
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    role: "owner" | "admin" | "trainer" | "member";
    status: "active" | "invited" | "disabled";
    jobTitle: string | null;
    bio: string | null;
  }>;
  learningGoals: Array<{
    id: string;
    text: string;
    sortOrder: number;
  }>;
  courseAuthors: Array<{
    id: string;
    userId: string;
    sortOrder: number;
    author: {
      id: string;
      firstName: string;
      lastName: string;
      avatarUrl: string | null;
      role: "owner" | "admin" | "trainer" | "member";
      status: "active" | "invited" | "disabled";
      jobTitle: string | null;
      bio: string | null;
    };
  }>;
};

type DialogState =
  | { kind: "module" }
  | { kind: "section"; moduleId: string }
  | { kind: "lesson"; moduleId: string }
  | {
      kind: "copy-section";
      sectionId: string;
      sourceTitle: string;
      sourceModuleId: string;
    }
  | {
      kind: "copy-lesson";
      lessonId: string;
      sourceTitle: string;
      sourceModuleId: string;
    }
  | { kind: "page"; lessonId: string }
  | { kind: "add-ai-agent"; lessonId: string; pageId: string | null }
  | { kind: "edit-block"; block: Block }
  | { kind: "delete-block"; block: Block }
  | null;

const tabs = [
  "content",
  "information",
  "widgets",
  "access",
  "analytics",
  "submissions",
] as const;
const paletteItems = [
  { type: "ai_agent", icon: Bot },
  { type: "heading", icon: Heading2 },
  { type: "text", icon: AlignLeft },
  { type: "rich_text", icon: TextQuote },
  { type: "button", icon: MousePointerClick },
  { type: "gallery", icon: Images },
  { type: "callout", icon: Info },
  { type: "quote", icon: TextQuote },
  { type: "divider", icon: AlignLeft },
  { type: "accordion", icon: ListChecks },
  { type: "tabs", icon: LayoutTemplate },
  { type: "columns", icon: Layers3 },
  { type: "code", icon: Braces },
  { type: "table", icon: Table2 },
  { type: "download", icon: FileDown },
  { type: "data_form", icon: ClipboardList },
  { type: "info", icon: Info },
  { type: "checklist", icon: ListChecks },
  { type: "image", icon: ImageIcon },
  { type: "video", icon: Video },
  { type: "audio", icon: AudioLines },
  { type: "file", icon: FileDown },
  { type: "embed", icon: Code2 },
  { type: "multiple_choice", icon: FileQuestion },
  { type: "true_false", icon: CircleHelp },
  { type: "multi_select", icon: ListChecks },
  { type: "fill_blank", icon: TextCursorInput },
  { type: "ordering", icon: ListOrdered },
  { type: "submission", icon: MessageSquareText },
] as const;
const examPaletteTypes = new Set([
  "heading",
  "text",
  "rich_text",
  "callout",
  "quote",
  "divider",
  "accordion",
  "tabs",
  "columns",
  "code",
  "table",
  "download",
  "info",
  "image",
  "video",
  "file",
  "multiple_choice",
  "true_false",
  "multi_select",
  "fill_blank",
  "ordering",
  "submission",
]);
const automaticAssessmentTypes = new Set([
  "multiple_choice",
  "true_false",
  "multi_select",
  "fill_blank",
  "ordering",
]);
const inputClass =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444] placeholder:text-[var(--theme-muted-text)]";
const textareaClass = cn(inputClass, "h-auto min-h-24 py-2.5 leading-6");

function dateTimeLocalValue(value: Date | string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-[10px] leading-4 text-[#87919a]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function CheckField({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md border border-[#dce1e5] bg-white px-3 text-xs font-semibold text-[#52606d]">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-4 accent-[#2bb7a9]"
      />
      {label}
    </label>
  );
}

function FormDialog({
  copy,
  title,
  eyebrow,
  pending,
  onClose,
  onSubmit,
  submitLabel,
  submitIcon,
  submitDisabled = false,
  children,
  secondary,
  width = "max-w-xl",
}: {
  copy: CourseBuilderCopy;
  title: string;
  eyebrow: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
  submitLabel: string;
  submitIcon?: ReactNode;
  submitDisabled?: boolean;
  children: ReactNode;
  secondary?: ReactNode;
  width?: string;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(new FormData(event.currentTarget));
  };
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-3 sm:p-5">
      <button
        type="button"
        onClick={onClose}
        disabled={pending}
        className="absolute inset-0 bg-[#0f263c]/50 backdrop-blur-[1px]"
        aria-label={copy.common.closeDialog}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative max-h-[92vh] w-full overflow-y-auto rounded-lg bg-white shadow-2xl",
          width,
        )}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[#e8ebee] bg-white px-4 py-3.5 sm:px-5">
          <div>
            <p className="text-[9px] font-bold uppercase text-[#2b9188]">
              {eyebrow}
            </p>
            <h2 className="text-base font-bold text-[#243444]">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="focus-ring grid size-9 shrink-0 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3] disabled:opacity-40"
            aria-label={copy.common.closeDialog}
          >
            <X className="size-4.5" />
          </button>
        </header>
        <form onSubmit={submit} className="p-4 sm:p-5">
          <div className="grid gap-4">{children}</div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[#edf0f2] pt-4">
            <div>{secondary}</div>
            <div className="ml-auto flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={pending}
              >
                {copy.common.cancel}
              </Button>
              <Button type="submit" disabled={pending || submitDisabled}>
                {pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  submitIcon
                )}
                {pending ? copy.common.saving : submitLabel}
              </Button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

function CopyTargetFields({
  targets,
  kind,
  locale,
  defaultCourseId,
  defaultModuleId,
}: {
  targets: BuilderData["copyTargets"];
  kind: "section" | "lesson";
  locale: AppLocale;
  defaultCourseId: string;
  defaultModuleId: string;
}) {
  const copy = getCourseContentCopyCopy(locale);
  const availableTargets = targets.filter((target) => target.modules.length > 0);
  const initialCourse =
    availableTargets.find((target) => target.id === defaultCourseId) ??
    availableTargets[0];
  const [courseId, setCourseId] = useState(initialCourse?.id ?? "");
  const currentCourse =
    availableTargets.find((target) => target.id === courseId) ??
    availableTargets[0];
  const initialModule =
    currentCourse?.modules.find((module) => module.id === defaultModuleId) ??
    currentCourse?.modules[0];
  const [moduleId, setModuleId] = useState(initialModule?.id ?? "");
  const currentModule =
    currentCourse?.modules.find((module) => module.id === moduleId) ??
    currentCourse?.modules[0];

  if (!availableTargets.length) {
    return (
      <p role="alert" className="rounded-md border border-[#e7c9c3] bg-[#fdf3f1] p-3 text-xs text-[#94483e]">
        {copy.noTargets}
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <Field label={copy.targetCourse}>
        <select
          name="targetCourseId"
          value={currentCourse?.id ?? ""}
          onChange={(event) => {
            const nextCourse = availableTargets.find(
              (target) => target.id === event.target.value,
            );
            setCourseId(event.target.value);
            setModuleId(nextCourse?.modules[0]?.id ?? "");
          }}
          required
          className={inputClass}
        >
          {availableTargets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label={copy.targetModule}>
        <select
          name="targetModuleId"
          value={currentModule?.id ?? ""}
          onChange={(event) => setModuleId(event.target.value)}
          required
          className={inputClass}
        >
          {currentCourse?.modules.map((module) => (
            <option key={module.id} value={module.id}>
              {module.title}
            </option>
          ))}
        </select>
      </Field>
      {kind === "lesson" ? (
        <Field label={copy.targetSection}>
          <select
            key={currentModule?.id}
            name="targetSectionId"
            defaultValue=""
            className={inputClass}
          >
            <option value="">{copy.noSection}</option>
            {currentModule?.sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
    </div>
  );
}

function ConfirmDeleteDialog({
  copy,
  block,
  pending,
  onClose,
  onConfirm,
}: {
  copy: CourseBuilderCopy;
  block: Block;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-3">
      <button
        type="button"
        onClick={onClose}
        disabled={pending}
        className="absolute inset-0 bg-[#0f263c]/55"
        aria-label={copy.common.closeDialog}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={copy.block.deleteDialogLabel}
        className="relative w-full max-w-md rounded-lg bg-white p-5 shadow-2xl"
      >
        <span className="grid size-10 place-items-center rounded-md bg-[#fdf0ee] text-[#c95b4f]">
          <Trash2 className="size-5" />
        </span>
        <h2 className="mt-4 text-base font-bold text-[#243444]">
          {copy.block.deleteTitle}
        </h2>
        <p className="mt-1 text-sm leading-6 text-[#66727f]">
          {copy.block.deleteDescription(
            block.title || copy.block.fallbackElement,
          )}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {copy.common.cancel}
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            {copy.common.delete}
          </Button>
        </div>
      </section>
    </div>
  );
}

function BlockEditorFields({
  block,
  courseId,
  dataForms,
  aiAgents,
  stockImagesEnabled,
  locale,
}: {
  block: Block;
  courseId: string;
  dataForms: BuilderData["dataForms"];
  aiAgents: CourseBuilderAiAgentOption[];
  stockImagesEnabled: boolean;
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).admin.courseEditor;
  const integrationCopy = getCourseIntegrationCopy(locale);
  const data = block.data;
  const detectedIntegrationProvider =
    courseIntegrationProviderForUrl(data.embedUrl) ??
    courseIntegrationProviderById(data.embedProvider) ??
    COURSE_INTEGRATION_PROVIDERS[0];
  const [embedProviderId, setEmbedProviderId] =
    useState<CourseIntegrationProviderId>(detectedIntegrationProvider.id);
  const [embedLayout, setEmbedLayout] = useState<CourseIntegrationLayout>(
    resolveCourseIntegrationLayout(
      data.embedLayout,
      detectedIntegrationProvider.id,
    ),
  );
  const embedProvider =
    courseIntegrationProviderById(embedProviderId) ??
    COURSE_INTEGRATION_PROVIDERS[0];
  const [options, setOptions] = useState(
    data.options ?? [copy.block.optionA, copy.block.optionB],
  );
  if (block.type === "ai_agent") {
    const currentIsAvailable = aiAgents.some(
      (agent) => agent.id === data.agentId,
    );
    return (
      <Field label={copy.block.agent}>
        <select
          name="agentId"
          defaultValue={data.agentId ?? ""}
          className={inputClass}
          required
          autoFocus
        >
          {!currentIsAvailable && data.agentId ? (
            <option value={data.agentId} disabled>
              {copy.block.previousAgentUnavailable}
            </option>
          ) : null}
          {!aiAgents.length && !data.agentId ? (
            <option value="" disabled>
              {copy.block.noPublishedAgent}
            </option>
          ) : null}
          {aiAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name} ({copy.common.version(agent.version)})
            </option>
          ))}
        </select>
      </Field>
    );
  }
  if (block.type === "rich_text") {
    return (
      <RichTextEditor
        name="richText"
        initialValue={data.richText}
        locale={locale}
      />
    );
  }
  if (block.type === "button") {
    return (
      <>
        <Field label={copy.block.label}>
          <input
            name="label"
            defaultValue={data.button?.label ?? copy.block.defaultLearnMore}
            maxLength={160}
            required
            className={inputClass}
            autoFocus
          />
        </Field>
        <Field label={copy.block.linkTarget} hint={copy.block.linkHint}>
          <input
            name="href"
            defaultValue={data.button?.href ?? "/academy/courses"}
            maxLength={2_000}
            required
            inputMode="url"
            className={inputClass}
          />
        </Field>
        <Field label={copy.block.display}>
          <select
            name="variant"
            defaultValue={data.button?.variant ?? "primary"}
            className={inputClass}
          >
            <option value="primary">{copy.block.primaryButton}</option>
            <option value="secondary">{copy.block.secondaryButton}</option>
            <option value="link">{copy.block.textLink}</option>
          </select>
        </Field>
      </>
    );
  }
  if (block.type === "gallery") {
    return <GalleryBlockEditor initialValue={data.gallery} locale={locale} />;
  }
  if (
    block.type === "callout" ||
    block.type === "quote" ||
    block.type === "divider" ||
    block.type === "accordion" ||
    block.type === "tabs" ||
    block.type === "columns" ||
    block.type === "code" ||
    block.type === "table"
  ) {
    const document =
      block.type === "callout"
        ? data.callout
        : block.type === "quote"
          ? data.quote
          : block.type === "divider"
            ? data.divider
            : block.type === "accordion"
              ? data.accordion
              : block.type === "tabs"
                ? data.tabs
                : block.type === "columns"
                  ? data.columns
                  : block.type === "code"
                    ? data.code
                    : data.table;
    return (
      <StructuredContentBlockEditor
        type={block.type}
        initialValue={document}
        locale={locale}
      />
    );
  }
  if (block.type === "download") {
    return (
      <>
        <Field label={copy.block.label}>
          <input
            name="label"
            defaultValue={
              data.download?.label ?? copy.block.defaultDownloadLabel
            }
            maxLength={220}
            required
            className={inputClass}
          />
        </Field>
        <Field label={copy.block.file} hint={copy.block.downloadAssetHint}>
          <CourseMediaSourceField
            locale={locale}
            courseId={courseId}
            kind="file"
            label={copy.block.download}
            defaultAssetId={data.download?.mediaAssetId}
            defaultFileName={data.download?.fileName}
            allowExternalUrl={false}
          />
        </Field>
        <Field label={copy.block.fileName}>
          <input
            name="fileName"
            defaultValue={
              data.download?.fileName ?? copy.block.defaultDownloadFileName
            }
            maxLength={500}
            required
            className={inputClass}
          />
        </Field>
        <Field label={copy.block.description}>
          <textarea
            name="description"
            defaultValue={data.download?.description ?? ""}
            maxLength={2000}
            className={textareaClass}
          />
        </Field>
      </>
    );
  }
  if (block.type === "data_form") {
    return (
      <>
        <Field label={copy.block.title}>
          <input
            name="title"
            defaultValue={block.title ?? copy.block.defaultForm}
            className={inputClass}
            autoFocus
            required
          />
        </Field>
        <Field label={copy.block.dataForm}>
          <select
            name="formId"
            defaultValue={data.formId ?? dataForms[0]?.id ?? ""}
            className={inputClass}
            required
          >
            {dataForms.length ? null : (
              <option value="" disabled>
                {copy.block.noActiveForm}
              </option>
            )}
            {dataForms.map((form) => (
              <option key={form.id} value={form.id}>
                {form.name}
              </option>
            ))}
          </select>
        </Field>
      </>
    );
  }
  if (
    block.type === "eyebrow" ||
    block.type === "heading" ||
    block.type === "text"
  ) {
    return (
      <Field
        label={
          block.type === "eyebrow"
            ? copy.block.kicker
            : block.type === "heading"
              ? copy.block.heading
              : copy.block.text
        }
      >
        <textarea
          name="text"
          defaultValue={data.text ?? ""}
          className={textareaClass}
          autoFocus
        />
      </Field>
    );
  }
  if (block.type === "info") {
    return (
      <>
        <Field label={copy.block.title}>
          <input
            name="title"
            defaultValue={block.title ?? copy.block.defaultInfo}
            className={inputClass}
            autoFocus
          />
        </Field>
        <Field label={copy.block.infoText}>
          <textarea
            name="text"
            defaultValue={data.text ?? ""}
            className={textareaClass}
          />
        </Field>
        <Field label={copy.block.accentColor}>
          <select
            name="accent"
            defaultValue={data.accent ?? "teal"}
            className={inputClass}
          >
            <option value="teal">{copy.block.teal}</option>
            <option value="navy">{copy.block.navy}</option>
            <option value="coral">{copy.block.coral}</option>
            <option value="amber">{copy.block.gold}</option>
          </select>
        </Field>
      </>
    );
  }
  if (block.type === "checklist") {
    return (
      <>
        <Field label={copy.block.title}>
          <input
            name="title"
            defaultValue={block.title ?? copy.block.defaultChecklist}
            className={inputClass}
            autoFocus
          />
        </Field>
        <Field
          label={copy.block.checklistItems}
          hint={copy.block.oneItemPerLine}
        >
          <textarea
            name="items"
            defaultValue={(data.items ?? []).join("\n")}
            className={textareaClass}
          />
        </Field>
        <CheckField
          name="required"
          label={copy.block.completionRequired}
          defaultChecked={block.required}
        />
      </>
    );
  }
  if (["image", "video", "audio", "file", "embed"].includes(block.type)) {
    const url =
      block.type === "image"
        ? data.imageUrl
        : block.type === "video"
          ? data.videoUrl
          : block.type === "audio"
            ? data.audioUrl
            : block.type === "file"
              ? data.fileUrl
              : data.embedUrl;
    const labels: Record<string, string> = copy.block.media;
    return (
      <>
        <Field label={copy.block.title}>
          <input
            name="title"
            defaultValue={block.title ?? labels[block.type]}
            className={inputClass}
            autoFocus
          />
        </Field>
        {block.type === "embed" ? (
          <>
            <Field
              label={integrationCopy.provider}
              hint={integrationCopy.providerHint}
            >
              <select
                name="embedProvider"
                value={embedProviderId}
                onChange={(event) => {
                  const next = courseIntegrationProviderById(
                    event.target.value,
                  );
                  if (!next) return;
                  setEmbedProviderId(next.id);
                  setEmbedLayout(next.defaultLayout);
                }}
                className={inputClass}
              >
                {COURSE_INTEGRATION_PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={copy.block.embedUrl}>
              <input
                name="url"
                type="url"
                required
                maxLength={2000}
                defaultValue={url ?? ""}
                placeholder={embedProvider.placeholder}
                className={inputClass}
              />
            </Field>
            <Field label={integrationCopy.layout}>
              <select
                name="embedLayout"
                value={embedLayout}
                onChange={(event) =>
                  setEmbedLayout(event.target.value as CourseIntegrationLayout)
                }
                className={inputClass}
              >
                {COURSE_INTEGRATION_LAYOUTS.map((layout) => (
                  <option key={layout} value={layout}>
                    {integrationCopy.layouts[layout]}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          <Field label={copy.block.mediaSource(labels[block.type])}>
            <CourseMediaSourceField
              locale={locale}
              courseId={courseId}
              kind={block.type as "image" | "video" | "audio" | "file"}
              label={labels[block.type]}
              defaultAssetId={data.mediaAssetId}
              defaultFileName={data.mediaAssetName}
              defaultUrl={url}
              defaultStockAttribution={data.stockImage?.attribution}
              stockImagesEnabled={stockImagesEnabled}
            />
          </Field>
        )}
        {block.type === "file" ? (
          <Field label={copy.block.fileName}>
            <input
              name="fileName"
              maxLength={500}
              defaultValue={data.fileName ?? copy.block.defaultCourseMaterial}
              className={inputClass}
            />
          </Field>
        ) : (
          <input type="hidden" name="fileName" value="" />
        )}
        <Field
          label={
            block.type === "image"
              ? copy.block.imageCaption
              : copy.block.description
          }
        >
          <textarea
            name="caption"
            maxLength={5000}
            defaultValue={data.caption ?? ""}
            className={textareaClass}
          />
        </Field>
        {block.type === "video" ? (
          <>
            <VideoTranscriptEditor
              transcript={data.transcript}
              endCard={data.videoEndCard}
              playbackPolicy={data.videoPlayback}
              composition={data.videoComposition}
              sourceUrl={data.videoUrl}
              courseId={courseId}
              locale={locale}
            />
            <TranscriptWizardControls
              courseId={courseId}
              blockId={block.id}
              locale={locale}
            />
          </>
        ) : null}
      </>
    );
  }
  if (block.type === "fill_blank") {
    return (
      <>
        <Field label={copy.block.title}>
          <input
            name="title"
            defaultValue={block.title ?? copy.block.defaultFillBlank}
            className={inputClass}
            autoFocus
          />
        </Field>
        <Field label={copy.block.gapQuestion}>
          <textarea
            name="prompt"
            defaultValue={data.prompt ?? ""}
            className={textareaClass}
          />
        </Field>
        <Field
          label={copy.block.acceptedAnswers}
          hint={copy.block.equivalentAnswerPerLine}
        >
          <textarea
            name="acceptedAnswers"
            defaultValue={(data.acceptedAnswers ?? []).join("\n")}
            className={textareaClass}
          />
        </Field>
        <CheckField
          name="caseSensitive"
          label={copy.block.caseSensitive}
          defaultChecked={data.caseSensitive === true}
        />
        <Field
          label={copy.block.evaluationFeedback}
          hint={copy.block.feedbackSecurity}
        >
          <textarea
            name="feedback"
            maxLength={2000}
            defaultValue={data.feedback ?? ""}
            className={textareaClass}
          />
        </Field>
        <CheckField
          name="required"
          label={copy.block.requiredToComplete}
          defaultChecked={block.required}
        />
      </>
    );
  }
  if (block.type === "ordering") {
    return (
      <>
        <Field label={copy.block.title}>
          <input
            name="title"
            defaultValue={block.title ?? copy.block.defaultOrdering}
            className={inputClass}
            autoFocus
          />
        </Field>
        <Field label={copy.block.task}>
          <textarea
            name="prompt"
            defaultValue={data.prompt ?? ""}
            className={textareaClass}
          />
        </Field>
        <Field label={copy.block.correctOrder} hint={copy.block.oneItemPerLine}>
          <textarea
            name="options"
            defaultValue={(data.options ?? []).join("\n")}
            className={textareaClass}
          />
        </Field>
        <Field
          label={copy.block.evaluationFeedback}
          hint={copy.block.feedbackSecurity}
        >
          <textarea
            name="feedback"
            maxLength={2000}
            defaultValue={data.feedback ?? ""}
            className={textareaClass}
          />
        </Field>
        <CheckField
          name="required"
          label={copy.block.requiredToComplete}
          defaultChecked={block.required}
        />
      </>
    );
  }
  if (block.type === "multi_select") {
    return (
      <>
        <Field label={copy.block.title}>
          <input
            name="title"
            defaultValue={block.title ?? copy.block.defaultMultiSelect}
            className={inputClass}
            autoFocus
          />
        </Field>
        <Field label={copy.block.question}>
          <textarea
            name="prompt"
            defaultValue={data.prompt ?? ""}
            className={textareaClass}
          />
        </Field>
        <Field
          label={copy.block.answerOptions}
          hint={copy.block.oneOptionPerLine}
        >
          <textarea
            name="options"
            value={options.join("\n")}
            onChange={(event) =>
              setOptions(
                event.target.value
                  .split(/\r?\n/)
                  .map((option) => option.trimStart()),
              )
            }
            className={textareaClass}
          />
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-[#52606d]">
            {copy.block.correctAnswers}
          </legend>
          {options.map((option, index) => (
            <label
              key={`${index}-${option}`}
              className="focus-within:ring-2 focus-within:ring-[#2b9188] flex min-h-10 items-center gap-3 rounded-md border border-[#dce1e5] px-3 text-sm text-[#354555]"
            >
              <input
                type="checkbox"
                name="correctOptions"
                value={index}
                defaultChecked={(data.correctOptions ?? []).includes(index)}
                className="size-4 accent-[#2b9188]"
              />
              {option || copy.block.option(index + 1)}
            </label>
          ))}
        </fieldset>
        <Field
          label={copy.block.evaluationFeedback}
          hint={copy.block.feedbackSecurity}
        >
          <textarea
            name="feedback"
            maxLength={2000}
            defaultValue={data.feedback ?? ""}
            className={textareaClass}
          />
        </Field>
        <CheckField
          name="required"
          label={copy.block.requiredToComplete}
          defaultChecked={block.required}
        />
      </>
    );
  }
  if (block.type === "multiple_choice" || block.type === "true_false") {
    const trueFalse = block.type === "true_false";
    const answerOptions = trueFalse
      ? [copy.block.true, copy.block.false]
      : options;
    return (
      <>
        <Field label={copy.block.title}>
          <input
            name="title"
            defaultValue={block.title ?? copy.block.defaultKnowledgeCheck}
            className={inputClass}
            autoFocus
          />
        </Field>
        <Field label={copy.block.question}>
          <textarea
            name="prompt"
            defaultValue={data.prompt ?? ""}
            className={textareaClass}
          />
        </Field>
        {trueFalse ? (
          <div
            className="grid grid-cols-2 gap-2"
            aria-label={copy.block.answerOptions}
          >
            {answerOptions.map((option) => (
              <div
                key={option}
                className="rounded-md border border-[#dce1e5] bg-[#f7f9fa] px-3 py-2.5 text-xs font-semibold text-[#52606d]"
              >
                {option}
              </div>
            ))}
          </div>
        ) : (
          <Field
            label={copy.block.answerOptions}
            hint={copy.block.oneOptionPerLine}
          >
            <textarea
              name="options"
              value={options.join("\n")}
              onChange={(event) =>
                setOptions(
                  event.target.value
                    .split(/\r?\n/)
                    .map((option) => option.trimStart()),
                )
              }
              className={textareaClass}
            />
          </Field>
        )}
        <Field label={copy.block.correctAnswer}>
          <select
            name="correctOption"
            defaultValue={String(data.correctOption ?? 0)}
            className={inputClass}
          >
            {answerOptions.map((option, index) => (
              <option key={`${index}-${option}`} value={index}>
                {index + 1}. {option || copy.block.option(index + 1)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={copy.block.evaluationFeedback}
          hint={copy.block.feedbackSecurity}
        >
          <textarea
            name="feedback"
            maxLength={2000}
            defaultValue={data.feedback ?? ""}
            className={textareaClass}
            placeholder={copy.block.feedbackPlaceholder}
          />
        </Field>
        <CheckField
          name="required"
          label={copy.block.requiredToComplete}
          defaultChecked={block.required}
        />
      </>
    );
  }
  return (
    <>
      <Field label={copy.block.title}>
        <input
          name="title"
          defaultValue={block.title ?? copy.block.defaultSubmission}
          className={inputClass}
          autoFocus
        />
      </Field>
      <Field label={copy.block.workAssignment}>
        <textarea
          name="prompt"
          defaultValue={data.prompt ?? ""}
          className={textareaClass}
        />
      </Field>
      <CheckField
        name="required"
        label={copy.block.submissionRequired}
        defaultChecked={block.required}
      />
    </>
  );
}

function BlockPreview({
  copy,
  locale,
  block,
  dataForms,
  aiAgents,
}: {
  copy: CourseBuilderCopy;
  locale: AppLocale;
  block: Block;
  dataForms: BuilderData["dataForms"];
  aiAgents: CourseBuilderAiAgentOption[];
}) {
  const data = block.data;
  if (block.type === "ai_agent") {
    const agent = aiAgents.find((candidate) => candidate.id === data.agentId);
    return (
      <div className="flex items-center gap-3 rounded-md border border-[#c9dedb] bg-[#f5fbfa] p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[#17324d] text-white">
          <Bot className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-[#243444]">
            {agent?.name ?? copy.block.unavailableAgent}
          </p>
          <p className="mt-0.5 truncate text-xs text-[#71808b]">
            {agent
              ? `${
                  agent.type === "learning_coach"
                    ? copy.block.learningCoach
                    : agent.type === "knowledge_assistant"
                      ? copy.block.knowledgeAssistant
                      : copy.block.formAssistant
                } | ${copy.common.version(agent.version)}`
              : copy.block.choosePublishedAgent}
          </p>
        </div>
      </div>
    );
  }
  if (block.type === "data_form") {
    const form = dataForms.find((candidate) => candidate.id === data.formId);
    return (
      <div className="flex items-center gap-3 rounded-md border border-[#cbd7e2] bg-[#f7f9fb] p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#e7eef5] text-[#365f8d]">
          <ClipboardList className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[#294f79]">
            {block.title ?? copy.block.defaultForm}
          </p>
          <p className="mt-0.5 truncate text-xs text-[#71808b]">
            {form?.name ?? copy.block.chooseDataForm}
          </p>
        </div>
      </div>
    );
  }
  if (block.type === "image") {
    return data.imageUrl ? (
      <figure>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={data.imageUrl}
          alt={block.title ?? data.caption ?? copy.block.defaultCourseImage}
          className="max-h-[520px] w-full rounded-md object-cover"
        />
        {data.caption ? (
          <figcaption className="mt-2 text-xs text-[#71808b]">
            {data.caption}
          </figcaption>
        ) : null}
      </figure>
    ) : (
      <div className="grid aspect-video place-items-center rounded-md bg-[#f1f4f6] text-xs text-[#7a8690]">
        {copy.block.missingImageUrl}
      </div>
    );
  }
  if (block.type === "video") {
    return data.videoUrl ? (
      <video
        src={data.videoUrl}
        controls
        preload="metadata"
        className="aspect-video w-full rounded-md bg-black"
      />
    ) : (
      <div className="grid aspect-video place-items-center rounded-md bg-[#17212b] text-xs text-white/70">
        {copy.block.missingVideoUrl}
      </div>
    );
  }
  if (block.type === "audio") {
    return (
      <div className="rounded-md border border-[#dfe4e8] p-4">
        <p className="mb-3 text-sm font-bold text-[#354555]">
          {block.title ?? copy.block.media.audio}
        </p>
        {data.audioUrl ? (
          <audio
            src={data.audioUrl}
            controls
            preload="metadata"
            className="w-full"
          />
        ) : (
          <p className="text-xs text-[#7a8690]">{copy.block.missingAudioUrl}</p>
        )}
      </div>
    );
  }
  if (block.type === "file") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-[#dfe4e8] p-4">
        <FileDown className="size-5 text-[#365f8d]" />
        <div>
          <p className="text-sm font-bold text-[#354555]">
            {data.fileName ?? block.title ?? copy.block.download}
          </p>
          <p className="mt-0.5 text-xs text-[#7a8690]">
            {data.fileUrl ? copy.block.linkedFile : copy.block.missingFileUrl}
          </p>
        </div>
      </div>
    );
  }
  if (block.type === "embed") {
    const provider =
      courseIntegrationProviderForUrl(data.embedUrl) ??
      courseIntegrationProviderById(data.embedProvider);
    const layout = resolveCourseIntegrationLayout(
      data.embedLayout,
      provider?.id,
    );
    return (
      <div className="overflow-hidden rounded-md border border-dashed border-[#b9c8d7] bg-[#f5f8fa]">
        <div className="flex items-center gap-3 p-4">
          <Code2 className="size-5 text-[#365f8d]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-[#354555]">
              {block.title ?? copy.block.embedPreview}
            </p>
            <p className="mt-0.5 truncate text-xs text-[#71808b]">
              {data.embedUrl ?? copy.block.missingEmbedUrl}
            </p>
          </div>
          {provider ? <Badge>{provider.name}</Badge> : null}
        </div>
        <div
          aria-hidden="true"
          className={cn(
            "w-full border-t border-[#dfe4e8] bg-white",
            courseIntegrationFrameClass(layout),
          )}
        />
      </div>
    );
  }
  if (block.type === "eyebrow") {
    return (
      <p className="text-[10px] font-bold uppercase text-[#2b9188]">
        {data.text || copy.block.kicker}
      </p>
    );
  }
  if (block.type === "heading") {
    return (
      <h3 className="text-2xl font-bold leading-tight text-[#17212b]">
        {data.text || copy.block.heading}
      </h3>
    );
  }
  if (block.type === "text") {
    return (
      <p className="whitespace-pre-wrap text-sm leading-7 text-[#52606d]">
        {data.text || copy.block.text}
      </p>
    );
  }
  if (block.type === "rich_text") {
    return (
      <RichTextContent
        document={data.richText}
        density="compact"
        className="py-1"
      />
    );
  }
  if (block.type === "button") {
    return <LinkButtonContent document={data.button} compact />;
  }
  if (block.type === "gallery") {
    return (
      <GalleryContent
        document={data.gallery}
        locale={locale}
        compact
        showEmpty
      />
    );
  }
  if (
    block.type === "callout" ||
    block.type === "quote" ||
    block.type === "divider" ||
    block.type === "accordion" ||
    block.type === "tabs" ||
    block.type === "columns" ||
    block.type === "download" ||
    block.type === "code" ||
    block.type === "table"
  ) {
    const document =
      block.type === "callout"
        ? data.callout
        : block.type === "quote"
          ? data.quote
          : block.type === "divider"
            ? data.divider
            : block.type === "accordion"
              ? data.accordion
              : block.type === "tabs"
                ? data.tabs
                : block.type === "columns"
                  ? data.columns
                  : block.type === "download"
                    ? data.download
                    : block.type === "code"
                      ? data.code
                      : data.table;
    return (
      <StructuredBlockContent
        type={block.type}
        document={document}
        locale={locale}
        compact
        showEmpty
      />
    );
  }
  if (block.type === "info") {
    return (
      <div className="rounded-md border-l-4 border-[#d6a536] bg-[#fbf6e7] p-4">
        <p className="text-xs font-bold text-[#6f5617]">
          {block.title || copy.block.defaultInfo}
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#6d603c]">
          {data.text}
        </p>
      </div>
    );
  }
  if (block.type === "checklist") {
    return (
      <div>
        <p className="mb-2 text-sm font-bold text-[#243444]">{block.title}</p>
        <div className="space-y-2">
          {(data.items ?? []).map((item, index) => (
            <div
              key={`${index}-${item}`}
              className="flex items-center gap-2 rounded-md border border-[#e3e7ea] p-3 text-sm text-[#52606d]"
            >
              <span className="size-4 rounded border border-[#bdc6cd]" />
              {item}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (
    block.type === "multiple_choice" ||
    block.type === "true_false" ||
    block.type === "multi_select"
  ) {
    const isCorrect = (index: number) =>
      block.type === "multi_select"
        ? (data.correctOptions ?? []).includes(index)
        : index === data.correctOption;
    return (
      <div className="rounded-md border border-[#dfe4e8] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-sm font-bold text-[#243444]">
            {data.prompt || block.title}
          </p>
          {block.required ? (
            <Badge tone="amber">{copy.block.required}</Badge>
          ) : null}
        </div>
        <div className="mt-3 space-y-2">
          {(data.options ?? []).map((option, index) => (
            <div
              key={`${index}-${option}`}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm",
                isCorrect(index)
                  ? "bg-[#e9f8f6] text-[#176f68]"
                  : "bg-[#f5f7f8] text-[#52606d]",
              )}
            >
              <span className="grid size-5 place-items-center rounded-full border border-current text-[10px]">
                {isCorrect(index) ? <Check className="size-3" /> : index + 1}
              </span>
              {option}
            </div>
          ))}
        </div>
        {data.feedback ? (
          <p className="mt-3 rounded-md bg-[#f4f7fa] px-3 py-2 text-xs leading-5 text-[#52606d]">
            <strong>{copy.block.feedbackPrefix}</strong> {data.feedback}
          </p>
        ) : null}
      </div>
    );
  }
  if (block.type === "fill_blank") {
    return (
      <div className="rounded-md border border-[#dfe4e8] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-sm font-bold text-[#243444]">
            {data.prompt || block.title}
          </p>
          {block.required ? (
            <Badge tone="amber">{copy.block.required}</Badge>
          ) : null}
        </div>
        <div className="mt-3 rounded-md border border-dashed border-[#aebbc5] bg-[#f7f9fa] px-3 py-2 text-sm text-[#71808b]">
          {copy.block.freeTextAnswer}
        </div>
        <p className="mt-2 text-xs text-[#66727f]">
          {copy.block.acceptedAnswerCount((data.acceptedAnswers ?? []).length)}
        </p>
      </div>
    );
  }
  if (block.type === "ordering") {
    return (
      <div className="rounded-md border border-[#dfe4e8] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-sm font-bold text-[#243444]">
            {data.prompt || block.title}
          </p>
          {block.required ? (
            <Badge tone="amber">{copy.block.required}</Badge>
          ) : null}
        </div>
        <ol className="mt-3 space-y-2">
          {(data.options ?? []).map((option, index) => (
            <li
              key={`${index}-${option}`}
              className="flex items-center gap-3 rounded-md bg-[#f5f7f8] px-3 py-2.5 text-sm text-[#52606d]"
            >
              <span className="grid size-5 place-items-center rounded border border-[#bdc6cd] text-[10px] font-bold">
                {index + 1}
              </span>
              {option}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (block.type === "submission") {
    return (
      <div className="rounded-md border border-dashed border-[#ee9f96] bg-[#fdf5f3] p-5 text-center">
        <MessageSquareText className="mx-auto size-5 text-[#c95b4f]" />
        <p className="mt-2 text-sm font-bold text-[#6f332e]">{block.title}</p>
        <p className="mt-1 text-xs text-[#8b5b55]">{data.prompt}</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-[#e3e7ea] p-3 text-xs text-[#66727f]">
      {block.type}
    </div>
  );
}

function SortableBlock({
  copy,
  locale,
  block,
  pending,
  dataForms,
  aiAgents,
  onEdit,
  onDuplicate,
}: {
  copy: CourseBuilderCopy;
  locale: AppLocale;
  block: Block;
  pending: boolean;
  dataForms: BuilderData["dataForms"];
  aiAgents: CourseBuilderAiAgentOption[];
  onEdit: () => void;
  onDuplicate: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group relative rounded-sm pr-10 outline-none hover:ring-1 hover:ring-[#b8ddd9] focus-within:ring-1 focus-within:ring-[#b8ddd9]",
        isDragging &&
          "z-20 bg-white opacity-80 shadow-xl ring-1 ring-[#2b9188]",
      )}
    >
      <BlockPreview
        copy={copy}
        locale={locale}
        block={block}
        dataForms={dataForms}
        aiAgents={aiAgents}
      />
      <div className="absolute right-1 top-1 flex flex-col gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <button
          type="button"
          disabled={pending}
          className="focus-ring grid size-7 touch-none cursor-grab place-items-center rounded-md border border-[#dce1e5] bg-white text-[#75818b] shadow-sm active:cursor-grabbing"
          aria-label={`${block.title || block.type}: ${copy.block.move}`}
          title={copy.block.move}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onEdit}
          disabled={pending}
          className="focus-ring grid size-7 place-items-center rounded-md border border-[#dce1e5] bg-white text-[#75818b] shadow-sm hover:text-[#176f68]"
          aria-label={`${block.title || block.type}: ${copy.common.edit}`}
          title={copy.dialogs.editBlock}
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          disabled={pending}
          className="focus-ring grid size-7 place-items-center rounded-md border border-[#dce1e5] bg-white text-[#75818b] shadow-sm hover:text-[#365f8d]"
          aria-label={`${block.title || block.type}: ${copy.block.duplicate}`}
          title={copy.block.duplicate}
        >
          <Copy className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-[#e1e5e8] bg-white p-4">
      <p className="text-[10px] font-bold uppercase text-[#7d8891]">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[#1d2b38]">{value}</p>
      <p className="mt-1 text-[11px] text-[#74818c]">{detail}</p>
    </div>
  );
}

function lessonIcon(type: string) {
  if (type === "quiz" || type === "exam")
    return <FileQuestion className="size-3.5" />;
  if (type === "assignment") return <CheckSquare className="size-3.5" />;
  return <CirclePlay className="size-3.5" />;
}

function preferredPageId(lesson: Lesson | undefined) {
  if (!lesson || lesson.blocks.length) return null;
  return lesson.pages.find((page) => page.blocks.length)?.id ?? null;
}

function NewLessonPageFields({
  copy,
  lessonTitle,
  canSync,
}: {
  copy: CourseBuilderCopy;
  lessonTitle: string;
  canSync: boolean;
}) {
  const [title, setTitle] = useState(lessonTitle);
  const [synced, setSynced] = useState(canSync);
  return (
    <>
      <Field
        label={copy.structure.pageTitle}
        hint={copy.structure.pageNavigationHint}
      >
        <input
          name="title"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            if (event.target.value !== lessonTitle) setSynced(false);
          }}
          className={inputClass}
          autoFocus
          required
        />
      </Field>
      {canSync ? (
        <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md border border-[#dce1e5] bg-white px-3 text-xs font-semibold text-[#52606d]">
          <input type="hidden" name="titleSyncedWithLesson" value="false" />
          <input
            type="checkbox"
            name="titleSyncedWithLesson"
            value="true"
            checked={synced}
            onChange={(event) => setSynced(event.target.checked)}
            className="size-4 accent-[#2bb7a9]"
          />
          {copy.structure.syncLessonTitle}
        </label>
      ) : null}
    </>
  );
}

function NewModuleFields({
  copy,
  linkTargets,
}: {
  copy: CourseBuilderCopy;
  linkTargets: BuilderData["linkTargets"];
}) {
  const [kind, setKind] = useState<Module["kind"]>("learning");
  return (
    <>
      <fieldset>
        <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
          {copy.structure.moduleType}
        </span>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            {
              value: "learning" as const,
              label: copy.structure.learningModule,
              icon: Layers3,
            },
            {
              value: "exam" as const,
              label: copy.structure.exam,
              icon: FileQuestion,
            },
            {
              value: "link" as const,
              label: copy.structure.courseLink,
              icon: Link2,
            },
          ].map((option) => {
            const Icon = option.icon;
            return (
              <label
                key={option.value}
                className="focus-within:ring-2 focus-within:ring-[#2b9188] has-[:checked]:border-[#2b9188] has-[:checked]:bg-[#edf9f7] flex min-h-12 cursor-pointer items-center gap-2 rounded-md border border-[#dce1e5] bg-white px-3 transition-colors"
              >
                <input
                  name="kind"
                  type="radio"
                  value={option.value}
                  checked={kind === option.value}
                  onChange={() => setKind(option.value)}
                  className="peer sr-only"
                />
                <Icon className="size-4 shrink-0 text-[#536577] peer-checked:text-[#167e74]" />
                <span className="min-w-0 text-xs font-bold text-[#354555]">
                  {option.label}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {kind === "link" ? (
        <Field
          label={copy.structure.targetCourse}
          hint={copy.structure.targetCourseHint}
        >
          <select
            name="linkedCourseId"
            className={inputClass}
            required
            defaultValue=""
          >
            <option value="" disabled>
              {copy.structure.chooseTargetCourse}
            </option>
            {linkTargets.map((target) => (
              <option
                key={target.id}
                value={target.id}
                disabled={target.status === "archived"}
              >
                {target.title} (
                {target.status === "published"
                  ? copy.common.active
                  : target.status === "draft"
                    ? copy.common.draft
                    : copy.common.archived}
                )
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field
        label={
          kind === "link"
            ? copy.structure.linkTitle
            : copy.structure.moduleTitle
        }
      >
        <input name="title" className={inputClass} autoFocus required />
      </Field>
      <Field label={copy.structure.description}>
        <textarea name="description" className={textareaClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={copy.structure.folder}>
          <input
            name="folder"
            defaultValue={copy.structure.defaultFolder}
            className={inputClass}
          />
        </Field>
        <Field label={copy.structure.durationMinutes}>
          <input
            name="estimatedMinutes"
            type="number"
            min={1}
            defaultValue={kind === "link" ? 1 : 30}
            className={inputClass}
          />
        </Field>
      </div>
      <CheckField name="isReusable" label={copy.structure.reusableModule} />
    </>
  );
}

export function CourseBuilder({
  data,
  changeGroups = [],
  canViewGlobalAnalytics,
  stockImagesEnabled,
  locale,
}: {
  data: BuilderData;
  changeGroups?: CourseChangeGroupKey[];
  canViewGlobalAnalytics: boolean;
  stockImagesEnabled: boolean;
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).admin.courseEditor;
  const copyToCopy = getCourseContentCopyCopy(locale);
  const palette = paletteItems.map((item) => ({
    ...item,
    label: copy.palette[item.type],
  }));
  const firstLesson = data.modules.flatMap((module) => module.lessons)[0];
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("content");
  const [selectedModuleId, setSelectedModuleId] = useState(
    data.modules[0]?.id ?? "",
  );
  const [selectedLessonId, setSelectedLessonId] = useState(
    firstLesson?.id ?? "",
  );
  const [selectedPageId, setSelectedPageId] = useState<string | null>(
    preferredPageId(firstLesson),
  );
  const [dialog, setDialog] = useState<DialogState>(null);
  const [aiAgents, setAiAgents] = useState<CourseBuilderAiAgentOption[]>([]);
  const [aiAgentsLoading, setAiAgentsLoading] = useState(true);
  const [aiAgentsError, setAiAgentsError] = useState<string | null>(null);
  const [reusableModuleId, setReusableModuleId] = useState("");
  const [revisionConflict, setRevisionConflict] = useState<string | null>(null);
  const [blockOrder, setBlockOrder] = useState<{
    scope: string;
    ids: string[];
  }>({ scope: "", ids: [] });
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const router = useRouter();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    let cancelled = false;
    void listCourseBuilderPublishedAiAgentsAction(data.course.id)
      .then((result) => {
        if (cancelled) return;
        setAiAgents(result.agents);
        setAiAgentsError(
          result.ok
            ? null
            : getCourseBuilderActionMessage(locale, result.code),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setAiAgents([]);
        setAiAgentsError(copy.structure.agentsLoadError);
      })
      .finally(() => {
        if (!cancelled) setAiAgentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [copy.structure.agentsLoadError, data.course.id, locale]);

  const selectedModule = useMemo(
    () =>
      data.modules.find((module) => module.id === selectedModuleId) ??
      data.modules[0],
    [data.modules, selectedModuleId],
  );
  const selectedLesson = useMemo(
    () =>
      data.modules
        .flatMap((module) => module.lessons)
        .find((lesson) => lesson.id === selectedLessonId),
    [data.modules, selectedLessonId],
  );
  const selectedPage = selectedLesson?.pages.find(
    (page) => page.id === selectedPageId,
  );
  const selectedPageIsFirst = Boolean(
    selectedPage && selectedLesson?.pages[0]?.id === selectedPage.id,
  );
  const activeBlocks = useMemo(
    () => (selectedPage ? selectedPage.blocks : (selectedLesson?.blocks ?? [])),
    [selectedLesson, selectedPage],
  );
  const selectedLessonHasAssessment = Boolean(
    selectedLesson &&
    (selectedLesson.type === "quiz" ||
      selectedLesson.type === "exam" ||
      [
        ...selectedLesson.blocks,
        ...selectedLesson.pages.flatMap((page) => page.blocks),
      ].some((block) =>
        [
          "multiple_choice",
          "true_false",
          "multi_select",
          "fill_blank",
          "ordering",
        ].includes(block.type),
      )),
  );
  const selectedModuleIsExam = selectedModule?.kind === "exam";
  const selectedLessonIsExam = Boolean(
    selectedModuleIsExam && selectedLesson?.type === "exam",
  );
  const selectedModuleIsLink = selectedModule?.kind === "link";
  const selectedLinkTarget = selectedModuleIsLink
    ? data.linkTargets.find(
        (target) => target.id === selectedModule?.linkedCourseId,
      )
    : undefined;
  const selectedLessonBlocks = selectedLesson
    ? [
        ...selectedLesson.blocks,
        ...selectedLesson.pages.flatMap((page) => page.blocks),
      ]
    : [];
  const examGradableBlocks = selectedLessonBlocks.filter((block) =>
    [
      "multiple_choice",
      "true_false",
      "multi_select",
      "fill_blank",
      "ordering",
      "submission",
    ].includes(block.type),
  );
  const examPoolQuestionBlocks = selectedLesson
    ? [
        ...selectedLesson.blocks,
        ...selectedLesson.pages
          .filter((page) => page.status === "published")
          .flatMap((page) => page.blocks),
      ].filter((block) => automaticAssessmentTypes.has(block.type))
    : [];
  const configuredRandomQuestionCount = selectedLessonIsExam
    ? selectedLesson?.examQuestionPools.reduce(
        (total, pool) => total + pool.drawCount,
        0,
      ) || ""
    : "";
  const availablePalette = selectedModuleIsLink
    ? []
    : selectedModuleIsExam
      ? palette.filter((item) => examPaletteTypes.has(item.type))
      : palette;
  const serverBlockIds = activeBlocks.map((block) => block.id);
  const blockScope = `${selectedLesson?.id ?? "none"}:${selectedPageId ?? "root"}:${serverBlockIds.join(",")}`;
  const orderMatches =
    blockOrder.scope === blockScope &&
    blockOrder.ids.length === activeBlocks.length &&
    blockOrder.ids.every((id) => activeBlocks.some((block) => block.id === id));
  const orderedBlocks = orderMatches
    ? blockOrder.ids
        .map((id) => activeBlocks.find((block) => block.id === id))
        .filter((block): block is Block => Boolean(block))
    : activeBlocks;
  const totalLessons = data.modules.reduce(
    (sum, module) => sum + module.lessons.length,
    0,
  );
  const totalPages = data.modules.reduce(
    (sum, module) =>
      sum +
      module.lessons.reduce(
        (lessonSum, lesson) => lessonSum + lesson.pages.length,
        0,
      ),
    0,
  );
  const reusableCandidates = data.availableModules.filter(
    (module) =>
      module.kind !== "link" || module.linkedCourseId !== data.course.id,
  );
  const reusableSelection = reusableCandidates.some(
    (module) => module.id === reusableModuleId,
  )
    ? reusableModuleId
    : (reusableCandidates[0]?.id ?? "");
  const changedTabs = new Set<string>(
    changeGroups.map((group) => {
      if (["course", "goals", "authors"].includes(group)) return "information";
      if (group === "widgets") return "widgets";
      if (group === "access") return "access";
      return "content";
    }),
  );

  const runMutation = (
    task: () => Promise<CourseBuilderActionResult>,
    after?: (result: CourseBuilderActionResult) => void,
  ) => {
    startTransition(async () => {
      try {
        const result = await task();
        const message = getCourseBuilderActionMessage(locale, result.code);
        if (!result.ok) {
          if (result.reason === "revision_conflict") {
            setRevisionConflict(message);
          }
          toast.error(message);
          return;
        }
        toast.success(message);
        setRevisionConflict(null);
        after?.(result);
        router.refresh();
      } catch {
        toast.error(copy.structure.saveError);
      }
    });
  };

  const chooseLesson = (moduleId: string, lessonId: string) => {
    const lesson = data.modules
      .flatMap((module) => module.lessons)
      .find((item) => item.id === lessonId);
    setSelectedModuleId(moduleId);
    setSelectedLessonId(lessonId);
    setSelectedPageId(preferredPageId(lesson));
  };

  const addBlock = (type: string) => {
    if (!selectedLesson) return;
    if (type === "ai_agent") {
      setDialog({
        kind: "add-ai-agent",
        lessonId: selectedLesson.id,
        pageId: selectedPageId,
      });
      return;
    }
    runMutation(() =>
      addCourseContentBlockAction(
        data.course.id,
        selectedLesson.id,
        selectedPageId,
        type,
        undefined,
        locale,
      ),
    );
  };

  const finishBlockDrag = (event: DragEndEvent) => {
    if (!selectedLesson || !event.over || event.active.id === event.over.id)
      return;
    const previousIds = orderedBlocks.map((block) => block.id);
    const oldIndex = previousIds.indexOf(String(event.active.id));
    const newIndex = previousIds.indexOf(String(event.over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const nextIds = arrayMove(previousIds, oldIndex, newIndex);
    setBlockOrder({ scope: blockScope, ids: nextIds });
    runMutation(async () => {
      const result = await reorderCourseContentBlocksAction(
        data.course.id,
        selectedLesson.id,
        selectedPageId,
        nextIds,
      );
      if (!result.ok) setBlockOrder({ scope: blockScope, ids: previousIds });
      return result;
    });
  };

  const changeModuleIndent = (moduleIndex: number, delta: -1 | 1) => {
    const next = data.modules.map((learningModule, index) => ({
      moduleId: learningModule.id,
      sortOrder: index,
      indentLevel: learningModule.indentLevel,
    }));
    const previousLevel =
      moduleIndex > 0 ? next[moduleIndex - 1].indentLevel : 0;
    next[moduleIndex].indentLevel = Math.max(
      0,
      Math.min(3, previousLevel + 1, next[moduleIndex].indentLevel + delta),
    );
    for (let index = 0; index < next.length; index += 1) {
      next[index].indentLevel =
        index === 0
          ? 0
          : Math.min(next[index].indentLevel, next[index - 1].indentLevel + 1);
    }
    runMutation(() => updateCourseModuleOutlineAction(data.course.id, next));
  };

  const removeModule = (learningModule: Module) => {
    if (
      !window.confirm(
        `${copy.structure.removeFromCourse}: "${learningModule.title}"?`,
      )
    ) {
      return;
    }
    runMutation(
      () => detachCourseModuleAction(data.course.id, learningModule.id),
      () => {
        if (selectedModuleId === learningModule.id) {
          setSelectedModuleId("");
          setSelectedLessonId("");
          setSelectedPageId(null);
        }
      },
    );
  };

  return (
    <div className="panel overflow-hidden">
      <div
        className="grid grid-cols-3 border-b border-[#e5e8eb] bg-white px-1.5 pt-2 sm:flex sm:gap-2 sm:overflow-x-auto sm:px-4"
        role="tablist"
        aria-label={copy.editorAreas}
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-label={copy.tabs[tab]}
            aria-selected={activeTab === tab}
            disabled={!hydrated}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "focus-ring relative h-11 min-w-0 rounded-t px-1 text-xs font-semibold sm:w-auto sm:shrink-0 sm:px-4 sm:last:mr-2",
              activeTab === tab
                ? "text-[#17324d]"
                : "text-[#7a8690] hover:bg-[#f5f6f7]",
            )}
          >
            {changedTabs.has(tab) ? (
              <span
                className="absolute right-0.5 top-1 grid size-3 place-items-center text-[#4b7ca4] sm:right-1.5"
                role="img"
                aria-label={copy.unpublishedChanges(copy.tabs[tab])}
                title={copy.unpublishedChanges(copy.tabs[tab])}
              >
                <Pencil className="size-2.5" aria-hidden="true" />
              </span>
            ) : null}
            <span aria-hidden="true" className="block whitespace-nowrap">
              {copy.tabs[tab]}
            </span>
            {activeTab === tab ? (
              <span className="absolute inset-x-2 bottom-0 h-0.5 bg-[#2bb7a9]" />
            ) : null}
          </button>
        ))}
      </div>

      {activeTab === "content" ? (
        <div className="grid min-h-[720px] xl:grid-cols-[310px_minmax(0,1fr)_248px]">
          <aside className="border-b border-[#e5e8eb] bg-[#fafbfb] xl:border-b-0 xl:border-r">
            <div className="flex items-center justify-between border-b border-[#e8ebee] px-4 py-3">
              <div>
                <p className="text-xs font-bold text-[#243444]">
                  {copy.courseStructure}
                </p>
                <p className="mt-0.5 text-[10px] text-[#7d8891]">
                  {copy.structureSummary(data.modules.length, totalLessons)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDialog({ kind: "module" })}
                className="focus-ring grid size-8 place-items-center rounded-md text-[#66727f] hover:bg-white"
                title={copy.createModule}
                aria-label={copy.createModule}
              >
                <Plus className="size-4" />
              </button>
            </div>
            <div className="max-h-[660px] space-y-2 overflow-y-auto p-3">
              {data.modules.map((module, moduleIndex) => {
                const unsectioned = module.lessons.filter(
                  (lesson) => !lesson.sectionId,
                );
                return (
                  <section
                    key={module.id}
                    className="overflow-hidden rounded-md border border-[#e1e5e8] bg-white"
                    style={{
                      marginInlineStart: `${Math.min(module.indentLevel, 3) * 12}px`,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedModuleId(module.id)}
                      className={cn(
                        "focus-ring flex w-full items-start gap-2 border-b border-[#edf0f2] p-3 text-left",
                        selectedModule?.id === module.id
                          ? "bg-[#f2f9f8]"
                          : "hover:bg-[#fafbfb]",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-7 shrink-0 place-items-center rounded-md",
                          module.kind === "exam"
                            ? "bg-[#fcefeb] text-[#a34d3f]"
                            : module.kind === "link"
                              ? "bg-[#eef6fb] text-[#365f8d]"
                              : "bg-[#eef3f5] text-[#47606f]",
                        )}
                      >
                        {module.kind === "exam" ? (
                          <FileQuestion className="size-3.5" />
                        ) : module.kind === "link" ? (
                          <Link2 className="size-3.5" />
                        ) : (
                          <Layers3 className="size-3.5" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[9px] font-bold uppercase text-[#7f8a93]">
                          {module.kind === "exam"
                            ? copy.structure.examSection
                            : module.kind === "link"
                              ? copy.structure.courseLink
                              : `${copy.common.module} ${moduleIndex + 1}`}
                        </span>
                        <span className="mt-0.5 block text-xs font-bold leading-4 text-[#2b3a48]">
                          {module.title}
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[9px] text-[#87919a]">
                          {module.usageCount > 1 ? (
                            <span className="flex items-center gap-1 font-semibold text-[#2b9188]">
                              <Share2 className="size-3" />
                              {copy.structure.sharedInCourses(
                                module.usageCount,
                              )}
                            </span>
                          ) : module.isReusable ? (
                            <span>{copy.structure.reusable}</span>
                          ) : null}
                          {module.kind !== "link" ? (
                            <span>
                              {formatDuration(module.estimatedMinutes, locale)}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                    <div className="flex min-h-9 items-center justify-between border-b border-[#edf0f2] px-2 py-1">
                      <span className="px-1 text-[9px] font-semibold text-[#87919a]">
                        {copy.structure.level(module.indentLevel)}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => changeModuleIndent(moduleIndex, -1)}
                          disabled={pending || module.indentLevel === 0}
                          className="focus-ring grid size-7 place-items-center rounded text-[#71808b] hover:bg-[#f3f5f6] disabled:opacity-30"
                          aria-label={`${module.title}: ${copy.structure.outdent}`}
                          title={copy.structure.outdent}
                        >
                          <IndentDecrease className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => changeModuleIndent(moduleIndex, 1)}
                          disabled={
                            pending ||
                            moduleIndex === 0 ||
                            module.indentLevel >= 3 ||
                            module.indentLevel >=
                              data.modules[moduleIndex - 1].indentLevel + 1
                          }
                          className="focus-ring grid size-7 place-items-center rounded text-[#71808b] hover:bg-[#f3f5f6] disabled:opacity-30"
                          aria-label={`${module.title}: ${copy.structure.indent}`}
                          title={copy.structure.indent}
                        >
                          <IndentIncrease className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeModule(module)}
                          disabled={pending}
                          className="focus-ring grid size-7 place-items-center rounded text-[#8b6662] hover:bg-[#fdf0ee] disabled:opacity-30"
                          aria-label={`${module.title}: ${copy.structure.removeFromCourse}`}
                          title={copy.structure.removeFromCourse}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="p-1.5">
                      {module.sections.map((section) => {
                        const sectionLessons = module.lessons.filter(
                          (lesson) => lesson.sectionId === section.id,
                        );
                        return (
                          <div key={section.id} className="mb-1.5">
                            <div className="flex items-center gap-2 px-2.5 py-1.5 text-[9px] font-bold uppercase text-[#7b8790]">
                              <ChevronRight className="size-3" />
                              <span className="min-w-0 flex-1 truncate">
                                {section.title}
                              </span>
                              <span>{sectionLessons.length}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setDialog({
                                    kind: "copy-section",
                                    sectionId: section.id,
                                    sourceTitle: section.title,
                                    sourceModuleId: module.id,
                                  })
                                }
                                disabled={pending}
                                aria-label={`${copyToCopy.copySection}: ${section.title}`}
                                title={copyToCopy.copySection}
                                className="focus-ring grid size-6 shrink-0 place-items-center rounded text-[#66727f] hover:bg-[#e9eef1] disabled:opacity-40"
                              >
                                <Copy className="size-3" />
                              </button>
                            </div>
                            {sectionLessons.map((lesson) => (
                              <button
                                key={lesson.id}
                                type="button"
                                onClick={() =>
                                  chooseLesson(module.id, lesson.id)
                                }
                                className={cn(
                                  "focus-ring flex w-full items-center gap-2 rounded px-2.5 py-2 text-left",
                                  selectedLessonId === lesson.id
                                    ? "bg-[#e9f5f4] text-[#176f68]"
                                    : "text-[#596671] hover:bg-[#f3f5f6]",
                                )}
                              >
                                <span className="grid size-6 shrink-0 place-items-center rounded bg-white shadow-sm">
                                  {lessonIcon(lesson.type)}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                                  {lesson.title}
                                </span>
                                {lesson.pages.length ? (
                                  <span
                                    className="shrink-0 whitespace-nowrap text-[9px] text-[#596671]"
                                    title={copy.common.pages(
                                      lesson.pages.length,
                                    )}
                                  >
                                    {copy.common.pages(lesson.pages.length)}
                                  </span>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        );
                      })}
                      {unsectioned.length ? (
                        <div className="mb-1.5">
                          <div className="px-2.5 py-1.5 text-[9px] font-bold uppercase text-[#7b8790]">
                            {module.kind === "exam"
                              ? copy.structure.examSection
                              : copy.structure.noSection}
                          </div>
                          {unsectioned.map((lesson) => (
                            <button
                              key={lesson.id}
                              type="button"
                              onClick={() => chooseLesson(module.id, lesson.id)}
                              className={cn(
                                "focus-ring flex w-full items-center gap-2 rounded px-2.5 py-2 text-left",
                                selectedLessonId === lesson.id
                                  ? "bg-[#e9f5f4] text-[#176f68]"
                                  : "text-[#596671] hover:bg-[#f3f5f6]",
                              )}
                            >
                              <span className="grid size-6 shrink-0 place-items-center rounded bg-white shadow-sm">
                                {lessonIcon(lesson.type)}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                                {lesson.title}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {module.kind === "learning" ? (
                        <div className="mt-1 grid grid-cols-2 gap-1 border-t border-[#edf0f2] pt-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedModuleId(module.id);
                              setDialog({
                                kind: "section",
                                moduleId: module.id,
                              });
                            }}
                            className="focus-ring flex items-center justify-center gap-1 rounded px-2 py-2 text-[9px] font-semibold text-[#71808b] hover:bg-[#f3f5f6]"
                            aria-label={`${copy.dialogs.createSection}: ${module.title}`}
                          >
                            <Plus className="size-3" />
                            {copy.common.section}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedModuleId(module.id);
                              setDialog({
                                kind: "lesson",
                                moduleId: module.id,
                              });
                            }}
                            className="focus-ring flex items-center justify-center gap-1 rounded px-2 py-2 text-[9px] font-semibold text-[#71808b] hover:bg-[#f3f5f6]"
                            aria-label={`${copy.dialogs.createLesson}: ${module.title}`}
                          >
                            <Plus className="size-3" />
                            {copy.common.lesson}
                          </button>
                        </div>
                      ) : module.kind === "link" ? (
                        <div className="mt-1 flex items-center gap-2 border-t border-[#edf0f2] px-2.5 py-2 text-[9px] font-semibold text-[#365f8d]">
                          <Link2 className="size-3" />
                          <span className="min-w-0 truncate">
                            {data.linkTargets.find(
                              (target) => target.id === module.linkedCourseId,
                            )?.title ?? copy.structure.targetCourse}
                          </span>
                        </div>
                      ) : (
                        <div className="mt-1 border-t border-[#edf0f2] px-2.5 py-2 text-[9px] font-semibold text-[#a34d3f]">
                          {copy.structure.focusedExam}
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
              {!data.modules.length ? (
                <div className="rounded-md border border-dashed border-[#cfd6db] px-4 py-8 text-center">
                  <Layers3 className="mx-auto size-7 text-[#9aa4ac]" />
                  <p className="mt-2 text-xs font-semibold text-[#52606d]">
                    {copy.structure.noModule}
                  </p>
                  <Button
                    size="sm"
                    className="mt-3"
                    onClick={() => setDialog({ kind: "module" })}
                  >
                    <Plus className="size-3.5" />
                    {copy.structure.createFirstModule}
                  </Button>
                </div>
              ) : null}
            </div>
          </aside>

          <section className="min-w-0 bg-[#f1f3f5] p-3 sm:p-4 md:p-6">
            {selectedLesson ? (
              <div className="mx-auto max-w-3xl">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-[#75818b]">
                      {copy.structure.editor}
                    </p>
                    <h2 className="mt-0.5 text-sm font-bold text-[#243444]">
                      {selectedLesson.title}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedModuleIsExam ? (
                      <Badge tone="coral">
                        <FileQuestion className="mr-1 size-3" />
                        {copy.structure.examSection}
                      </Badge>
                    ) : null}
                    {selectedModule && selectedModule.usageCount > 1 ? (
                      <Badge tone="teal">
                        <Share2 className="mr-1 size-3" />
                        {copy.structure.sharedModule}
                      </Badge>
                    ) : null}
                    {selectedModule ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setDialog({
                            kind: "copy-lesson",
                            lessonId: selectedLesson.id,
                            sourceTitle: selectedLesson.title,
                            sourceModuleId: selectedModule.id,
                          })
                        }
                        disabled={pending}
                        title={copyToCopy.copyLesson}
                      >
                        <Copy className="size-3.5" />
                        {copyToCopy.copyLesson}
                      </Button>
                    ) : null}
                    <Link
                      href={`/admin/courses/${data.course.id}/preview?lesson=${selectedLesson.id}`}
                      className={buttonClassName({
                        variant: "secondary",
                        size: "sm",
                      })}
                      target="_blank"
                    >
                      <MonitorPlay className="size-3.5" />
                      {copy.preview}
                    </Link>
                  </div>
                </div>
                {selectedModule && selectedModule.usageCount > 1 ? (
                  <div className="mb-3 flex items-start gap-2 rounded-md border border-[#b9e8e3] bg-[#e9f8f6] px-3 py-2.5 text-[10px] leading-4 text-[#176f68]">
                    <Share2 className="mt-0.5 size-3.5 shrink-0" />
                    {copy.structure.sharedModuleDescription}
                  </div>
                ) : null}
                {selectedModuleIsExam ? (
                  <div
                    className={cn(
                      "mb-3 flex items-start gap-2 rounded-md border px-3 py-2.5 text-[10px] leading-4",
                      examGradableBlocks.length > 0 &&
                        examGradableBlocks.every((block) => block.required)
                        ? "border-[#b9e8e3] bg-[#e9f8f6] text-[#176f68]"
                        : "border-[#f0c4bb] bg-[#fdf0ee] text-[#9b4338]",
                    )}
                  >
                    {examGradableBlocks.length > 0 &&
                    examGradableBlocks.every((block) => block.required) ? (
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                    ) : (
                      <CircleHelp className="mt-0.5 size-3.5 shrink-0" />
                    )}
                    {examGradableBlocks.length === 0
                      ? copy.structure.examNeedsTask
                      : examGradableBlocks.every((block) => block.required)
                        ? copy.structure.gradableTasks(
                            examGradableBlocks.length,
                          )
                        : copy.structure.allGradableRequired}
                  </div>
                ) : null}
                <form
                  key={`title-${selectedLesson.id}-${selectedLesson.title}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    runMutation(() =>
                      updateCourseLessonTitleAction(
                        data.course.id,
                        selectedLesson.id,
                        new FormData(event.currentTarget),
                      ),
                    );
                  }}
                  className="mb-3 grid gap-3 rounded-md border border-[#dce1e5] bg-white p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
                >
                  <Field
                    label={
                      selectedModuleIsExam
                        ? copy.structure.examTitle
                        : copy.structure.lessonTitle
                    }
                  >
                    <input
                      name="title"
                      defaultValue={selectedLesson.title}
                      minLength={2}
                      maxLength={220}
                      required
                      className={inputClass}
                    />
                  </Field>
                  <Button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                  >
                    {pending ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    {copy.save}
                  </Button>
                </form>
                <form
                  key={selectedLesson.id}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const formData = new FormData(event.currentTarget);
                    const availableAt = String(
                      formData.get("availableAt") ?? "",
                    );
                    if (availableAt) {
                      formData.set(
                        "availableAt",
                        new Date(availableAt).toISOString(),
                      );
                    }
                    runMutation(() =>
                      updateCourseLessonAccessAction(
                        data.course.id,
                        selectedLesson.id,
                        formData,
                      ),
                    );
                  }}
                  className="mb-3 grid gap-3 rounded-md border border-[#dce1e5] bg-white p-3 sm:grid-cols-2 sm:items-end xl:grid-cols-[150px_180px_minmax(0,1fr)_auto]"
                >
                  <Field label={copy.structure.lessonStatus}>
                    <select
                      name="status"
                      defaultValue={selectedLesson.status}
                      className={inputClass}
                    >
                      <option value="published">{copy.common.published}</option>
                      <option value="draft">{copy.common.draft}</option>
                      <option value="archived">{copy.common.archived}</option>
                    </select>
                  </Field>
                  <Field label={copy.structure.visibility}>
                    <select
                      name="visibility"
                      defaultValue={selectedLesson.visibility}
                      className={inputClass}
                    >
                      <option value="visible">{copy.common.visible}</option>
                      {!selectedModuleIsExam ? (
                        <>
                          <option value="draft">{copy.common.hidden}</option>
                          <option value="coming_soon">
                            {copy.common.comingSoon}
                          </option>
                        </>
                      ) : null}
                    </select>
                  </Field>
                  <Field label={copy.structure.availableFrom}>
                    <input
                      name="availableAt"
                      type="datetime-local"
                      defaultValue={dateTimeLocalValue(
                        selectedLesson.availableAt,
                      )}
                      disabled={selectedModuleIsExam}
                      className={inputClass}
                    />
                  </Field>
                  <Button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                  >
                    {pending ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    {copy.save}
                  </Button>
                </form>
                {selectedLessonHasAssessment ? (
                  <form
                    key={`assessment-${selectedLesson.id}`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      runMutation(() =>
                        updateCourseLessonAssessmentAction(
                          data.course.id,
                          selectedLesson.id,
                          new FormData(event.currentTarget),
                        ),
                      );
                    }}
                    className="mb-3 rounded-md border border-[#cbd7e2] bg-[#f7f9fb] p-3"
                  >
                    <div className="mb-3 flex items-center gap-2">
                      <FileQuestion className="size-4 text-[#365f8d]" />
                      <div>
                        <p className="text-xs font-bold text-[#294f79]">
                          {copy.structure.examSettings}
                        </p>
                        <p className="text-[10px] text-[#71808b]">
                          {copy.structure.activeAfterPublish}
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-end">
                      <Field label={copy.structure.passingScore}>
                        <input
                          name="passingScore"
                          type="number"
                          min={1}
                          max={100}
                          required
                          defaultValue={selectedLesson.passingScore}
                          className={inputClass}
                        />
                      </Field>
                      <Field label={copy.structure.maxAttempts}>
                        <input
                          name="maxAttempts"
                          type="number"
                          min={1}
                          max={100}
                          defaultValue={selectedLesson.maxAttempts ?? ""}
                          placeholder={copy.common.noLimit}
                          className={inputClass}
                        />
                      </Field>
                      <CheckField
                        name="shuffleQuestions"
                        label={copy.structure.shuffleQuestions}
                        defaultChecked={selectedLesson.shuffleQuestions}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                      >
                        {pending ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <Save className="size-3.5" />
                        )}
                        {copy.save}
                      </Button>
                    </div>
                    {selectedLessonIsExam ? (
                      <div className="mt-4 border-t border-[#dce4eb] pt-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-xs font-bold text-[#294f79]">
                            {copy.structure.examFlow}
                          </p>
                          <span className="text-[10px] font-semibold text-[#71808b]">
                            {examPoolQuestionBlocks.length}{" "}
                            {copy.structure.automaticQuestions}
                          </span>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          <Field label={copy.structure.timeLimitMinutes}>
                            <input
                              name="examDurationMinutes"
                              type="number"
                              min={1}
                              max={1_440}
                              step="any"
                              defaultValue={
                                selectedLesson.examDurationSeconds === null
                                  ? ""
                                  : selectedLesson.examDurationSeconds / 60
                              }
                              placeholder={copy.common.noLimit}
                              className={inputClass}
                            />
                          </Field>
                          <Field
                            label={copy.structure.randomQuestions(
                              examPoolQuestionBlocks.length,
                            )}
                          >
                            <input
                              name="randomQuestionCount"
                              type="number"
                              min={1}
                              max={Math.min(100, examPoolQuestionBlocks.length)}
                              defaultValue={configuredRandomQuestionCount}
                              placeholder={copy.common.all}
                              disabled={examPoolQuestionBlocks.length === 0}
                              className={inputClass}
                            />
                          </Field>
                          <Field label={copy.structure.resultRelease}>
                            <select
                              name="examResultReleaseMode"
                              defaultValue={
                                selectedLesson.examResultReleaseMode
                              }
                              className={inputClass}
                            >
                              <option value="immediate">
                                {copy.structure.immediate}
                              </option>
                              <option value="after_deadline">
                                {copy.structure.afterDeadline}
                              </option>
                              <option value="manual">
                                {copy.structure.manual}
                              </option>
                            </select>
                          </Field>
                          <Field label={copy.structure.reviewRelease}>
                            <select
                              name="examReviewReleaseMode"
                              defaultValue={
                                selectedLesson.examReviewReleaseMode
                              }
                              className={inputClass}
                            >
                              <option value="never">
                                {copy.structure.never}
                              </option>
                              <option value="after_result">
                                {copy.structure.afterResult}
                              </option>
                              <option value="manual">
                                {copy.structure.manual}
                              </option>
                            </select>
                          </Field>
                          <Field label={copy.structure.contentAccess}>
                            <select
                              name="examContentAccessMode"
                              defaultValue={
                                selectedLesson.examContentAccessMode
                              }
                              className={inputClass}
                            >
                              <option value="allow">
                                {copy.structure.allow}
                              </option>
                              <option value="block_course">
                                {copy.structure.blockCourse}
                              </option>
                              <option value="block_academy">
                                {copy.structure.blockAcademy}
                              </option>
                            </select>
                          </Field>
                        </div>
                      </div>
                    ) : null}
                  </form>
                ) : null}
                {revisionConflict ? (
                  <div
                    role="alert"
                    className="mb-3 flex items-center gap-3 rounded-md border border-[#e7c3bd] bg-[#fff4f1] px-3 py-2 text-xs text-[#8d3b34]"
                  >
                    <span className="min-w-0 flex-1">{revisionConflict}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setRevisionConflict(null);
                        router.refresh();
                      }}
                    >
                      <RefreshCw className="size-3.5" />
                      {copy.structure.reload}
                    </Button>
                  </div>
                ) : null}
                <div className="mb-2 flex min-h-8 items-center justify-between gap-3">
                  <EditorPresenceStrip
                    courseId={data.course.id}
                    lessonId={selectedLesson.id}
                    pageId={selectedPageId}
                    locale={locale}
                  />
                  <select
                    value={selectedPageId ?? ""}
                    onChange={(event) =>
                      setSelectedPageId(event.currentTarget.value || null)
                    }
                    className="focus-ring h-8 max-w-56 rounded-md border border-[#dce1e5] bg-white px-2 text-[10px] font-semibold text-[#465664]"
                    aria-label={copy.structure.quickPageNavigation}
                  >
                    <option value="">{copy.structure.mainContent}</option>
                    {selectedLesson.pages.map((page, index) => (
                      <option key={page.id} value={page.id}>
                        {index + 1}. {page.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mb-3 flex items-center gap-1 overflow-x-auto rounded-md border border-[#dce1e5] bg-white p-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedPageId(null)}
                    className={cn(
                      "focus-ring h-8 shrink-0 rounded px-3 text-[10px] font-semibold",
                      selectedPageId === null
                        ? "bg-[#17324d] text-white"
                        : "text-[#66727f] hover:bg-[#edf1f3]",
                    )}
                  >
                    {copy.structure.mainContent}
                  </button>
                  {selectedLesson.pages.map((page, index) => (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => setSelectedPageId(page.id)}
                      className={cn(
                        "focus-ring h-8 shrink-0 rounded px-3 text-[10px] font-semibold",
                        selectedPageId === page.id
                          ? "bg-[#17324d] text-white"
                          : "text-[#66727f] hover:bg-[#edf1f3]",
                      )}
                    >
                      {page.titleSyncedWithLesson ? (
                        <Link2
                          className="mr-1 inline size-3"
                          aria-hidden="true"
                        />
                      ) : null}
                      {index + 1}. {page.title}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setDialog({ kind: "page", lessonId: selectedLesson.id })
                    }
                    className="focus-ring ml-auto flex h-8 shrink-0 items-center gap-1 rounded px-2.5 text-[10px] font-semibold text-[#176f68] hover:bg-[#e9f8f6]"
                  >
                    <Plus className="size-3" />
                    {copy.common.page}
                  </button>
                </div>
                {selectedPage ? (
                  <form
                    key={`page-title-${selectedPage.id}-${selectedPage.revision}`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      runMutation(() =>
                        updateLessonPageTitleAction(
                          data.course.id,
                          selectedLesson.id,
                          selectedPage.id,
                          new FormData(event.currentTarget),
                        ),
                      );
                    }}
                    className="mb-3 grid gap-3 rounded-md border border-[#dce1e5] bg-white p-3 lg:grid-cols-3"
                  >
                    <input
                      type="hidden"
                      name="revision"
                      value={selectedPage.revision}
                    />
                    <Field label={copy.structure.pageTitle}>
                      <input
                        name="title"
                        defaultValue={selectedPage.title}
                        minLength={2}
                        maxLength={220}
                        required
                        className={inputClass}
                      />
                    </Field>
                    <input
                      type="hidden"
                      name="titleSyncedWithLesson"
                      value={String(selectedPage.titleSyncedWithLesson)}
                    />
                    <Field label={copy.structure.pageWidth}>
                      <select
                        name="layoutWidth"
                        defaultValue={selectedPage.layoutWidth}
                        className={inputClass}
                      >
                        <option value="narrow">{copy.structure.narrow}</option>
                        <option value="standard">
                          {copy.structure.standard}
                        </option>
                        <option value="wide">{copy.structure.wide}</option>
                      </select>
                    </Field>
                    <Field label={copy.structure.background}>
                      <select
                        name="backgroundTone"
                        defaultValue={selectedPage.backgroundTone}
                        className={inputClass}
                      >
                        <option value="plain">{copy.structure.neutral}</option>
                        <option value="soft">{copy.structure.light}</option>
                        <option value="contrast">
                          {copy.structure.contrast}
                        </option>
                      </select>
                    </Field>
                    <Field label={copy.structure.spacing}>
                      <select
                        name="contentSpacing"
                        defaultValue={selectedPage.contentSpacing}
                        className={inputClass}
                      >
                        <option value="compact">
                          {copy.structure.compact}
                        </option>
                        <option value="comfortable">
                          {copy.structure.comfortable}
                        </option>
                        <option value="spacious">
                          {copy.structure.spacious}
                        </option>
                      </select>
                    </Field>
                    <div className="flex flex-wrap items-end gap-1 lg:col-span-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        disabled={
                          pending ||
                          selectedLesson.pages[0]?.id === selectedPage.id
                        }
                        aria-label={copy.structure.movePageUp}
                        title={copy.structure.up}
                        onClick={() =>
                          runMutation(() =>
                            commandLessonPageAction(
                              data.course.id,
                              selectedLesson.id,
                              selectedPage.id,
                              "move_up",
                              selectedPage.revision,
                            ),
                          )
                        }
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        disabled={
                          pending ||
                          selectedLesson.pages.at(-1)?.id === selectedPage.id
                        }
                        aria-label={copy.structure.movePageDown}
                        title={copy.structure.down}
                        onClick={() =>
                          runMutation(() =>
                            commandLessonPageAction(
                              data.course.id,
                              selectedLesson.id,
                              selectedPage.id,
                              "move_down",
                              selectedPage.revision,
                            ),
                          )
                        }
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        disabled={pending}
                        aria-label={copy.structure.duplicatePage}
                        title={copy.block.duplicate}
                        onClick={() =>
                          runMutation(
                            () =>
                              commandLessonPageAction(
                                data.course.id,
                                selectedLesson.id,
                                selectedPage.id,
                                "duplicate",
                                selectedPage.revision,
                              ),
                            (result) =>
                              setSelectedPageId(
                                result.pageId ?? selectedPage.id,
                              ),
                          )
                        }
                      >
                        <Copy className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        disabled={pending}
                        aria-label={
                          selectedPage.status === "published"
                            ? copy.structure.hidePage
                            : copy.structure.showPage
                        }
                        title={
                          selectedPage.status === "published"
                            ? copy.structure.hidePage
                            : copy.structure.showPage
                        }
                        onClick={() =>
                          runMutation(() =>
                            commandLessonPageAction(
                              data.course.id,
                              selectedLesson.id,
                              selectedPage.id,
                              "toggle_hidden",
                              selectedPage.revision,
                            ),
                          )
                        }
                      >
                        {selectedPage.status === "published" ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </Button>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      disabled={
                        pending ||
                        (!selectedPageIsFirst &&
                          !selectedPage.titleSyncedWithLesson)
                      }
                      aria-pressed={selectedPage.titleSyncedWithLesson}
                      aria-label={
                        selectedPage.titleSyncedWithLesson
                          ? copy.structure.unsyncTitle
                          : selectedPageIsFirst
                            ? copy.structure.syncLessonTitle
                            : copy.structure.onlyFirstPageSync
                      }
                      title={
                        selectedPage.titleSyncedWithLesson
                          ? copy.structure.unsyncTitle
                          : selectedPageIsFirst
                            ? copy.structure.syncLessonTitle
                            : copy.structure.onlyFirstPageSync
                      }
                      onClick={(event) => {
                        const form = event.currentTarget.form;
                        if (!form) return;
                        const formData = new FormData(form);
                        formData.set(
                          "titleSyncedWithLesson",
                          String(!selectedPage.titleSyncedWithLesson),
                        );
                        runMutation(() =>
                          updateLessonPageTitleAction(
                            data.course.id,
                            selectedLesson.id,
                            selectedPage.id,
                            formData,
                          ),
                        );
                      }}
                    >
                      {selectedPage.titleSyncedWithLesson ? (
                        <Unlink className="size-4" />
                      ) : (
                        <Link2 className="size-4" />
                      )}
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                    >
                      {pending ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      {copy.save}
                    </Button>
                  </form>
                ) : null}
                <div className="min-h-[560px] rounded-md border border-[#dce1e5] bg-white p-5 shadow-sm sm:p-6 md:p-10">
                  <DndContext
                    id={`course-blocks-${data.course.id}-${selectedLesson.id}`}
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={finishBlockDrag}
                  >
                    <SortableContext
                      items={orderedBlocks.map((block) => block.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-6">
                        {orderedBlocks.map((block) => (
                          <SortableBlock
                            copy={copy}
                            locale={locale}
                            key={block.id}
                            block={block}
                            pending={pending}
                            dataForms={data.dataForms}
                            aiAgents={aiAgents}
                            onEdit={() =>
                              setDialog({ kind: "edit-block", block })
                            }
                            onDuplicate={() =>
                              runMutation(() =>
                                duplicateCourseContentBlockAction(
                                  data.course.id,
                                  block.id,
                                ),
                              )
                            }
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                  {!activeBlocks.length ? (
                    <div className="grid min-h-96 place-items-center text-center">
                      <div>
                        <LayoutTemplate className="mx-auto size-8 text-[#a2abb3]" />
                        <p className="mt-3 text-sm font-semibold text-[#52606d]">
                          {selectedPage
                            ? copy.structure.emptyPage
                            : copy.structure.emptyMainContent}
                        </p>
                        <p className="mt-1 text-xs text-[#87919a]">
                          {copy.structure.addContentHint}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="grid min-h-[600px] place-items-center text-center">
                <div className="max-w-md px-5">
                  {selectedModuleIsLink ? (
                    <Link2 className="mx-auto size-8 text-[#365f8d]" />
                  ) : (
                    <BookOpen className="mx-auto size-8 text-[#9aa4ac]" />
                  )}
                  <p className="mt-3 text-sm font-semibold text-[#52606d]">
                    {selectedModuleIsLink
                      ? selectedModule?.title
                      : copy.chooseLesson}
                  </p>
                  {selectedModuleIsLink ? (
                    <form
                      className="mt-5 grid gap-3 text-left"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!selectedModule) return;
                        runMutation(() =>
                          updateCourseLinkModuleAction(
                            data.course.id,
                            selectedModule.id,
                            new FormData(event.currentTarget),
                          ),
                        );
                      }}
                    >
                      <Field label={copy.structure.linkTitle}>
                        <input
                          name="title"
                          defaultValue={selectedModule?.title}
                          className={inputClass}
                          required
                        />
                      </Field>
                      <Field label={copy.structure.targetCourse}>
                        <select
                          name="linkedCourseId"
                          defaultValue={selectedModule?.linkedCourseId ?? ""}
                          className={inputClass}
                          required
                        >
                          {data.linkTargets.map((target) => (
                            <option
                              key={target.id}
                              value={target.id}
                              disabled={target.status === "archived"}
                            >
                              {target.title}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={copy.structure.description}>
                        <textarea
                          name="description"
                          defaultValue={selectedModule?.description ?? ""}
                          className={textareaClass}
                        />
                      </Field>
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button type="submit" size="sm" disabled={pending}>
                          <Save className="size-3.5" />
                          {copy.save}
                        </Button>
                        {selectedLinkTarget ? (
                          <Link
                            href={`/admin/courses/${selectedLinkTarget.id}`}
                            className={buttonClassName({
                              variant: "secondary",
                              size: "sm",
                            })}
                          >
                            <Link2 className="size-3.5" />
                            {copy.structure.openTargetCourse}
                          </Link>
                        ) : null}
                      </div>
                    </form>
                  ) : null}
                  {selectedModule && selectedModule.kind === "learning" ? (
                    <Button
                      size="sm"
                      className="mt-3"
                      onClick={() =>
                        setDialog({
                          kind: "lesson",
                          moduleId: selectedModule.id,
                        })
                      }
                    >
                      <Plus className="size-3.5" />
                      {copy.lesson}
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </section>

          <aside className="border-t border-[#e5e8eb] bg-white xl:border-l xl:border-t-0">
            <div className="border-b border-[#e8ebee] px-4 py-3">
              <p className="text-xs font-bold text-[#243444]">
                {selectedModuleIsLink
                  ? copy.structure.linkModule
                  : selectedModuleIsExam
                    ? copy.structure.examBlocks
                    : copy.structure.contentBlocks}
              </p>
              <p className="mt-0.5 text-[10px] text-[#7d8891]">
                {selectedModuleIsLink
                  ? copy.structure.noLearningContent
                  : selectedPage
                    ? copy.structure.pageArea(selectedPage.title)
                    : copy.structure.activeMainContent}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3 xl:grid-cols-1">
              {availablePalette.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => addBlock(item.type)}
                    disabled={pending || !selectedLesson}
                    className="focus-ring flex min-h-11 items-center gap-2.5 rounded-md border border-[#e1e5e8] bg-white px-3 py-2 text-left text-[11px] font-semibold text-[#52606d] hover:border-[#b8deda] hover:bg-[#f2f9f8] disabled:opacity-50"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded bg-[#f1f4f5] text-[#47606f]">
                      <Icon className="size-3.5" />
                    </span>
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div className="border-t border-[#edf0f2] px-4 py-3 text-[10px] leading-4 text-[#7d8891]">
              {selectedLesson
                ? copy.structure.elementsInArea(activeBlocks.length)
                : copy.chooseLesson}
            </div>
          </aside>
        </div>
      ) : null}

      {activeTab === "information" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            runMutation(() =>
              updateCourseInformationAction(data.course.id, formData),
            );
          }}
          className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_340px]"
        >
          <input type="hidden" name="locale" value={locale} />
          <section>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[#243444]">
                  {copy.information.title}
                </h2>
                <p className="mt-1 text-xs text-[#74818c]">
                  {copy.information.description}
                </p>
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {copy.save}
              </Button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label={copy.information.courseTitle}>
                <input
                  name="title"
                  defaultValue={data.course.title}
                  className={inputClass}
                />
              </Field>
              <Field label={copy.information.category}>
                <select
                  name="categoryId"
                  defaultValue={data.course.categoryId ?? ""}
                  className={inputClass}
                >
                  <option value="">{copy.uncategorized}</option>
                  {data.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label={copy.information.shortDescription}>
                  <textarea
                    name="shortDescription"
                    defaultValue={data.course.shortDescription}
                    className={textareaClass}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label={copy.information.longDescription}>
                  <textarea
                    name="description"
                    defaultValue={data.course.description}
                    className={cn(textareaClass, "min-h-40")}
                  />
                </Field>
              </div>
              <Field label={copy.information.difficulty}>
                <input
                  name="difficulty"
                  defaultValue={data.course.difficulty}
                  className={inputClass}
                />
              </Field>
              <Field label={copy.information.estimatedDuration}>
                <input
                  name="estimatedMinutes"
                  type="number"
                  min={1}
                  defaultValue={data.course.estimatedMinutes}
                  className={inputClass}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label={copy.information.coverUrl}>
                  <CourseCoverEditor
                    courseId={data.course.id}
                    currentCover={data.course.coverImage}
                    locale={locale}
                    stockImagesEnabled={stockImagesEnabled}
                  />
                </Field>
              </div>
              <CheckField
                name="certificateEnabled"
                label={copy.information.certificateEnabled}
                defaultChecked={data.course.certificateEnabled}
              />
              <CheckField
                name="featured"
                label={copy.information.featured}
                defaultChecked={data.course.featured}
              />
              <CheckField
                name="visibleInCatalog"
                label={copy.information.showInMemberOverview}
                defaultChecked={data.course.visibleInCatalog}
              />
              <CheckField
                name="showProgressPercentage"
                label={copy.information.showProgress}
                defaultChecked={data.course.showProgressPercentage}
              />
              <CheckField
                name="notifyMembersOnModuleRelease"
                label={copy.information.emailModuleReleases}
                defaultChecked={data.course.notifyMembersOnModuleRelease}
              />
              <CourseInformationListsEditor
                locale={locale}
                learningGoals={data.learningGoals}
                courseAuthors={data.courseAuthors}
                teamMembers={data.widgetTeamMembers}
              />
            </div>
          </section>
          <aside className="border-t border-[#e5e8eb] pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <h3 className="text-sm font-bold text-[#243444]">
              {copy.information.scope}
            </h3>
            <div className="mt-4 divide-y divide-[#e8ebee] border-y border-[#e8ebee]">
              <div className="flex items-center justify-between py-3 text-xs">
                <span className="flex items-center gap-2 text-[#66727f]">
                  <Layers3 className="size-4" />
                  {copy.information.modules}
                </span>
                <strong className="text-[#243444]">
                  {data.modules.length}
                </strong>
              </div>
              <div className="flex items-center justify-between py-3 text-xs">
                <span className="flex items-center gap-2 text-[#66727f]">
                  <BookOpen className="size-4" />
                  {copy.information.lessons}
                </span>
                <strong className="text-[#243444]">{totalLessons}</strong>
              </div>
              <div className="flex items-center justify-between py-3 text-xs">
                <span className="flex items-center gap-2 text-[#66727f]">
                  <LayoutTemplate className="size-4" />
                  {copy.information.lessonPages}
                </span>
                <strong className="text-[#243444]">{totalPages}</strong>
              </div>
              <div className="flex items-center justify-between py-3 text-xs">
                <span className="flex items-center gap-2 text-[#66727f]">
                  <Clock3 className="size-4" />
                  {copy.information.duration}
                </span>
                <strong className="text-[#243444]">
                  {formatDuration(data.course.estimatedMinutes, locale)}
                </strong>
              </div>
            </div>
            <div className="mt-5 flex items-start gap-3 rounded-md bg-[#f2f9f8] p-3 text-xs leading-5 text-[#31746e]">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              {data.course.certificateEnabled
                ? copy.information.certificateOn
                : copy.information.certificateOff}
            </div>
          </aside>
        </form>
      ) : null}

      {activeTab === "widgets" ? (
        <CourseWidgetsEditor
          locale={locale}
          courseId={data.course.id}
          widgets={data.widgets}
          teamMembers={data.widgetTeamMembers}
        />
      ) : null}

      {activeTab === "access" ? (
        <div className="p-4 sm:p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-base font-bold text-[#243444]">
                {copy.access.title}
              </h2>
              <p className="mt-1 text-xs text-[#74818c]">
                {copy.access.description}
              </p>
            </div>
            <Link
              href="/admin/members"
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              <Users className="size-3.5" />
              {copy.access.manageMembers}
            </Link>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label={copy.access.enrolled}
              value={data.access.total}
              detail={copy.access.activeAccess(data.access.active)}
            />
            <Metric
              label={copy.access.inactive}
              value={data.access.inactive}
              detail={copy.access.progressPreserved}
            />
            <Metric
              label={copy.access.assignments}
              value={data.access.grants.total}
              detail={copy.access.directAndGroups(
                data.access.grants.direct,
                data.access.grants.groups,
              )}
            />
            <Metric
              label={copy.access.viaBundles}
              value={data.access.grants.bundles}
              detail={copy.access.activeBundlePaths}
            />
          </div>
          <section className="mt-6 border-t border-[#e5e8eb]">
            {data.modules.map((module, index) => (
              <div key={module.id} className="border-b border-[#e5e8eb] py-4">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const formData = new FormData(event.currentTarget);
                    for (const name of ["availableFrom", "availableUntil"]) {
                      const date = String(formData.get(name) ?? "");
                      if (date)
                        formData.set(name, new Date(date).toISOString());
                    }
                    runMutation(() =>
                      updateCourseModuleAccessAction(
                        data.course.id,
                        module.id,
                        formData,
                      ),
                    );
                  }}
                  className="space-y-4"
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div>
                      <p className="text-[9px] font-bold uppercase text-[#7d8891]">
                        {copy.access.module} {index + 1}
                      </p>
                      <h3 className="mt-0.5 text-sm font-bold text-[#243444]">
                        {module.title}
                      </h3>
                      <p className="mt-1 text-[10px] text-[#87919a]">
                        {copy.common.lessons(module.lessons.length)}
                      </p>
                    </div>
                    <Button
                      type="submit"
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                    >
                      {pending ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      {copy.save}
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Field label={copy.access.releaseMode}>
                      <select
                        name="accessMode"
                        defaultValue={module.accessMode}
                        className={inputClass}
                      >
                        <option value="visible">
                          {copy.access.immediatelyVisible}
                        </option>
                        <option value="after_previous">
                          {copy.access.afterPreviousModule}
                        </option>
                        <option value="delay_days">
                          {copy.access.afterDays}
                        </option>
                        <option value="date_window">
                          {copy.access.dateWindow}
                        </option>
                        <option value="coming_soon">
                          {copy.common.comingSoon}
                        </option>
                        <option value="locked">{copy.common.locked}</option>
                        <option value="hidden">{copy.common.hidden}</option>
                      </select>
                    </Field>
                    <Field label={copy.access.releaseAfterDays}>
                      <input
                        name="dripDays"
                        type="number"
                        min={0}
                        max={36500}
                        defaultValue={module.dripDays}
                        className={inputClass}
                      />
                    </Field>
                    <Field label={copy.access.untilThen}>
                      <select
                        name="delayPendingState"
                        defaultValue={module.delayPendingState}
                        className={inputClass}
                      >
                        <option value="locked">{copy.access.showLocked}</option>
                        <option value="hidden">{copy.access.hide}</option>
                      </select>
                    </Field>
                    <Field label={copy.access.outsideWindow}>
                      <select
                        name="windowDefaultState"
                        defaultValue={module.windowDefaultState}
                        className={inputClass}
                      >
                        <option value="available">
                          {copy.common.available}
                        </option>
                        <option value="read_only">
                          {copy.common.readOnly}
                        </option>
                        <option value="locked">{copy.common.locked}</option>
                        <option value="hidden">{copy.common.hidden}</option>
                      </select>
                    </Field>
                    <Field label={copy.access.windowStart}>
                      <input
                        name="availableFrom"
                        type="datetime-local"
                        defaultValue={dateTimeLocalValue(module.availableFrom)}
                        className={inputClass}
                      />
                    </Field>
                    <Field label={copy.access.windowEnd}>
                      <input
                        name="availableUntil"
                        type="datetime-local"
                        defaultValue={dateTimeLocalValue(module.availableUntil)}
                        className={inputClass}
                      />
                    </Field>
                    <Field label={copy.access.insideWindow}>
                      <select
                        name="windowState"
                        defaultValue={module.windowState}
                        className={inputClass}
                      >
                        <option value="available">
                          {copy.common.available}
                        </option>
                        <option value="read_only">
                          {copy.common.readOnly}
                        </option>
                        <option value="locked">{copy.common.locked}</option>
                        <option value="hidden">{copy.common.hidden}</option>
                      </select>
                    </Field>
                    <div className="grid gap-2 sm:grid-cols-2 sm:items-end">
                      <CheckField
                        name="requestAccessEnabled"
                        label={copy.access.requestable}
                        defaultChecked={module.requestAccessEnabled}
                      />
                      {module.kind === "link" ? (
                        <div className="flex min-h-10 items-center rounded-md border border-[#dce1e5] bg-[#f7f9fa] px-3 text-[10px] font-semibold text-[#71808b]">
                          <input type="hidden" name="isRequired" value="off" />
                          {copy.access.linkNotProgress}
                        </div>
                      ) : (
                        <CheckField
                          name="isRequired"
                          label={copy.access.requiredModule}
                          defaultChecked={module.isRequired}
                        />
                      )}
                    </div>
                  </div>
                </form>
                {module.sections.length ? (
                  <div className="mt-4 space-y-2 border-l-2 border-[#dbe4ea] pl-3 md:ml-4 md:pl-4">
                    {module.sections.map((section) => (
                      <form
                        key={section.id}
                        onSubmit={(event) => {
                          event.preventDefault();
                          runMutation(() =>
                            updateModuleSectionAccessAction(
                              data.course.id,
                              section.id,
                              new FormData(event.currentTarget),
                            ),
                          );
                        }}
                        className="grid items-center gap-3 rounded-md bg-[#f7f9fa] p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_130px_130px_120px_190px_108px_auto]"
                      >
                        <div className="min-w-0">
                          <p className="text-[9px] font-bold uppercase text-[#7d8891]">
                            {copy.common.section}
                          </p>
                          <p className="mt-0.5 truncate text-xs font-semibold text-[#354555]">
                            {section.title}
                          </p>
                        </div>
                        <Field label={copy.access.status}>
                          <select
                            name="status"
                            defaultValue={section.status}
                            className={inputClass}
                          >
                            <option value="published">
                              {copy.common.published}
                            </option>
                            <option value="draft">{copy.common.draft}</option>
                            <option value="archived">
                              {copy.common.archived}
                            </option>
                          </select>
                        </Field>
                        <Field label={copy.access.visibility}>
                          <select
                            name="visibility"
                            defaultValue={section.visibility}
                            className={inputClass}
                          >
                            <option value="visible">
                              {copy.common.visible}
                            </option>
                            <option value="draft">{copy.common.hidden}</option>
                            <option value="coming_soon">
                              {copy.common.comingSoon}
                            </option>
                          </select>
                        </Field>
                        <Field label={copy.access.releaseAfterDays}>
                          <input
                            name="dripDays"
                            type="number"
                            min={0}
                            defaultValue={section.dripDays}
                            className={inputClass}
                          />
                        </Field>
                        <CheckField
                          name="unlockAfterPrevious"
                          label={copy.access.lessonsInOrder}
                          defaultChecked={section.unlockAfterPrevious}
                        />
                        <SectionLessonVisibilityActions
                          courseId={data.course.id}
                          sectionId={section.id}
                          sectionTitle={section.title}
                          lessonVisibilities={module.lessons
                            .filter((lesson) => lesson.sectionId === section.id)
                            .map((lesson) => lesson.visibility)}
                          locale={locale}
                        />
                        <Button
                          type="submit"
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                        >
                          {pending ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <Save className="size-3.5" />
                          )}
                          {copy.save}
                        </Button>
                      </form>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </section>
        </div>
      ) : null}

      {activeTab === "analytics" ? (
        <div className="p-4 sm:p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-base font-bold text-[#243444]">
                {copy.analytics.title}
              </h2>
              <p className="mt-1 text-xs text-[#74818c]">
                {copy.analytics.description}
              </p>
            </div>
            {canViewGlobalAnalytics ? (
              <Link
                href="/admin/analytics"
                className={buttonClassName({
                  variant: "secondary",
                  size: "sm",
                })}
              >
                <BarChart3 className="size-3.5" />
                {copy.analytics.allAnalytics}
              </Link>
            ) : null}
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label={copy.analytics.activeLearners}
              value={data.statistics.active}
              detail={copy.analytics.totalEnrollments(data.statistics.total)}
            />
            <Metric
              label={copy.analytics.average}
              value={`${data.statistics.averageProgress}%`}
              detail={copy.analytics.activeProgressDetail}
            />
            <Metric
              label={copy.analytics.completed}
              value={data.statistics.completed}
              detail={copy.analytics.currentlyInProgress(
                data.statistics.inProgress,
              )}
            />
            <Metric
              label={copy.analytics.notStarted}
              value={data.statistics.notStarted}
              detail={copy.analytics.inactiveAccess(data.statistics.inactive)}
            />
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <section className="border-t border-[#e5e8eb] pt-5">
              <h3 className="text-sm font-bold text-[#243444]">
                {copy.analytics.distribution}
              </h3>
              <div className="mt-4 space-y-4">
                {[
                  {
                    label: copy.analytics.completed,
                    value: data.statistics.completed,
                    color: "bg-[#2bb7a9]",
                  },
                  {
                    label: copy.analytics.inProgress,
                    value: data.statistics.inProgress,
                    color: "bg-[#4f7cac]",
                  },
                  {
                    label: copy.analytics.notStarted,
                    value: data.statistics.notStarted,
                    color: "bg-[#d6a536]",
                  },
                ].map((item) => {
                  const percent = data.statistics.total
                    ? Math.round((item.value / data.statistics.total) * 100)
                    : 0;
                  return (
                    <div key={item.label}>
                      <div className="mb-1.5 flex justify-between text-xs text-[#52606d]">
                        <span>{item.label}</span>
                        <strong>
                          {item.value} ({percent}%)
                        </strong>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[#edf0f2]">
                        <div
                          className={cn("h-full rounded-full", item.color)}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            <aside className="border-t border-[#e5e8eb] pt-5 lg:border-l lg:pl-6">
              <h3 className="text-sm font-bold text-[#243444]">
                {copy.analytics.submissions}
              </h3>
              <p className="mt-3 text-3xl font-bold text-[#1d2b38]">
                {data.statistics.submissions.total}
              </p>
              <p className="mt-1 text-xs text-[#74818c]">
                {copy.analytics.submissionSummary(
                  data.statistics.submissions.open,
                  data.statistics.submissions.approved,
                )}
              </p>
              <Link
                href="/admin/tasks"
                className={cn(
                  buttonClassName({ variant: "secondary", size: "sm" }),
                  "mt-4",
                )}
              >
                {copy.analytics.taskCenter}
                <ChevronRight className="size-3.5" />
              </Link>
            </aside>
          </div>
        </div>
      ) : null}

      {activeTab === "submissions" ? (
        <div className="p-4 sm:p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-base font-bold text-[#243444]">
                {copy.submissionsView.title}
              </h2>
              <p className="mt-1 text-xs text-[#74818c]">
                {copy.submissionsView.description}
              </p>
            </div>
            <Link
              href="/admin/tasks"
              className={buttonClassName({ variant: "primary", size: "sm" })}
            >
              <Send className="size-3.5" />
              {copy.submissionsView.manageAll}
            </Link>
          </div>
          <div className="mt-5 overflow-x-auto border-y border-[#e5e8eb]">
            {data.recentSubmissions.length ? (
              <table className="w-full min-w-[680px] text-left">
                <thead>
                  <tr className="border-b border-[#e5e8eb] text-[9px] font-bold uppercase text-[#7d8891]">
                    <th className="px-3 py-3">
                      {copy.submissionsView.submission}
                    </th>
                    <th className="px-3 py-3">{copy.submissionsView.member}</th>
                    <th className="px-3 py-3">{copy.submissionsView.date}</th>
                    <th className="px-3 py-3">{copy.submissionsView.status}</th>
                    <th className="px-3 py-3 text-right">
                      {copy.submissionsView.points}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentSubmissions.map((submission) => (
                    <tr
                      key={submission.id}
                      className="border-b border-[#edf0f2] last:border-0"
                    >
                      <td className="px-3 py-3 text-xs font-semibold text-[#243444]">
                        {submission.title}
                      </td>
                      <td className="px-3 py-3 text-xs text-[#52606d]">
                        {submission.firstName} {submission.lastName}
                      </td>
                      <td className="px-3 py-3 text-xs text-[#66727f]">
                        {formatDate(submission.submittedAt, undefined, locale)}
                      </td>
                      <td className="px-3 py-3">
                        <Badge
                          tone={
                            submission.status === "approved" ? "teal" : "amber"
                          }
                        >
                          {submission.status === "approved"
                            ? copy.submissionsView.graded
                            : submission.status === "revision"
                              ? copy.submissionsView.revision
                              : copy.submissionsView.open}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-right text-xs font-bold text-[#243444]">
                        {submission.score === null
                          ? "-"
                          : `${submission.score}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="grid min-h-64 place-items-center text-center">
                <div>
                  <MessageSquareText className="mx-auto size-8 text-[#a2abb3]" />
                  <p className="mt-3 text-sm font-semibold text-[#52606d]">
                    {copy.submissionsView.empty}
                  </p>
                  <p className="mt-1 text-xs text-[#87919a]">
                    {copy.submissionsView.emptyDescription}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {dialog?.kind === "module" ? (
        <FormDialog
          copy={copy}
          title={copy.dialogs.createModule}
          eyebrow={copy.courseStructure}
          pending={pending}
          onClose={() => setDialog(null)}
          submitLabel={copy.dialogs.createModule}
          submitIcon={<Plus className="size-4" />}
          onSubmit={(formData) =>
            runMutation(
              () => createCourseModuleAction(data.course.id, formData),
              (result) => {
                setSelectedModuleId(result.id ?? "");
                setSelectedLessonId(result.lessonId ?? "");
                setSelectedPageId(result.pageId ?? null);
                setDialog(null);
              },
            )
          }
        >
          {reusableCandidates.length ? (
            <div className="rounded-md border border-[#dce1e5] bg-[#f7f9fa] p-3">
              <div className="flex items-center gap-2">
                <Link2 className="size-4 text-[#365f8d]" />
                <div>
                  <p className="text-xs font-bold text-[#354555]">
                    {copy.dialogs.existingModule}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[#7a8690]">
                    {copy.dialogs.sharedContent}
                  </p>
                </div>
              </div>
              <ReusableModulePicker
                modules={reusableCandidates}
                value={reusableSelection}
                onChange={setReusableModuleId}
                locale={locale}
                disabled={pending}
              />
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending || !reusableSelection}
                  onClick={() =>
                    runMutation(
                      () =>
                        attachReusableModuleAction(
                          data.course.id,
                          reusableSelection,
                        ),
                      (result) => {
                        setSelectedModuleId(result.id ?? "");
                        setSelectedLessonId(result.lessonId ?? "");
                        setSelectedPageId(result.pageId ?? null);
                        setDialog(null);
                      },
                    )
                  }
                >
                  <Link2 className="size-3.5" />
                  {copy.common.add}
                </Button>
              </div>
            </div>
          ) : null}
          {reusableCandidates.length ? (
            <div className="flex items-center gap-3 text-[10px] font-bold uppercase text-[#8a949d]">
              <span className="h-px flex-1 bg-[#e1e5e8]" />
              {copy.dialogs.newModule}
              <span className="h-px flex-1 bg-[#e1e5e8]" />
            </div>
          ) : null}
          <NewModuleFields copy={copy} linkTargets={data.linkTargets} />
        </FormDialog>
      ) : null}

      {dialog?.kind === "section" ? (
        <FormDialog
          copy={copy}
          title={copy.dialogs.createSection}
          eyebrow={
            data.modules.find((module) => module.id === dialog.moduleId)
              ?.title ?? copy.common.module
          }
          pending={pending}
          onClose={() => setDialog(null)}
          submitLabel={copy.dialogs.createSection}
          submitIcon={<Plus className="size-4" />}
          onSubmit={(formData) =>
            runMutation(
              () =>
                createModuleSectionAction(
                  data.course.id,
                  dialog.moduleId,
                  formData,
                ),
              () => setDialog(null),
            )
          }
        >
          <Field label={copy.dialogs.sectionTitle}>
            <input name="title" className={inputClass} autoFocus required />
          </Field>
          <Field label={copy.structure.description}>
            <textarea name="description" className={textareaClass} />
          </Field>
        </FormDialog>
      ) : null}

      {dialog?.kind === "lesson" ? (
        <FormDialog
          copy={copy}
          title={copy.dialogs.createLesson}
          eyebrow={
            data.modules.find((module) => module.id === dialog.moduleId)
              ?.title ?? copy.common.module
          }
          pending={pending}
          onClose={() => setDialog(null)}
          submitLabel={copy.dialogs.createLesson}
          submitIcon={<Plus className="size-4" />}
          onSubmit={(formData) =>
            runMutation(
              () =>
                createModuleLessonAction(
                  data.course.id,
                  dialog.moduleId,
                  formData,
                ),
              (result) => {
                setSelectedModuleId(dialog.moduleId);
                setSelectedLessonId(result.id ?? "");
                setSelectedPageId(null);
                setDialog(null);
              },
            )
          }
        >
          <Field label={copy.dialogs.lessonTitle}>
            <input name="title" className={inputClass} autoFocus required />
          </Field>
          <Field label={copy.common.section}>
            <select name="sectionId" className={inputClass}>
              <option value="">{copy.structure.noSection}</option>
              {data.modules
                .find((module) => module.id === dialog.moduleId)
                ?.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.title}
                  </option>
                ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={copy.dialogs.type}>
              <select name="type" defaultValue="lesson" className={inputClass}>
                <option value="lesson">{copy.common.lesson}</option>
                <option value="quiz">{copy.dialogs.quiz}</option>
                <option value="assignment">{copy.dialogs.submission}</option>
                <option value="exam">{copy.structure.exam}</option>
              </select>
            </Field>
            <Field label={copy.structure.durationMinutes}>
              <input
                name="durationMinutes"
                type="number"
                min={1}
                defaultValue={10}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label={copy.dialogs.summary}>
            <textarea name="summary" className={textareaClass} />
          </Field>
        </FormDialog>
      ) : null}

      {dialog?.kind === "copy-section" ? (
        <FormDialog
          copy={copy}
          title={copyToCopy.sectionTitle}
          eyebrow={`${copyToCopy.source}: ${dialog.sourceTitle}`}
          pending={pending}
          submitDisabled={!data.copyTargets.some((target) => target.modules.length)}
          onClose={() => setDialog(null)}
          submitLabel={copyToCopy.submit}
          submitIcon={<Copy className="size-4" />}
          onSubmit={(formData) => {
            formData.set("locale", locale);
            const targetCourseId = String(formData.get("targetCourseId") ?? "");
            const targetModuleId = String(formData.get("targetModuleId") ?? "");
            runMutation(
              () =>
                copyCourseSectionAction(
                  data.course.id,
                  dialog.sectionId,
                  formData,
                ),
              (result) => {
                if (targetCourseId === data.course.id) {
                  setSelectedModuleId(targetModuleId);
                  if (result.lessonId) setSelectedLessonId(result.lessonId);
                  setSelectedPageId(null);
                }
                setDialog(null);
              },
            );
          }}
        >
          <CopyTargetFields
            targets={data.copyTargets}
            kind="section"
            locale={locale}
            defaultCourseId={data.course.id}
            defaultModuleId={dialog.sourceModuleId}
          />
        </FormDialog>
      ) : null}

      {dialog?.kind === "copy-lesson" ? (
        <FormDialog
          copy={copy}
          title={copyToCopy.lessonTitle}
          eyebrow={`${copyToCopy.source}: ${dialog.sourceTitle}`}
          pending={pending}
          submitDisabled={!data.copyTargets.some((target) => target.modules.length)}
          onClose={() => setDialog(null)}
          submitLabel={copyToCopy.submit}
          submitIcon={<Copy className="size-4" />}
          onSubmit={(formData) => {
            formData.set("locale", locale);
            const targetCourseId = String(formData.get("targetCourseId") ?? "");
            const targetModuleId = String(formData.get("targetModuleId") ?? "");
            runMutation(
              () =>
                copyCourseLessonAction(
                  data.course.id,
                  dialog.lessonId,
                  formData,
                ),
              (result) => {
                if (targetCourseId === data.course.id) {
                  setSelectedModuleId(targetModuleId);
                  setSelectedLessonId(result.id ?? "");
                  setSelectedPageId(result.pageId ?? null);
                }
                setDialog(null);
              },
            );
          }}
        >
          <CopyTargetFields
            targets={data.copyTargets}
            kind="lesson"
            locale={locale}
            defaultCourseId={data.course.id}
            defaultModuleId={dialog.sourceModuleId}
          />
        </FormDialog>
      ) : null}

      {dialog?.kind === "page" ? (
        <FormDialog
          copy={copy}
          title={copy.dialogs.createPage}
          eyebrow={selectedLesson?.title ?? copy.common.lesson}
          pending={pending}
          onClose={() => setDialog(null)}
          submitLabel={copy.dialogs.createPage}
          submitIcon={<Plus className="size-4" />}
          onSubmit={(formData) =>
            runMutation(
              () =>
                createLessonPageAction(
                  data.course.id,
                  dialog.lessonId,
                  formData,
                ),
              (result) => {
                setSelectedPageId(result.id ?? null);
                setDialog(null);
              },
            )
          }
        >
          <NewLessonPageFields
            copy={copy}
            lessonTitle={selectedLesson?.title ?? copy.structure.newPage}
            canSync={(selectedLesson?.pages.length ?? 0) === 0}
          />
        </FormDialog>
      ) : null}

      {dialog?.kind === "add-ai-agent" ? (
        <FormDialog
          copy={copy}
          title={copy.dialogs.embedAgent}
          eyebrow={selectedLesson?.title ?? copy.common.lesson}
          pending={pending}
          submitDisabled={aiAgentsLoading || aiAgents.length === 0}
          onClose={() => setDialog(null)}
          submitLabel={copy.dialogs.embedAgent}
          submitIcon={<Bot className="size-4" />}
          secondary={
            <Link
              href="/admin/ai"
              className={buttonClassName({ variant: "ghost", size: "sm" })}
            >
              <Bot className="size-3.5" />
              {copy.dialogs.agentStudio}
            </Link>
          }
          onSubmit={(formData) =>
            runMutation(
              () =>
                addCourseContentBlockAction(
                  data.course.id,
                  dialog.lessonId,
                  dialog.pageId,
                  "ai_agent",
                  String(formData.get("agentId") ?? ""),
                  locale,
                ),
              () => setDialog(null),
            )
          }
        >
          <Field label={copy.block.agent}>
            <select
              name="agentId"
              defaultValue={aiAgents[0]?.id ?? ""}
              className={inputClass}
              required
              disabled={aiAgentsLoading || aiAgents.length === 0}
              autoFocus
            >
              {aiAgentsLoading ? (
                <option value="">{copy.dialogs.agentsLoading}</option>
              ) : aiAgents.length ? null : (
                <option value="">{copy.block.noPublishedAgent}</option>
              )}
              {aiAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} ({copy.common.version(agent.version)})
                </option>
              ))}
            </select>
          </Field>
          {aiAgentsError ? (
            <p role="alert" className="text-xs text-[#a74439]">
              {aiAgentsError}
            </p>
          ) : null}
        </FormDialog>
      ) : null}

      {dialog?.kind === "edit-block" ? (
        <FormDialog
          copy={copy}
          title={copy.dialogs.editBlock}
          width={
            dialog.block.type === "gallery" || dialog.block.type === "rich_text"
              ? "max-w-3xl"
              : undefined
          }
          eyebrow={
            palette.find((item) => item.type === dialog.block.type)?.label ??
            dialog.block.type
          }
          pending={pending}
          submitDisabled={
            dialog.block.type === "ai_agent" &&
            (aiAgentsLoading || aiAgents.length === 0)
          }
          onClose={() => setDialog(null)}
          submitLabel={copy.dialogs.saveChanges}
          submitIcon={<Save className="size-4" />}
          secondary={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setDialog({ kind: "delete-block", block: dialog.block })
              }
              disabled={pending}
            >
              <Trash2 className="size-3.5" />
              {copy.common.delete}
            </Button>
          }
          onSubmit={(formData) =>
            runMutation(
              () =>
                updateCourseContentBlockAction(
                  data.course.id,
                  dialog.block.id,
                  dialog.block.revision,
                  formData,
                ),
              () => setDialog(null),
            )
          }
        >
          <input type="hidden" name="locale" value={locale} />
          <BlockEditorFields
            key={dialog.block.id}
            block={dialog.block}
            courseId={data.course.id}
            dataForms={data.dataForms}
            aiAgents={aiAgents}
            stockImagesEnabled={stockImagesEnabled}
            locale={locale}
          />
          <div className="grid gap-3 border-t border-[#e4e8eb] pt-4 sm:grid-cols-3">
            <Field label={copy.dialogs.blockWidth}>
              <select
                name="style.width"
                defaultValue={dialog.block.style.width}
                className={inputClass}
              >
                <option value="compact">{copy.structure.compact}</option>
                <option value="content">{copy.dialogs.contentWidth}</option>
                <option value="full">{copy.dialogs.fullWidth}</option>
              </select>
            </Field>
            <Field label={copy.dialogs.alignment}>
              <select
                name="style.alignment"
                defaultValue={dialog.block.style.alignment}
                className={inputClass}
              >
                <option value="left">{copy.dialogs.left}</option>
                <option value="center">{copy.dialogs.centered}</option>
              </select>
            </Field>
            <Field label={copy.dialogs.surface}>
              <select
                name="style.surface"
                defaultValue={dialog.block.style.surface}
                className={inputClass}
              >
                <option value="plain">{copy.dialogs.borderless}</option>
                <option value="bordered">{copy.dialogs.bordered}</option>
                <option value="muted">{copy.dialogs.muted}</option>
              </select>
            </Field>
          </div>
        </FormDialog>
      ) : null}

      {dialog?.kind === "delete-block" ? (
        <ConfirmDeleteDialog
          copy={copy}
          block={dialog.block}
          pending={pending}
          onClose={() => setDialog({ kind: "edit-block", block: dialog.block })}
          onConfirm={() =>
            runMutation(
              () =>
                deleteCourseContentBlockAction(
                  data.course.id,
                  dialog.block.id,
                  dialog.block.revision,
                ),
              () => setDialog(null),
            )
          }
        />
      ) : null}
    </div>
  );
}

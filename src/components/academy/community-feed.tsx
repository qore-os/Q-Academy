"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import {
  ArrowBigDown,
  ArrowBigUp,
  AlertTriangle,
  Award,
  BookmarkCheck,
  BookOpen,
  CircleHelp,
  Heart,
  Flag,
  Lightbulb,
  LockKeyhole,
  LoaderCircle,
  Megaphone,
  MessageCircle,
  Pencil,
  Pin,
  PartyPopper,
  Plus,
  Reply,
  Send,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  createCommentAction,
  createPostAction,
  setCommentReactionAction,
  setPostReactionAction,
  setPostVoteAction,
  type ActionState,
} from "@/lib/actions";
import {
  deleteOwnCommentAction,
  deleteOwnPostAction,
  updateOwnCommentAction,
  updateOwnPostAction,
  type CommunityActionState,
} from "@/lib/community-actions";
import {
  createCommunityReportAction,
  type CommunityReportActionState,
} from "@/lib/community-report-actions";
import { cn, formatDateTime } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CommunityContentEditor,
  type CommunityContentEditorSnapshot,
} from "@/components/academy/community-content-editor";
import { RichTextContent } from "@/components/content/rich-text-content";
import { useCommunityFollows } from "@/components/academy/community-follow-context";
import {
  emitCommunityCommentMutation,
  useCommunityCommentPagination,
  type CommunityCommentLoadControl,
} from "@/components/academy/community-comment-pagination";
import {
  CommunityAttachments,
  CommunityAttachmentUploader,
  type CommunityAttachmentUploaderHandle,
} from "@/components/academy/community-attachments";
import type {
  CommunityReactionType,
  CommunitySpaceType,
} from "@/lib/community-domain";
import type {
  CommunityFeedCommentDto,
  CommunityFeedPostDto,
} from "@/lib/community-feed";
import { resolveCommunityActionMessage } from "@/lib/i18n/community-actions";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import type { AppLocale } from "@/lib/i18n/model";
import type { RichTextDocument } from "@/lib/rich-text/document";
import { useHydrated } from "@/lib/use-hydrated";

function MemberBadges({
  badges,
  locale,
  compact = false,
}: {
  badges: CommunityFeedPostDto["badges"];
  locale: AppLocale;
  compact?: boolean;
}) {
  if (!badges.length) return null;
  const copy = getMainPageDictionary(locale).academy.communityUi;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-1"
      aria-label={copy.common.badges}
    >
      {badges.slice(0, compact ? 2 : 4).map((badge) => (
        <span
          key={badge.id}
          title={`${badge.groupName ? `${badge.groupName}: ` : ""}${badge.name} - ${badge.description}`}
          style={{
            borderColor: `${badge.color}66`,
            backgroundColor: `${badge.color}14`,
          }}
          className="inline-flex h-5 max-w-36 items-center gap-1 rounded border px-1.5 text-[9px] font-bold text-[#354555]"
        >
          <Award className="size-2.5 shrink-0" />
          <span className="truncate">{badge.name}</span>
        </span>
      ))}
    </span>
  );
}

export type CommunitySpaceView = {
  id: string;
  title: string;
  description: string | null;
  color: string;
  type: CommunitySpaceType;
  accessMode: "open" | "restricted";
  permissions: {
    canView: boolean;
    canPost: boolean;
    canComment: boolean;
    canManage: boolean;
  };
  isFollowing?: boolean;
};

export type CommunityAreaView = {
  id: string;
  title: string;
  description?: string | null;
  spaces: CommunitySpaceView[];
};

export type CommunityProfileCompletionView = {
  complete: boolean;
  gateEnabled: boolean;
  missingFields: Array<{ key: string; label: string }>;
  profileHref: string;
};

export type CommunityMentionCandidateView = {
  id: string;
  handle: string;
  firstName: string;
  lastName: string;
};

export type CommunityCommentView = CommunityFeedCommentDto;
export type CommunityPostView = CommunityFeedPostDto;

type Space = CommunitySpaceView;
type MentionCandidate = CommunityMentionCandidateView;
type CommentRow = CommunityCommentView;
type PostRow = CommunityPostView;

const initialState: ActionState = {};
const initialCommunityState: CommunityActionState = { ok: null, message: "" };
const initialReportState: CommunityReportActionState = {
  ok: null,
  message: "",
};

function CommunityProfileNotice({
  completion,
  locale,
}: {
  completion: CommunityProfileCompletionView;
  locale: AppLocale;
}) {
  if (!completion.gateEnabled || completion.complete) return null;
  const copy = getMainPageDictionary(locale).academy.communityUi;
  return (
    <div
      className="panel flex flex-col gap-3 border-[#edcf9f] bg-[#fffaf1] p-4 sm:flex-row sm:items-center"
      role="alert"
      data-testid="community-profile-completion"
    >
      <AlertTriangle className="size-5 shrink-0 text-[#a56c18]" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-[#6f4a13]">
          {copy.profile.completionTitle}
        </p>
        <p className="mt-1 text-[10px] leading-4 text-[#84652f]">
          {copy.profile.openFields}: {completion.missingFields.map((field) => field.label).join(", ")}
        </p>
      </div>
      <Link
        href={completion.profileHref}
        className="focus-ring inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-[#17324d] px-3 text-xs font-bold text-white hover:bg-[#244765]"
      >
        {copy.profile.goToProfile}
      </Link>
    </div>
  );
}

function CommunityActionError({
  state,
  locale,
  fallbackMessage,
}: {
  state: Pick<ActionState, "error" | "profileHref" | "missingFields">;
  locale: AppLocale;
  fallbackMessage: string;
}) {
  if (!state.error) return null;
  const copy = getMainPageDictionary(locale).academy.communityUi;
  return (
    <div className="mt-3 rounded-md bg-[#fdf0ee] p-3 text-xs text-[#a94339]" role="alert">
      <p>{fallbackMessage}</p>
      {state.missingFields?.length ? (
        <p className="mt-1 text-[10px]">
          {copy.profile.openFields}: {state.missingFields.map((field) => field.label).join(", ")}
        </p>
      ) : null}
      {state.profileHref ? (
        <Link
          href={state.profileHref}
          className="focus-ring mt-2 inline-flex rounded font-bold underline underline-offset-2"
        >
          {copy.profile.completeProfile}
        </Link>
      ) : null}
    </div>
  );
}

export function CommunityComposer({
  spaces,
  currentUser,
  mentionCandidates,
  areas,
  profileCompletion,
  canCreateAnnouncements = false,
  locale,
}: {
  spaces: Space[];
  currentUser: { firstName: string; lastName: string };
  mentionCandidates: MentionCandidate[];
  areas?: CommunityAreaView[];
  profileCompletion?: CommunityProfileCompletionView;
  canCreateAnnouncements?: boolean;
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).academy.community;
  const ui = getMainPageDictionary(locale).academy.communityUi;
  const hydrated = useHydrated();
  const availableSpaces = spaces.filter(
    (space) =>
      space.permissions.canPost &&
      (space.type !== "announcement" || canCreateAnnouncements),
  );
  const [open, setOpen] = useState(false);
  const [attachmentsReady, setAttachmentsReady] = useState(true);
  const [selectedSpaceId, setSelectedSpaceId] = useState(
    availableSpaces[0]?.id ?? "",
  );
  const formRef = useRef<HTMLFormElement>(null);
  const uploaderRef = useRef<CommunityAttachmentUploaderHandle>(null);
  const [state, action, pending] = useActionState(
    createPostAction,
    initialState,
  );
  const selectedSpace =
    availableSpaces.find((space) => space.id === selectedSpaceId) ??
    availableSpaces[0];
  const availableSpaceIds = new Set(availableSpaces.map((space) => space.id));
  const availableAreaGroups = (areas?.length
    ? areas
    : [{ id: "all", title: ui.common.allAreas, spaces: availableSpaces }]
  )
    .map((area) => ({
      ...area,
      spaces: area.spaces.filter((space) => availableSpaceIds.has(space.id)),
    }))
    .filter((area) => area.spaces.length > 0);
  const profileAllowsPosting = profileCompletion?.complete ?? true;

  useEffect(() => {
    if (!state.success) return;
    uploaderRef.current?.markCommitted();
    formRef.current?.reset();
    toast.success(ui.actions.postSubmitted);
  }, [state, ui.actions.postSubmitted]);

  const closeComposer = () => {
    uploaderRef.current?.discard();
    setOpen(false);
  };

  return (
    <>
      {profileCompletion ? (
        <CommunityProfileNotice completion={profileCompletion} locale={locale} />
      ) : null}
      <button
        type="button"
        data-testid="community-composer-trigger"
        onClick={() => setOpen(true)}
        disabled={!hydrated || !availableSpaces.length || !profileAllowsPosting}
        className="focus-ring panel flex w-full items-center gap-3 p-4 text-left hover:bg-[#fafbfb] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Avatar
          firstName={currentUser.firstName}
          lastName={currentUser.lastName}
        />
        <span className="flex h-10 min-w-0 flex-1 items-center rounded-md border border-[#e1e5e8] bg-[#f7f8f9] px-3 text-sm text-[#7b8791]">
          {!profileAllowsPosting
            ? ui.profile.postRequirement
            : availableSpaces.length
            ? copy.composerPlaceholder
            : copy.composerUnavailable}
        </span>
        <span className="hidden size-9 place-items-center rounded-md bg-[#e9f8f6] text-[#167e74] sm:grid">
          <Plus className="size-4" />
        </span>
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-[70] grid grid-cols-[minmax(0,1fr)] place-items-center overflow-x-hidden overflow-y-auto bg-[#0f263c]/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-post-title"
        >
          <div className="my-4 max-h-[calc(100dvh-2rem)] min-w-0 w-full max-w-full sm:max-w-xl overflow-x-hidden overflow-y-auto rounded-md bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#e8ebee] px-5 py-4">
              <div>
                <p className="text-[10px] font-bold uppercase text-[#2b9188]">
                  {ui.common.community}
                </p>
                <h2
                  id="new-post-title"
                  className="mt-0.5 text-lg font-bold text-[#243444]"
                >
                  {copy.newPost}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeComposer}
                disabled={pending}
                className="focus-ring grid size-9 place-items-center rounded-md hover:bg-[#edf1f3] disabled:opacity-50"
                aria-label={copy.closeDialog}
              >
                <X className="size-5" />
              </button>
            </div>
            <form
              ref={formRef}
              action={action}
              className="min-w-0 overflow-x-hidden p-5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar
                  firstName={currentUser.firstName}
                  lastName={currentUser.lastName}
                />
                <select
                  name="spaceId"
                  value={selectedSpace?.id ?? ""}
                  onChange={(event) => setSelectedSpaceId(event.target.value)}
                  className="focus-ring h-9 min-w-0 flex-1 rounded-md border border-[#dce1e5] bg-white px-3 text-xs font-semibold"
                  required
                >
                  {availableAreaGroups.map((area) => (
                    <optgroup key={area.id} label={area.title}>
                      {area.spaces.map((space) => (
                        <option key={space.id} value={space.id}>
                          {space.title}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              {selectedSpace?.type !== "feed" ? (
                <input
                  name="title"
                  autoFocus
                  minLength={2}
                  maxLength={240}
                  required
                  className="focus-ring mt-4 h-10 w-full max-w-full rounded-md border border-[#dce1e5] px-3 text-sm"
                  placeholder={
                    selectedSpace?.type === "announcement"
                      ? copy.announcementTitle
                      : copy.discussionTitle
                  }
                />
              ) : null}
              <CommunityContentEditor
                candidates={mentionCandidates}
                locale={locale}
                multiline
                autoFocus={selectedSpace?.type === "feed"}
                placeholder={copy.contentPlaceholder}
                mentionLabel={copy.mentionMember}
                minLength={3}
                maxLength={10000}
              />
              <CommunityAttachmentUploader
                ref={uploaderRef}
                locale={locale}
                maxAttachments={6}
                disabled={pending}
                onReadinessChange={setAttachmentsReady}
              />
              <div className="mt-3 flex min-w-0 justify-end">
                <Button
                  type="submit"
                  className="max-w-full"
                  disabled={
                    !hydrated ||
                    pending ||
                    !attachmentsReady ||
                    !profileAllowsPosting
                  }
                >
                  {pending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  {pending ? copy.publishing : copy.publish}
                </Button>
              </div>
              <CommunityActionError
                state={state}
                locale={locale}
                fallbackMessage={resolveCommunityActionMessage(
                  locale,
                  {
                    code: state.communityCode,
                    params: state.communityParams,
                  },
                  "contentCreateFailed",
                )}
              />
              {state.success ? (
                <p
                  className="mt-3 rounded-md bg-[#e9f8f6] p-3 text-xs font-medium text-[#167e74]"
                  role="status"
                  aria-live="polite"
                >
                  {resolveCommunityActionMessage(
                    locale,
                    {
                      code: state.communityCode,
                      params: state.communityParams,
                    },
                    "contentCreated",
                  )}
                </p>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

const reactionOptions: Array<{
  value: CommunityReactionType;
  icon: typeof Heart;
  activeClass: string;
}> = [
  {
    value: "like",
    icon: Heart,
    activeClass: "bg-[#fdf0ee] text-[#b84e42]",
  },
  {
    value: "celebrate",
    icon: PartyPopper,
    activeClass: "bg-[#fbf6e7] text-[#8d6a12]",
  },
  {
    value: "insightful",
    icon: Lightbulb,
    activeClass: "bg-[#e9f8f6] text-[#167e74]",
  },
  {
    value: "question",
    icon: CircleHelp,
    activeClass: "bg-[#eef3f9] text-[#365f8d]",
  },
];

function ReactionBar({
  postId,
  selected,
  counts,
  locale,
}: {
  postId: string;
  selected: CommunityReactionType | null;
  counts: Record<CommunityReactionType, number>;
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const [pending, startTransition] = useTransition();
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      aria-label={copy.reactions.groupLabel}
    >
      {reactionOptions.map((option) => {
        const active = selected === option.value;
        const Icon = option.icon;
        const label = copy.reactions.options[option.value];
        return (
          <button
            key={option.value}
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(() =>
                setPostReactionAction(postId, active ? null : option.value),
              )
            }
            className={cn(
              "focus-ring flex h-8 min-w-10 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-semibold",
              active ? option.activeClass : "text-[#6f7b85] hover:bg-[#f3f5f6]",
            )}
            aria-label={active ? copy.reactions.remove(label) : label}
            aria-pressed={active}
            title={label}
          >
            <Icon
              className={cn(
                "size-3.5",
                active && option.value === "like" && "fill-current",
              )}
            />
            {counts[option.value]}
          </button>
        );
      })}
    </div>
  );
}

function CommentReactionBar({
  comment,
  locale,
}: {
  comment: CommentRow;
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const [pending, startTransition] = useTransition();
  const [selection, setSelection] = useState<{
    reaction: CommunityReactionType | null;
    counts: Record<CommunityReactionType, number>;
  }>(() => ({
    reaction: comment.myReaction,
    counts: {
      like: comment.likeReactionCount,
      celebrate: comment.celebrateReactionCount,
      insightful: comment.insightfulReactionCount,
      question: comment.questionReactionCount,
    },
  }));

  function chooseReaction(reaction: CommunityReactionType) {
    const nextReaction = selection.reaction === reaction ? null : reaction;
    startTransition(async () => {
      try {
        await setCommentReactionAction(comment.id, nextReaction);
        setSelection((current) => {
          const counts = { ...current.counts };
          if (current.reaction) {
            counts[current.reaction] = Math.max(
              0,
              counts[current.reaction] - 1,
            );
          }
          if (nextReaction) counts[nextReaction] += 1;
          return { reaction: nextReaction, counts };
        });
      } catch {
        toast.error(copy.reactions.commentSaveFailed);
      }
    });
  }

  return (
    <div
      className="mt-1.5 flex max-w-full flex-wrap items-center gap-0.5"
      aria-label={copy.reactions.commentGroupLabel}
    >
      {reactionOptions.map((option) => {
        const active = selection.reaction === option.value;
        const Icon = option.icon;
        const label = copy.reactions.options[option.value];
        return (
          <button
            key={option.value}
            type="button"
            disabled={pending}
            onClick={() => chooseReaction(option.value)}
            className={cn(
              "focus-ring inline-flex h-7 min-w-8 items-center justify-center gap-1 rounded px-1.5 text-[10px] font-semibold disabled:opacity-60",
              active ? option.activeClass : "text-[#6f7b85] hover:bg-white",
            )}
            aria-label={active ? copy.reactions.remove(label) : label}
            aria-pressed={active}
            title={label}
          >
            <Icon
              className={cn(
                "size-3",
                active && option.value === "like" && "fill-current",
              )}
            />
            {selection.counts[option.value]}
          </button>
        );
      })}
    </div>
  );
}

function VoteControl({
  postId,
  score,
  selected,
  locale,
}: {
  postId: string;
  score: number;
  selected: number;
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex h-8 items-center rounded-md border border-[#e1e5e8] bg-white">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(() =>
            setPostVoteAction(postId, selected === 1 ? 0 : 1),
          )
        }
        className={cn(
          "focus-ring grid size-8 place-items-center rounded-l-md",
          selected === 1
            ? "bg-[#e9f8f6] text-[#167e74]"
            : "text-[#71808b] hover:bg-[#f3f5f6]",
        )}
        aria-label={selected === 1 ? copy.votes.removeUp : copy.votes.up}
        aria-pressed={selected === 1}
      >
        <ArrowBigUp
          className={cn("size-4", selected === 1 && "fill-current")}
        />
      </button>
      <span className="min-w-8 text-center text-[11px] font-bold text-[#455463]">
        {score}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(() =>
            setPostVoteAction(postId, selected === -1 ? 0 : -1),
          )
        }
        className={cn(
          "focus-ring grid size-8 place-items-center rounded-r-md",
          selected === -1
            ? "bg-[#fdf0ee] text-[#b84e42]"
            : "text-[#71808b] hover:bg-[#f3f5f6]",
        )}
        aria-label={selected === -1 ? copy.votes.removeDown : copy.votes.down}
        aria-pressed={selected === -1}
      >
        <ArrowBigDown
          className={cn("size-4", selected === -1 && "fill-current")}
        />
      </button>
    </div>
  );
}

function CommentForm({
  postId,
  parentId = null,
  mentionCandidates,
  profileCompletion,
  locale,
  onCancel,
}: {
  postId: string;
  parentId?: string | null;
  mentionCandidates: MentionCandidate[];
  profileCompletion?: CommunityProfileCompletionView;
  locale: AppLocale;
  onCancel?: () => void;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const formRef = useRef<HTMLFormElement>(null);
  const uploaderRef = useRef<CommunityAttachmentUploaderHandle>(null);
  const [attachmentsReady, setAttachmentsReady] = useState(true);
  const [state, action, pending] = useActionState(
    createCommentAction,
    initialState,
  );
  useEffect(() => {
    if (state.success) {
      uploaderRef.current?.markCommitted();
      formRef.current?.reset();
      onCancel?.();
    }
  }, [onCancel, state]);

  const cancelReply = () => {
    uploaderRef.current?.discard();
    onCancel?.();
  };

  if (profileCompletion && !profileCompletion.complete) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-[#edcf9f] bg-[#fffaf1] px-3 py-2.5 text-[10px] text-[#7b561d]">
        <AlertTriangle className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 font-semibold">
          {copy.profile.replyRequirement}
        </span>
        <Link
          href={profileCompletion.profileHref}
          className="focus-ring rounded font-bold underline underline-offset-2"
        >
          {copy.profile.goToProfile}
        </Link>
      </div>
    );
  }

  return (
    <form ref={formRef} action={action} className="mt-3">
      <input type="hidden" name="postId" value={postId} />
      {parentId ? (
        <input type="hidden" name="parentId" value={parentId} />
      ) : null}
      <CommunityContentEditor
        candidates={mentionCandidates}
        locale={locale}
        placeholder={
          parentId
            ? copy.comments.threadPlaceholder
            : copy.comments.answerPlaceholder
        }
        minLength={1}
        maxLength={5000}
        multiline={false}
        compact
        deferFormatControls
        disabled={pending || profileCompletion?.complete === false}
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        {onCancel ? (
          <button
            type="button"
            onClick={cancelReply}
            className="focus-ring grid size-9 shrink-0 place-items-center rounded-md text-[#71808b] hover:bg-[#edf1f3]"
            aria-label={copy.comments.cancelThreadReply}
            title={copy.common.cancel}
          >
            <X className="size-4" />
          </button>
        ) : null}
        <button
          type="submit"
          disabled={
            pending ||
            !attachmentsReady ||
            profileCompletion?.complete === false
          }
          className="focus-ring grid size-9 shrink-0 place-items-center rounded-md bg-[#17324d] text-white hover:bg-[#244765] disabled:opacity-60"
          aria-label={copy.comments.publishAnswer}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </button>
      </div>
      <CommunityAttachmentUploader
        ref={uploaderRef}
        locale={locale}
        maxAttachments={3}
        compact
        disabled={pending}
        onReadinessChange={setAttachmentsReady}
      />
      <CommunityActionError
        state={state}
        locale={locale}
        fallbackMessage={resolveCommunityActionMessage(
          locale,
          {
            code: state.communityCode,
            params: state.communityParams,
          },
          "contentCreateFailed",
        )}
      />
    </form>
  );
}

type OwnedContent = {
  kind: "post" | "comment";
  id: string;
  content: string;
  contentFormat: "plain_text" | "rich_text";
  richText: RichTextDocument | null;
  moderationVersion: number;
};

type ReportTarget = {
  targetType: "post" | "comment";
  id: string;
};

function CommunityText({ content }: { content: string }) {
  const parts = content.split(/(@[a-z0-9][a-z0-9._-]{0,63})/gi);
  return parts.map((part, index) =>
    part.startsWith("@") ? (
      <span key={`${part}-${index}`} className="font-semibold text-[#365f8d]">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function CommunityContent({
  content,
  contentFormat,
  richText,
  className,
}: {
  content: string;
  contentFormat: "plain_text" | "rich_text";
  richText: RichTextDocument | null;
  className?: string;
}) {
  if (contentFormat === "rich_text" && richText) {
    return (
      <RichTextContent
        document={richText}
        density="compact"
        className={className}
      />
    );
  }
  return (
    <p className={cn("whitespace-pre-wrap", className)}>
      <CommunityText content={content} />
    </p>
  );
}

function reasonLabel(
  code: string,
  copy: ReturnType<typeof getMainPageDictionary>["academy"]["communityUi"],
) {
  const labels: Record<string, string> = {
    followed_author: copy.feedReasons.followedAuthor,
    following_author: copy.feedReasons.followedAuthor,
    author_followed: copy.feedReasons.followedAuthor,
    followed_space: copy.feedReasons.followedSpace,
    following_space: copy.feedReasons.followedSpace,
    space_followed: copy.feedReasons.followedSpace,
    recent: copy.feedReasons.recent,
    latest: copy.feedReasons.recent,
    active_discussion: copy.feedReasons.activeDiscussion,
    popular: copy.feedReasons.popular,
    trending: copy.feedReasons.popular,
    engaged: copy.feedReasons.engaged,
    prior_engagement: copy.feedReasons.engaged,
    same_group: copy.feedReasons.sameGroup,
    shared_group: copy.feedReasons.sameGroup,
    same_bundle: copy.feedReasons.sameGroup,
    shared_bundle: copy.feedReasons.sameGroup,
    announcement: copy.feedReasons.announcement,
    pinned: copy.feedReasons.pinned,
  };
  if (code.toLowerCase().includes("boost")) {
    return copy.feedReasons.recommended;
  }
  return labels[code] ?? null;
}

function FeedReasons({
  reasonCodes = [],
  locale,
}: {
  reasonCodes?: string[];
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const labels = [
    ...new Set(
      reasonCodes
        .map((code) => reasonLabel(code, copy))
        .filter((label): label is string => Boolean(label)),
    ),
  ].slice(0, 3);
  if (!labels.length) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-4 text-[#71808b]">
      {labels.map((label) => (
        <span key={label} className="inline-flex items-center gap-1">
          {label === copy.feedReasons.followedSpace ? (
            <BookmarkCheck className="size-3" />
          ) : null}
          {label}
        </span>
      ))}
    </p>
  );
}

function AuthorFollowButton({
  post,
  locale,
}: {
  post: PostRow;
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const follows = useCommunityFollows();
  const following = follows.isFollowing(
    "author",
    post.authorId,
    post.isFollowingAuthor,
  );
  const pending = follows.isPending("author", post.authorId);
  const label = following
    ? copy.follow.unfollowAuthor(`${post.firstName} ${post.lastName}`)
    : copy.follow.author(`${post.firstName} ${post.lastName}`);

  return (
    <button
      type="button"
      onClick={() => void follows.toggle("author", post.authorId, true)}
      disabled={pending || !follows.resolved}
      className={cn(
        "focus-ring grid size-8 shrink-0 place-items-center rounded-md hover:bg-[#edf1f3] disabled:opacity-50",
        following ? "text-[#167e74]" : "text-[#52606d]",
      )}
      aria-label={label}
      aria-pressed={following}
      title={label}
    >
      {pending || !follows.resolved ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : following ? (
        <UserCheck className="size-4" />
      ) : (
        <UserPlus className="size-4" />
      )}
    </button>
  );
}

function CommentThread({
  comment,
  postId,
  currentUserId,
  mentionCandidates,
  profileCompletion,
  locale,
  canReply,
  onEdit,
  onDelete,
  onReport,
  replyControl,
  onLoadReplies,
}: {
  comment: CommentRow;
  postId: string;
  currentUserId: string;
  mentionCandidates: MentionCandidate[];
  profileCompletion?: CommunityProfileCompletionView;
  locale: AppLocale;
  canReply: boolean;
  onEdit: (comment: CommentRow) => void;
  onDelete: (comment: CommentRow) => void;
  onReport: (comment: CommentRow) => void;
  replyControl: CommunityCommentLoadControl;
  onLoadReplies: () => void;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const [replying, setReplying] = useState(false);
  const replies = comment.replies;

  function row(item: CommentRow, nested: boolean) {
    return (
      <div
        key={item.id}
        id={`comment-${item.id}`}
        className={cn(
          "flex items-start gap-2.5",
          nested && "ml-5 border-l-2 border-[#dfe5ea] pl-3 sm:ml-9",
        )}
      >
        <Link
          href={`/academy/community/members/${item.authorId}`}
          className="focus-ring shrink-0 rounded-full"
          aria-label={copy.profile.profileOf(
            `${item.firstName} ${item.lastName}`,
          )}
        >
          <Avatar
            firstName={item.firstName}
            lastName={item.lastName}
            src={item.authorAvatarUrl}
            size="sm"
          />
        </Link>
        <div className="min-w-0 flex-1 rounded-md bg-[#f5f7f8] px-3 py-2">
          <p className="text-[10px] font-bold text-[#455463]">
            <Link
              href={`/academy/community/members/${item.authorId}`}
              className="focus-ring rounded hover:text-[#17324d] hover:underline"
            >
              {item.firstName} {item.lastName}
            </Link>
            <span className="ml-1.5 align-middle">
              <MemberBadges badges={item.badges} locale={locale} compact />
            </span>
            <span className="ml-2 font-normal text-[#89949d]">
              {formatDateTime(item.createdAt, locale)}
            </span>
          </p>
          <CommunityContent
            content={item.content}
            contentFormat={item.contentFormat}
            richText={item.richText}
            className="mt-1 text-xs leading-5 text-[#53616e]"
          />
          <CommunityAttachments
            attachments={item.attachments}
            locale={locale}
            compact
          />
          <CommentReactionBar comment={item} locale={locale} />
          {!nested && canReply ? (
            <button
              type="button"
              onClick={() => setReplying((current) => !current)}
              className="focus-ring mt-1.5 inline-flex h-7 items-center gap-1 rounded px-1.5 text-[10px] font-semibold text-[#52606d] hover:bg-white"
              aria-label={copy.comments.replyTo(
                `${item.firstName} ${item.lastName}`,
              )}
            >
              <Reply className="size-3" /> {copy.comments.reply}
            </button>
          ) : null}
        </div>
        {item.authorId === currentUserId ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => onEdit(item)}
              className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3]"
              aria-label={copy.comments.editOwn}
              title={copy.comments.edit}
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(item)}
              className="focus-ring grid size-8 place-items-center rounded-md text-[#a94339] hover:bg-[#fdf0ee]"
              aria-label={copy.comments.deleteOwn}
              title={copy.comments.delete}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onReport(item)}
            disabled={item.reported}
            className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-[#7a8690] hover:bg-[#fdf0ee] hover:text-[#a94339] disabled:cursor-default disabled:bg-[#f3f5f6] disabled:text-[#a1aab1]"
            aria-label={
              item.reported
                ? copy.comments.alreadyReported
                : copy.comments.report
            }
            title={item.reported ? copy.comments.reported : copy.comments.report}
          >
            <Flag className="size-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {row(comment, false)}
      {replying ? (
        <div className="ml-5 sm:ml-9">
          <CommentForm
            postId={postId}
            parentId={comment.id}
            mentionCandidates={mentionCandidates}
            profileCompletion={profileCompletion}
            locale={locale}
            onCancel={() => setReplying(false)}
          />
        </div>
      ) : null}
      {replies.map((reply) => row(reply, true))}
      {replyControl.canLoad ? (
        <div className="ml-5 sm:ml-9">
          {replyControl.error ? (
            <p className="mb-1 text-[10px] text-[#a94339]">
              {replyControl.error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={onLoadReplies}
            disabled={replyControl.loading}
            className="focus-ring inline-flex min-h-8 items-center gap-1.5 rounded px-2 text-[10px] font-semibold text-[#52606d] hover:bg-[#f1f4f6] disabled:opacity-50"
          >
            {replyControl.loading ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <Reply className="size-3" />
            )}
            {replyControl.loading
              ? copy.comments.loadingAnswers
              : replyControl.error
                ? copy.common.retry
                : replies.length
                  ? copy.comments.loadMoreAnswers
                  : copy.comments.loadAnswers}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MemberCommentList({
  post,
  currentUserId,
  mentionCandidates,
  profileCompletion,
  locale,
  canReply,
  onEdit,
  onDelete,
  onReport,
}: {
  post: PostRow;
  currentUserId: string;
  mentionCandidates: MentionCandidate[];
  profileCompletion?: CommunityProfileCompletionView;
  locale: AppLocale;
  canReply: boolean;
  onEdit: (comment: CommentRow) => void;
  onDelete: (comment: CommentRow) => void;
  onReport: (comment: CommentRow) => void;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const pagination = useCommunityCommentPagination({
    postId: post.id,
    initialComments: post.comments,
    totalCount: post.commentCount,
    locale,
  });

  return (
    <>
      {pagination.comments.length ? (
        <div className="mt-3 space-y-3 border-l-2 border-[#e7ecef] pl-3">
          {pagination.comments.map((comment) => (
            <CommentThread
              key={comment.id}
              comment={comment}
              postId={post.id}
              currentUserId={currentUserId}
              mentionCandidates={mentionCandidates}
              profileCompletion={profileCompletion}
              locale={locale}
              canReply={canReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onReport={onReport}
              replyControl={pagination.repliesControl(comment.id)}
              onLoadReplies={() => void pagination.loadMoreReplies(comment.id)}
            />
          ))}
        </div>
      ) : null}
      {post.commentCount > pagination.visibleCount ? (
        <p className="mt-3 text-[10px] font-medium text-[#71808b]">
          {copy.comments.loadedAnswers(
            pagination.visibleCount,
            post.commentCount,
          )}
        </p>
      ) : null}
      {pagination.commentsControl.canLoad ? (
        <div className="mt-2">
          {pagination.commentsControl.error ? (
            <p className="mb-1 text-[10px] text-[#a94339]">
              {pagination.commentsControl.error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void pagination.loadMoreComments()}
            disabled={pagination.commentsControl.loading}
            className="focus-ring inline-flex min-h-8 items-center gap-1.5 rounded px-2 text-[10px] font-semibold text-[#52606d] hover:bg-[#f1f4f6] disabled:opacity-50"
          >
            {pagination.commentsControl.loading ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <MessageCircle className="size-3" />
            )}
            {pagination.commentsControl.loading
              ? copy.comments.loadingComments
              : pagination.commentsControl.error
                ? copy.common.retry
                : copy.comments.loadMoreComments}
          </button>
        </div>
      ) : null}
    </>
  );
}

function CommunityReportDialog({
  target,
  locale,
  onClose,
  onSuccess,
}: {
  target: ReportTarget;
  locale: AppLocale;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const targetLabel =
    target.targetType === "post" ? copy.common.post : copy.common.answer;
  const reportAction = createCommunityReportAction.bind(
    null,
    target.targetType,
    target.id,
  );
  const [state, action, pending] = useActionState(
    reportAction,
    initialReportState,
  );

  useEffect(() => {
    if (state.ok === true) {
      toast.success(
        state.code === "reportSubmitted" && state.params?.held !== true
          ? copy.actions.reportSent
          : resolveCommunityActionMessage(locale, state, "reportSubmitted"),
      );
      onSuccess();
      onClose();
    } else if (state.ok === false) {
      toast.error(
        resolveCommunityActionMessage(locale, state, "reportFailed"),
      );
    }
  }, [copy.actions.reportSent, locale, onClose, onSuccess, state]);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-[#0f263c]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={copy.report.title(targetLabel)}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div className="my-4 w-full max-w-lg rounded-md bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e8ebee] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase text-[#b84e42]">
              {copy.report.moderation}
            </p>
            <h2 className="mt-0.5 text-lg font-bold text-[#243444]">
              {copy.report.title(targetLabel)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3] disabled:opacity-50"
            aria-label={copy.common.closeDialog}
            title={copy.common.close}
          >
            <X className="size-5" />
          </button>
        </div>
        <form action={action} className="space-y-4 p-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.report.reason}
            </span>
            <select
              name="reason"
              required
              defaultValue=""
              className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#2b3a48]"
            >
              <option value="" disabled>
                {copy.report.selectReason}
              </option>
              <option value="spam">{copy.report.reasons.spam}</option>
              <option value="harassment">
                {copy.report.reasons.harassment}
              </option>
              <option value="hate_speech">
                {copy.report.reasons.hate_speech}
              </option>
              <option value="misinformation">
                {copy.report.reasons.misinformation}
              </option>
              <option value="privacy">{copy.report.reasons.privacy}</option>
              <option value="other">{copy.report.reasons.other}</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.report.detailsOptional}
            </span>
            <textarea
              name="details"
              maxLength={1000}
              className="focus-ring min-h-28 w-full resize-y rounded-md border border-[#dce1e5] p-3 text-sm leading-6 text-[#2b3a48]"
            />
          </label>
          <div className="flex flex-col-reverse gap-2 border-t border-[#edf0f2] pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={pending}
            >
              {copy.common.cancel}
            </Button>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Flag className="size-4" />
              )}
              {copy.report.submit}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OwnedContentEditDialog({
  content,
  mentionCandidates,
  locale,
  onClose,
  onSuccess,
}: {
  content: OwnedContent;
  mentionCandidates: MentionCandidate[];
  locale: AppLocale;
  onClose: () => void;
  onSuccess: (
    content: CommunityContentEditorSnapshot,
    moderationState: NonNullable<CommunityActionState["moderationState"]>,
    contentVersion: number,
  ) => void;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const targetLabel =
    content.kind === "post" ? copy.common.post : copy.common.answer;
  const updateAction =
    content.kind === "post"
      ? updateOwnPostAction.bind(null, content.id)
      : updateOwnCommentAction.bind(null, content.id);
  const [state, action, pending] = useActionState(
    updateAction,
    initialCommunityState,
  );
  const [draft, setDraft] = useState<CommunityContentEditorSnapshot>({
    content: content.content,
    contentFormat: content.contentFormat,
    richText: content.richText,
  });

  useEffect(() => {
    if (state.ok === true) {
      toast.success(
        state.moderationState === "published"
          ? content.kind === "post"
            ? copy.actions.postSaved
            : copy.actions.answerSaved
          : copy.actions.changeSubmitted,
      );
      onSuccess(
        draft,
        state.moderationState ?? "published",
        state.contentVersion ?? content.moderationVersion + 1,
      );
      onClose();
    } else if (state.ok === false) {
      toast.error(
        content.kind === "post"
          ? copy.actions.postSaveFailed
          : copy.actions.answerSaveFailed,
      );
    }
  }, [content.kind, content.moderationVersion, copy.actions, draft, onClose, onSuccess, state]);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-[#0f263c]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={copy.ownContent.editTitle(targetLabel)}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div className="my-4 w-full max-w-lg rounded-md bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e8ebee] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase text-[#2b9188]">
              {copy.ownContent.eyebrow}
            </p>
            <h2 className="mt-0.5 text-lg font-bold text-[#243444]">
              {copy.ownContent.editTitle(targetLabel)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3] disabled:opacity-50"
            aria-label={copy.common.closeDialog}
            title={copy.common.close}
          >
            <X className="size-5" />
          </button>
        </div>
        <form action={action} className="p-5">
          <input
            type="hidden"
            name="expectedContentVersion"
            value={content.moderationVersion}
          />
          <CommunityContentEditor
            candidates={mentionCandidates}
            locale={locale}
            placeholder={copy.ownContent.contentPlaceholder}
            minLength={content.kind === "post" ? 3 : 1}
            maxLength={content.kind === "post" ? 10000 : 5000}
            initialContent={content.content}
            initialFormat={content.contentFormat}
            initialRichText={content.richText}
            compact
            autoFocus
            disabled={pending}
            onSnapshotChange={setDraft}
          />
          <CommunityActionError
            locale={locale}
            fallbackMessage={resolveCommunityActionMessage(
              locale,
              state,
              "contentSaveFailed",
            )}
            state={{
              error: state.ok === false ? "localized-action-error" : undefined,
              profileHref: state.profileHref,
              missingFields: state.missingFields,
            }}
          />
          <div className="mt-4 flex justify-end border-t border-[#edf0f2] pt-4">
            <Button type="submit" disabled={pending}>
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Pencil className="size-4" />
              )}
              {copy.ownContent.saveChanges}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OwnedContentDeleteDialog({
  content,
  locale,
  onClose,
  onSuccess,
}: {
  content: OwnedContent;
  locale: AppLocale;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const targetLabel =
    content.kind === "post" ? copy.common.post : copy.common.answer;
  const [pending, startTransition] = useTransition();
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-[#0f263c]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={copy.ownContent.deleteTitle(targetLabel)}
    >
      <div className="w-full max-w-md rounded-md bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e8ebee] px-5 py-4">
          <h2 className="text-lg font-bold text-[#243444]">
            {copy.ownContent.deleteTitle(targetLabel)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3]"
            aria-label={copy.common.closeDialog}
            title={copy.common.close}
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <p className="rounded-md border border-[#f2c8c1] bg-[#fdf3f1] p-4 text-xs leading-5 text-[#8f3f36]">
            {content.kind === "post"
              ? copy.ownContent.deletePostWarning
              : copy.ownContent.deleteAnswerWarning}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              {copy.common.cancel}
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result =
                    content.kind === "post"
                      ? await deleteOwnPostAction(content.id)
                      : await deleteOwnCommentAction(content.id);
                  if (result.ok) {
                    toast.success(resolveCommunityActionMessage(locale, result));
                    onSuccess();
                    onClose();
                  } else {
                    toast.error(
                      resolveCommunityActionMessage(
                        locale,
                        result,
                        "contentDeleteFailed",
                      ),
                    );
                  }
                })
              }
            >
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {copy.ownContent.deleteAction}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CommunityFeed({
  posts,
  spaces,
  currentUserId,
  mentionCandidates,
  profileCompletion,
  locale,
}: {
  posts: PostRow[];
  spaces: Space[];
  currentUserId: string;
  mentionCandidates: MentionCandidate[];
  profileCompletion?: CommunityProfileCompletionView;
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const [view, setView] = useState<
    "all" | "discussion" | "announcement" | "highlights"
  >("all");
  const [editing, setEditing] = useState<OwnedContent | null>(null);
  const [deleting, setDeleting] = useState<OwnedContent | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const permissionsBySpace = new Map(
    spaces.map((space) => [space.id, space.permissions] as const),
  );
  const visiblePosts =
    view === "highlights"
      ? posts.filter(
          (post) => post.pinned || post.likeCount > 0 || post.commentCount > 0,
        )
      : view === "discussion" || view === "announcement"
        ? posts.filter((post) => post.spaceType === view)
        : posts;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto border-b border-[#dfe4e8]">
        {(
          [
            ["all", copy.feed.filters.all],
            ["discussion", copy.feed.filters.discussion],
            ["announcement", copy.feed.filters.announcement],
            ["highlights", copy.feed.filters.highlights],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setView(value)}
            aria-pressed={view === value}
            className={cn(
              "focus-ring h-10 shrink-0 border-b-2 px-4 text-xs font-semibold",
              view === value
                ? "border-[#2bb7a9] text-[#17324d]"
                : "border-transparent text-[#71808b] hover:text-[#455463]",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {visiblePosts.map((post) => (
        <article
          key={post.id}
          id={`post-${post.id}`}
          className={cn(
            "panel scroll-mt-24 p-4 sm:p-5",
            post.spaceType === "announcement" &&
              "border-l-4 border-l-[#4f7cac]",
          )}
        >
          <div className="flex items-start gap-3">
            <Link
              href={`/academy/community/members/${post.authorId}`}
              className="focus-ring shrink-0 rounded-full"
              aria-label={copy.profile.profileOf(
                `${post.firstName} ${post.lastName}`,
              )}
            >
              <Avatar
                firstName={post.firstName}
                lastName={post.lastName}
                src={post.authorAvatarUrl}
                size="lg"
              />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-[#2b3a48]">
                  <Link
                    href={`/academy/community/members/${post.authorId}`}
                    className="focus-ring rounded hover:text-[#17324d] hover:underline"
                  >
                    {post.firstName} {post.lastName}
                  </Link>
                </h2>
                <MemberBadges badges={post.badges} locale={locale} />
                <Badge tone="neutral" className="border-0">
                  {post.spaceTitle}
                </Badge>
                <Badge
                  tone={
                    post.spaceType === "announcement"
                      ? "blue"
                      : post.spaceType === "discussion"
                        ? "teal"
                        : "neutral"
                  }
                >
                  {post.spaceType === "announcement" ? (
                    <Megaphone className="mr-1 size-3" />
                  ) : post.spaceType === "discussion" ? (
                    <MessageCircle className="mr-1 size-3" />
                  ) : null}
                  {post.spaceType === "announcement"
                    ? copy.common.announcement
                    : post.spaceType === "discussion"
                      ? copy.common.discussion
                      : copy.common.feed}
                </Badge>
                {post.pinned ? (
                  <Badge tone="amber">
                    <Pin className="mr-1 size-3" />
                    {copy.common.highlight}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-0.5 text-[10px] text-[#82909a]">
                {post.jobTitle ?? copy.feed.memberFallback} -{" "}
                {formatDateTime(post.createdAt, locale)}
              </p>
              <FeedReasons reasonCodes={post.reasonCodes} locale={locale} />
            </div>
            {post.authorId === currentUserId ? (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setEditing({
                      kind: "post",
                      id: post.id,
                      content: post.content,
                      contentFormat: post.contentFormat,
                      richText: post.richText,
                      moderationVersion: post.moderationVersion,
                    })
                  }
                  className="focus-ring grid size-8 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3]"
                  aria-label={copy.ownContent.editOwnPost}
                  title={copy.ownContent.editPost}
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDeleting({
                      kind: "post",
                      id: post.id,
                      content: post.content,
                      contentFormat: post.contentFormat,
                      richText: post.richText,
                      moderationVersion: post.moderationVersion,
                    })
                  }
                  className="focus-ring grid size-8 place-items-center rounded-md text-[#a94339] hover:bg-[#fdf0ee]"
                  aria-label={copy.ownContent.deleteOwnPost}
                  title={copy.ownContent.deletePost}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex shrink-0 items-center gap-0.5">
                <AuthorFollowButton post={post} locale={locale} />
                <button
                  type="button"
                  onClick={() =>
                    setReporting({
                      targetType: "post",
                      id: post.id,
                    })
                  }
                  disabled={post.reported}
                  className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-[#7a8690] hover:bg-[#fdf0ee] hover:text-[#a94339] disabled:cursor-default disabled:bg-[#f3f5f6] disabled:text-[#a1aab1]"
                  aria-label={
                    post.reported
                      ? copy.report.postAlreadyReported
                      : copy.report.post
                  }
                  title={
                    post.reported ? copy.comments.reported : copy.report.post
                  }
                >
                  <Flag className="size-3.5" />
                </button>
              </div>
            )}
          </div>
          {post.title ? (
            <h3 className="mt-4 text-base font-bold text-[#243444]">
              {post.title}
            </h3>
          ) : null}
          <CommunityContent
            content={post.content}
            contentFormat={post.contentFormat}
            richText={post.richText}
            className={cn(
              "text-sm leading-7 text-[#455463]",
              post.title ? "mt-2" : "mt-4",
            )}
          />
          <CommunityAttachments
            attachments={post.attachments}
            locale={locale}
          />
          {post.courseLink ? (
            <Link
              href={post.courseLink.href}
              className="focus-ring mt-3 flex min-w-0 items-center gap-3 rounded-md border border-[#dce5e9] bg-[var(--theme-layer-background)] px-3 py-2.5 hover:border-[#b7d8d3] hover:bg-[var(--theme-input-background)]"
              data-testid="community-course-link"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded bg-[#e3f2f0] text-[#237b72]">
                <BookOpen className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] font-bold uppercase text-[var(--theme-teal-text)]">
                  {copy.common.course}
                </span>
                <span className="block truncate text-xs font-semibold text-[#2b3a48]">
                  {post.courseLink.title}
                </span>
              </span>
            </Link>
          ) : null}
          <div className="mt-4 border-t border-[#edf0f2] pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <ReactionBar
                postId={post.id}
                selected={post.myReaction}
                counts={{
                  like: post.likeReactionCount,
                  celebrate: post.celebrateReactionCount,
                  insightful: post.insightfulReactionCount,
                  question: post.questionReactionCount,
                }}
                locale={locale}
              />
              {post.spaceType === "discussion" ? (
                <VoteControl
                  postId={post.id}
                  score={post.voteScore}
                  selected={post.myVote}
                  locale={locale}
                />
              ) : null}
              <span className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-[#6f7b85]">
                <MessageCircle className="size-4" />
                {post.commentCount}
              </span>
              {post.locked ? (
                <span className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-[#7a8690]">
                  <LockKeyhole className="size-3.5" /> {copy.feed.repliesLocked}
                </span>
              ) : null}
            </div>
            <MemberCommentList
              key={`${post.id}:${post.updatedAt}:${post.commentCount}`}
              post={post}
              currentUserId={currentUserId}
              mentionCandidates={mentionCandidates}
              profileCompletion={profileCompletion}
              locale={locale}
              canReply={
                !post.locked &&
                post.spaceType !== "announcement" &&
                Boolean(permissionsBySpace.get(post.spaceId)?.canComment)
              }
              onEdit={(item) =>
                setEditing({
                  kind: "comment",
                  id: item.id,
                  content: item.content,
                  contentFormat: item.contentFormat,
                  richText: item.richText,
                  moderationVersion: item.moderationVersion,
                })
              }
              onDelete={(item) =>
                setDeleting({
                  kind: "comment",
                  id: item.id,
                  content: item.content,
                  contentFormat: item.contentFormat,
                  richText: item.richText,
                  moderationVersion: item.moderationVersion,
                })
              }
              onReport={(item) =>
                setReporting({
                  targetType: "comment",
                  id: item.id,
                })
              }
            />
            {!post.locked &&
            post.spaceType !== "announcement" &&
            permissionsBySpace.get(post.spaceId)?.canComment ? (
              <CommentForm
                postId={post.id}
                mentionCandidates={mentionCandidates}
                profileCompletion={profileCompletion}
                locale={locale}
              />
            ) : null}
          </div>
        </article>
      ))}
      {!visiblePosts.length ? (
        <div className="panel px-5 py-10 text-center">
          <MessageCircle className="mx-auto size-5 text-[#91a0aa]" />
          <p className="mt-2 text-sm font-semibold text-[#455463]">
            {copy.feed.emptyView}
          </p>
        </div>
      ) : null}
      {editing ? (
        <OwnedContentEditDialog
          content={editing}
          mentionCandidates={mentionCandidates}
          locale={locale}
          onClose={() => setEditing(null)}
          onSuccess={(content, moderationState, contentVersion) => {
            if (editing.kind === "comment") {
              emitCommunityCommentMutation(
                moderationState === "published"
                  ? {
                      type: "edited",
                      id: editing.id,
                      content: content.content,
                      contentFormat: content.contentFormat,
                      richText: content.richText,
                      moderationVersion: contentVersion,
                    }
                  : { type: "deleted", id: editing.id },
              );
            }
          }}
        />
      ) : null}
      {deleting ? (
        <OwnedContentDeleteDialog
          content={deleting}
          locale={locale}
          onClose={() => setDeleting(null)}
          onSuccess={() => {
            if (deleting.kind === "comment") {
              emitCommunityCommentMutation({
                type: "deleted",
                id: deleting.id,
              });
            }
          }}
        />
      ) : null}
      {reporting ? (
        <CommunityReportDialog
          key={`${reporting.targetType}-${reporting.id}`}
          target={reporting}
          locale={locale}
          onClose={() => setReporting(null)}
          onSuccess={() => {
            if (reporting.targetType === "comment") {
              emitCommunityCommentMutation({
                type: "reported",
                id: reporting.id,
              });
            }
          }}
        />
      ) : null}
    </div>
  );
}

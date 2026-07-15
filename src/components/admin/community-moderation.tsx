"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash2,
  Eye,
  Flag,
  Hash,
  LoaderCircle,
  LockKeyhole,
  MessageCircleMore,
  Pencil,
  Pin,
  PinOff,
  Save,
  ThumbsUp,
  Trash2,
  UnlockKeyhole,
  X,
} from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CommunityAttachments,
  type CommunityAttachmentView,
} from "@/components/academy/community-attachments";
import {
  emitCommunityCommentMutation,
  useCommunityCommentPagination,
} from "@/components/academy/community-comment-pagination";
import {
  deleteCommentAdminAction,
  deleteCommunitySpaceAdminAction,
  deletePostAdminAction,
  togglePostPinnedAdminAction,
  togglePostLockedAdminAction,
  updateCommunitySpaceAdminAction,
  type CommunityActionState,
} from "@/lib/community-actions";
import { moderateCommunityReportAdminAction } from "@/lib/community-report-actions";
import type {
  CommunityFeedCommentDto,
  CommunityFeedPageDto,
  CommunityFeedPostDto,
} from "@/lib/community-feed";
import {
  formatCommunityAdminDateTime,
  formatCommunityAdminNumber,
  getCommunityAdminCopy,
  localizeCommunityAdminAction,
} from "@/lib/i18n/community-admin";
import type { AppLocale } from "@/lib/i18n/model";

type CommunitySpaceRow = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  color: string;
  type: "feed" | "discussion" | "announcement";
  accessMode: "open" | "restricted";
  permissions: {
    canView: boolean;
    canPost: boolean;
    canComment: boolean;
    canManage: boolean;
  };
  postCount: number;
  commentCount: number;
};

type CommunityPostRow = CommunityFeedPostDto;

type CommunityReportRow = {
  id: string;
  targetType: "post" | "comment";
  targetId: string;
  contentExcerpt: string;
  attachments: CommunityAttachmentView[];
  reason: "spam" | "harassment" | "hate_speech" | "misinformation" | "privacy" | "other";
  details: string | null;
  status: "open" | "reviewing" | "resolved" | "dismissed";
  outcome: "dismissed" | "content_removed" | "content_missing" | null;
  resolutionNote: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  reporterName: string;
  targetAuthorName: string;
  handlerName: string | null;
};

const initialState: CommunityActionState = { ok: null, message: "" };
const inputClassName =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#2b3a48]";
const labelClassName = "mb-1.5 block text-xs font-semibold text-[#52606d]";

function responseFeedPage(payload: unknown, errorMessage: string): CommunityFeedPageDto {
  const candidate =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as { data: unknown }).data
      : payload;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !Array.isArray((candidate as { items?: unknown }).items)
  ) {
    throw new Error(errorMessage);
  }
  return candidate as CommunityFeedPageDto;
}

function mergeUniquePosts(
  current: CommunityFeedPostDto[],
  incoming: CommunityFeedPostDto[],
) {
  const byId = new Map(current.map((post) => [post.id, post]));
  for (const post of incoming) byId.set(post.id, post);
  return [...byId.values()];
}

function DialogFrame({
  title,
  eyebrow,
  onClose,
  children,
  pending = false,
  locale,
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: React.ReactNode;
  pending?: boolean;
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale).common;
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-[#0f263c]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div className="my-4 w-full max-w-lg rounded-md bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e8ebee] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase text-[#2b9188]">{eyebrow}</p>
            <h2 className="mt-0.5 truncate text-lg font-bold text-[#243444]">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="focus-ring grid size-9 shrink-0 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3] disabled:opacity-50"
            aria-label={copy.closeDialog}
            title={copy.close}
          >
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SpaceEditDialog({ space, onClose, locale }: { space: CommunitySpaceRow; onClose: () => void; locale: AppLocale }) {
  const copy = getCommunityAdminCopy(locale);
  const action = updateCommunitySpaceAdminAction.bind(null, space.id);
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.ok === true) {
      toast.success(localizeCommunityAdminAction(locale, state));
      onClose();
    } else if (state.ok === false) {
      toast.error(localizeCommunityAdminAction(locale, state));
    }
  }, [locale, onClose, state]);

  return (
    <DialogFrame title={copy.moderation.editSpaceTitle} eyebrow={copy.moderation.editSpaceEyebrow} onClose={onClose} pending={pending} locale={locale}>
      <form action={formAction} className="grid gap-4 p-5">
        <label>
          <span className={labelClassName}>{copy.common.title}</span>
          <input name="title" defaultValue={space.title} maxLength={160} required className={inputClassName} />
        </label>
        <label>
          <span className={labelClassName}>{copy.common.description}</span>
          <textarea
            name="description"
            defaultValue={space.description ?? ""}
            maxLength={5000}
            className="focus-ring min-h-24 w-full resize-y rounded-md border border-[#dce1e5] p-3 text-sm text-[#2b3a48]"
          />
        </label>
        <label>
          <span className={labelClassName}>{copy.moderation.forumType}</span>
          <select name="type" defaultValue={space.type} className={inputClassName}>
            <option value="feed">{copy.common.feed}</option>
            <option value="discussion">{copy.common.discussion}</option>
            <option value="announcement">{copy.common.announcement}</option>
          </select>
        </label>
        <label>
          <span className={labelClassName}>{copy.common.accentColor}</span>
          <span className="flex h-10 items-center gap-3 rounded-md border border-[#dce1e5] px-2">
            <input name="color" type="color" defaultValue={space.color} className="size-7 cursor-pointer border-0 bg-transparent p-0" />
            <span className="text-xs text-[#71808b]">{copy.moderation.colorHint}</span>
          </span>
        </label>
        <div className="flex justify-end border-t border-[#edf0f2] pt-4">
          <Button type="submit" disabled={pending}>
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            {copy.moderation.saveChanges}
          </Button>
        </div>
      </form>
    </DialogFrame>
  );
}

function SpaceDeleteDialog({ space, onClose, locale }: { space: CommunitySpaceRow; onClose: () => void; locale: AppLocale }) {
  const copy = getCommunityAdminCopy(locale);
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deleteCommunitySpaceAdminAction(space.id, confirmation);
      if (result.ok) {
        toast.success(localizeCommunityAdminAction(locale, result));
        onClose();
      } else toast.error(localizeCommunityAdminAction(locale, result));
    });
  }

  return (
    <DialogFrame title={copy.moderation.deleteSpaceTitle} eyebrow={copy.moderation.irreversible} onClose={onClose} pending={pending} locale={locale}>
      <div className="space-y-4 p-5">
        <div className="flex items-start gap-3 rounded-md border border-[#f2c8c1] bg-[#fdf3f1] p-4 text-[#8f3f36]">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <p className="text-xs leading-5">
            <strong className="block text-sm">{copy.moderation.deleteAllContent}</strong>
            {copy.moderation.deleteSpaceDetail(
              formatCommunityAdminNumber(space.postCount, locale),
              formatCommunityAdminNumber(space.commentCount, locale),
            )}
          </p>
        </div>
        <label>
          <span className={labelClassName}>{copy.moderation.confirmSpaceName(space.title)}</span>
          <input
            aria-label={copy.moderation.confirmSpaceAria}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            className={inputClassName}
          />
        </label>
        <div className="flex flex-col-reverse gap-2 border-t border-[#edf0f2] pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>{copy.common.cancel}</Button>
          <Button variant="danger" onClick={remove} disabled={pending || confirmation !== space.title}>
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {copy.common.deletePermanent}
          </Button>
        </div>
      </div>
    </DialogFrame>
  );
}

function DeleteContentDialog({
  kind,
  detail,
  onClose,
  onDelete,
  onSuccess,
  locale,
}: {
  kind: string;
  detail: string;
  onClose: () => void;
  onDelete: () => Promise<CommunityActionState>;
  onSuccess?: () => void;
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale);
  const [pending, startTransition] = useTransition();
  return (
    <DialogFrame title={copy.moderation.rejectTitle(kind)} eyebrow={copy.moderation.moderationEyebrow} onClose={onClose} pending={pending} locale={locale}>
      <div className="space-y-4 p-5">
        <div className="flex items-start gap-3 rounded-md border border-[#f2c8c1] bg-[#fdf3f1] p-4 text-[#8f3f36]">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <p className="text-xs leading-5">{detail}</p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>{copy.common.cancel}</Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await onDelete();
                if (result.ok) {
                  toast.success(localizeCommunityAdminAction(locale, result));
                  onSuccess?.();
                  onClose();
                } else toast.error(localizeCommunityAdminAction(locale, result));
              })
            }
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : <CircleSlash2 className="size-4" />}
            {copy.queue.reject}
          </Button>
        </div>
      </div>
    </DialogFrame>
  );
}

function ReportDecisionDialog({
  report,
  operation,
  onClose,
  locale,
}: {
  report: CommunityReportRow;
  operation: "dismiss" | "remove";
  onClose: () => void;
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const title = operation === "remove" ? copy.moderation.removeContent : copy.moderation.dismissReport;

  return (
    <DialogFrame title={title} eyebrow={copy.moderation.decisionEyebrow} onClose={onClose} pending={pending} locale={locale}>
      <div className="space-y-4 p-5">
        <div className="rounded-md border border-[#e3e7ea] bg-[#f7f9fa] p-3">
          <p className="text-[10px] font-bold uppercase text-[#7a8690]">
            {copy.moderation.contentBy(
              report.targetType === "post" ? copy.common.post : copy.common.reply,
              report.targetAuthorName,
            )}
          </p>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-[#455463]">{report.contentExcerpt}</p>
          <CommunityAttachments attachments={report.attachments} compact locale={locale} />
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.moderation.internalReason}</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            minLength={3}
            maxLength={1000}
            required
            autoFocus
            className="focus-ring min-h-28 w-full resize-y rounded-md border border-[#dce1e5] p-3 text-sm leading-6 text-[#2b3a48]"
          />
        </label>
        <div className="flex flex-col-reverse gap-2 border-t border-[#edf0f2] pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>{copy.common.cancel}</Button>
          <Button
            variant={operation === "remove" ? "danger" : "primary"}
            disabled={pending || note.trim().length < 3}
            onClick={() => startTransition(async () => {
              const result = await moderateCommunityReportAdminAction(report.id, operation, note);
              if (result.ok) {
                toast.success(localizeCommunityAdminAction(locale, result));
                onClose();
              } else toast.error(localizeCommunityAdminAction(locale, result));
            })}
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : operation === "remove" ? <Trash2 className="size-4" /> : <CheckCircle2 className="size-4" />}
            {title}
          </Button>
        </div>
      </div>
    </DialogFrame>
  );
}

function AdminCommentPreview({
  post,
  onDelete,
  locale,
}: {
  post: CommunityFeedPostDto;
  onDelete: (comment: CommunityFeedCommentDto) => void;
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale);
  const pagination = useCommunityCommentPagination({
    postId: post.id,
    initialComments: post.comments,
    totalCount: post.commentCount,
    locale,
  });

  function commentRow(comment: CommunityFeedCommentDto, nested: boolean) {
    return (
      <div
        key={comment.id}
        className={`flex items-start gap-2.5 py-3 ${
          nested ? "ml-5 border-l-2 border-[#dfe5ea] pl-3" : ""
        }`}
      >
        <Avatar
          firstName={comment.firstName}
          lastName={comment.lastName}
          src={comment.authorAvatarUrl}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold text-[#455463]">
            {comment.firstName} {comment.lastName}
            <span className="ml-2 font-normal text-[#89949d]">
              {formatCommunityAdminDateTime(comment.createdAt, locale)}
            </span>
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#53616e]">
            {comment.content}
          </p>
          <CommunityAttachments attachments={comment.attachments} compact locale={locale} />
        </div>
        <button
          type="button"
          onClick={() => onDelete(comment)}
          className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-[#a94339] hover:bg-[#fdf0ee]"
          aria-label={copy.moderation.rejectReplyBy(`${comment.firstName} ${comment.lastName}`)}
          title={copy.moderation.rejectReply}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    );
  }

  if (!post.commentCount) return null;

  return (
    <details className="mt-3 border-l-2 border-[#e7ecef] pl-3">
      <summary className="focus-ring cursor-pointer rounded py-1 text-xs font-semibold text-[#52606d]">
        {copy.moderation.commentSummary(
          formatCommunityAdminNumber(pagination.visibleCount, locale),
          formatCommunityAdminNumber(post.commentCount, locale),
        )}
      </summary>
      <div className="mt-2 divide-y divide-[#e8ecef]">
        {pagination.comments.map((comment) => {
          const replyControl = pagination.repliesControl(comment.id);
          return (
            <div key={comment.id}>
              {commentRow(comment, false)}
              {comment.replies.map((reply) => commentRow(reply, true))}
              {replyControl.canLoad ? (
                <div className="mb-2 ml-5 pl-3">
                  {replyControl.error ? (
                    <p className="mb-1 text-[10px] text-[#a94339]">
                      {replyControl.error}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      void pagination.loadMoreReplies(comment.id)
                    }
                    disabled={replyControl.loading}
                    className="focus-ring inline-flex min-h-8 items-center gap-1.5 rounded px-2 text-[10px] font-semibold text-[#52606d] hover:bg-[#f1f4f6] disabled:opacity-50"
                  >
                    {replyControl.loading ? (
                      <LoaderCircle className="size-3 animate-spin" />
                    ) : (
                      <MessageCircleMore className="size-3" />
                    )}
                    {replyControl.loading
                      ? copy.moderation.loadingReplies
                      : replyControl.error
                        ? copy.common.retry
                        : comment.replies.length
                          ? copy.moderation.loadMoreReplies
                          : copy.moderation.loadReplies}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {pagination.commentsControl.canLoad ? (
        <div className="border-t border-[#e8ecef] py-2">
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
              <MessageCircleMore className="size-3" />
            )}
            {pagination.commentsControl.loading
              ? copy.moderation.loadingComments
              : pagination.commentsControl.error
                ? copy.common.retry
                : copy.moderation.loadMoreComments}
          </button>
        </div>
      ) : null}
    </details>
  );
}

export function CommunityModeration({
  spaces,
  initialFeed,
  reports,
  locale,
}: {
  spaces: CommunitySpaceRow[];
  initialFeed: CommunityFeedPageDto;
  reports: CommunityReportRow[];
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale);
  const reportReasonLabels = copy.moderation.reportReasons;
  const reportStatusLabels = copy.moderation.reportStatuses;
  const [feed, setFeed] = useState(initialFeed);
  const [serverFeedAsOf, setServerFeedAsOf] = useState(initialFeed.asOf);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [feedAppendError, setFeedAppendError] = useState<string | null>(null);
  const feedController = useRef<AbortController | null>(null);
  const [editingSpace, setEditingSpace] = useState<CommunitySpaceRow | null>(null);
  const [deletingSpace, setDeletingSpace] = useState<CommunitySpaceRow | null>(null);
  const [deletingPost, setDeletingPost] = useState<CommunityPostRow | null>(null);
  const [deletingComment, setDeletingComment] = useState<{ id: string; postId: string } | null>(null);
  const [pendingPostId, setPendingPostId] = useState<string | null>(null);
  const [pendingReportId, setPendingReportId] = useState<string | null>(null);
  const [reportView, setReportView] = useState<"active" | "closed">("active");
  const [reportDecision, setReportDecision] = useState<{
    report: CommunityReportRow;
    operation: "dismiss" | "remove";
  } | null>(null);
  const [pinPending, startPinTransition] = useTransition();
  const [lockPending, startLockTransition] = useTransition();
  const [reportPending, startReportTransition] = useTransition();
  const posts = feed.items;

  if (serverFeedAsOf !== initialFeed.asOf) {
    setServerFeedAsOf(initialFeed.asOf);
    setFeed(initialFeed);
    setFeedAppendError(null);
  }

  useEffect(() => () => feedController.current?.abort(), []);

  const visibleReports = reports.filter((report) =>
    reportView === "active"
      ? report.status === "open" || report.status === "reviewing"
      : report.status === "resolved" || report.status === "dismissed",
  );

  function startReview(report: CommunityReportRow) {
    setPendingReportId(report.id);
    startReportTransition(async () => {
      const result = await moderateCommunityReportAdminAction(report.id, "review", "");
      setPendingReportId(null);
       if (result.ok) toast.success(localizeCommunityAdminAction(locale, result));
       else toast.error(localizeCommunityAdminAction(locale, result));
    });
  }

  function togglePin(post: CommunityPostRow) {
    setPendingPostId(post.id);
    startPinTransition(async () => {
      const result = await togglePostPinnedAdminAction(post.id);
      setPendingPostId(null);
       if (result.ok) toast.success(localizeCommunityAdminAction(locale, result));
       else toast.error(localizeCommunityAdminAction(locale, result));
    });
  }

  function toggleLock(post: CommunityPostRow) {
    setPendingPostId(post.id);
    startLockTransition(async () => {
      const result = await togglePostLockedAdminAction(post.id);
      setPendingPostId(null);
       if (result.ok) toast.success(localizeCommunityAdminAction(locale, result));
       else toast.error(localizeCommunityAdminAction(locale, result));
    });
  }

  async function loadMorePosts(reset = false) {
    if ((!reset && !feed.nextCursor) || feedLoadingMore || feedRefreshing) return;
    feedController.current?.abort();
    const controller = new AbortController();
    feedController.current = controller;
    setFeedLoadingMore(true);
    setFeedAppendError(null);
    let shouldAppend = !reset;
    try {
      const query = new URLSearchParams({
        mode: "latest",
        limit: "20",
      });
      if (!reset && feed.nextCursor) query.set("cursor", feed.nextCursor);
      let response = await fetch(`/api/community/feed?${query.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 422 && query.has("cursor")) {
        shouldAppend = false;
        query.delete("cursor");
        setFeedLoadingMore(false);
        setFeedRefreshing(true);
        response = await fetch(`/api/community/feed?${query.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
      }
      if (!response.ok) {
         throw new Error(copy.moderation.loadMoreFailed);
      }
       const incoming = responseFeedPage(await response.json(), copy.moderation.invalidPreview);
      if (controller.signal.aborted) return;
      setFeed((current) => ({
        ...incoming,
        items: shouldAppend
          ? mergeUniquePosts(current.items, incoming.items)
          : incoming.items,
      }));
    } catch (error) {
       if (!(error instanceof DOMException && error.name === "AbortError")) {
         setFeedAppendError(copy.moderation.loadMoreFailed);
      }
    } finally {
      if (!controller.signal.aborted) {
        setFeedLoadingMore(false);
        setFeedRefreshing(false);
      }
    }
  }

  return (
    <>
      <section className="panel overflow-hidden" aria-labelledby="community-reports-heading">
        <div className="flex flex-col gap-3 border-b border-[#e8ebee] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 id="community-reports-heading" className="flex items-center gap-2 text-sm font-bold text-[#243444]">
              <Flag className="size-4 text-[#b84e42]" /> {copy.moderation.reportsHeading}
            </h2>
            <p className="mt-1 text-[11px] text-[#7a8690]">{copy.moderation.openCases(formatCommunityAdminNumber(reports.filter((report) => report.status === "open" || report.status === "reviewing").length, locale))}</p>
          </div>
          <div className="inline-flex h-9 self-start rounded-md border border-[#dce1e5] bg-[#f6f8f9] p-0.5" aria-label={copy.moderation.reportView}>
            <button
              type="button"
              aria-pressed={reportView === "active"}
              onClick={() => setReportView("active")}
              className={`focus-ring rounded px-3 text-xs font-semibold ${reportView === "active" ? "bg-white text-[#243444] shadow-sm" : "text-[#71808b]"}`}
            >{copy.moderation.openView}</button>
            <button
              type="button"
              aria-pressed={reportView === "closed"}
              onClick={() => setReportView("closed")}
              className={`focus-ring rounded px-3 text-xs font-semibold ${reportView === "closed" ? "bg-white text-[#243444] shadow-sm" : "text-[#71808b]"}`}
            >{copy.moderation.closedView}</button>
          </div>
        </div>
        <div className="divide-y divide-[#edf0f2]">
          {visibleReports.map((report) => (
            <article key={report.id} id={`report-${report.id}`} className="p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={report.status === "open" ? "coral" : report.status === "reviewing" ? "amber" : "neutral"}>
                      {reportStatusLabels[report.status]}
                    </Badge>
                    <Badge tone="neutral">{reportReasonLabels[report.reason]}</Badge>
                     <span className="text-[10px] text-[#87919a]">{formatCommunityAdminDateTime(report.createdAt, locale)}</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#455463]">{report.contentExcerpt}</p>
                   <CommunityAttachments attachments={report.attachments} compact locale={locale} />
                  <dl className="mt-3 grid gap-2 text-[11px] text-[#71808b] sm:grid-cols-3">
                     <div><dt className="font-semibold text-[#52606d]">{copy.moderation.reportedBy}</dt><dd>{report.reporterName}</dd></div>
                     <div><dt className="font-semibold text-[#52606d]">{copy.moderation.author}</dt><dd>{report.targetAuthorName}</dd></div>
                     <div><dt className="font-semibold text-[#52606d]">{copy.moderation.content}</dt><dd>{report.targetType === "post" ? copy.common.post : copy.common.reply}</dd></div>
                  </dl>
                  {report.details ? <p className="mt-3 rounded-md bg-[#f7f9fa] p-3 text-xs leading-5 text-[#52606d]">{report.details}</p> : null}
                  {report.resolutionNote ? (
                     <p className="mt-3 text-xs leading-5 text-[#52606d]"><span className="font-semibold">{copy.moderation.decision}:</span> {report.resolutionNote}</p>
                  ) : null}
                </div>
                {report.status === "open" || report.status === "reviewing" ? (
                  <div className="flex shrink-0 flex-wrap gap-2 lg:max-w-72 lg:justify-end">
                    {report.status === "open" ? (
                      <Button
                        variant="secondary"
                        disabled={reportPending && pendingReportId === report.id}
                        onClick={() => startReview(report)}
                      >
                        {reportPending && pendingReportId === report.id ? <LoaderCircle className="size-4 animate-spin" /> : <Eye className="size-4" />}
                         {copy.moderation.startReview}
                      </Button>
                    ) : null}
                    <Button variant="secondary" onClick={() => setReportDecision({ report, operation: "dismiss" })}>
                       <CheckCircle2 className="size-4" /> {copy.moderation.dismiss}
                    </Button>
                    <Button variant="danger" onClick={() => setReportDecision({ report, operation: "remove" })}>
                       <Trash2 className="size-4" /> {copy.moderation.removeContentButton}
                    </Button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
          {!visibleReports.length ? (
            <p className="px-5 py-9 text-center text-sm text-[#71808b]">
               {reportView === "active" ? copy.moderation.noOpenReports : copy.moderation.noClosedReports}
            </p>
          ) : null}
        </div>
      </section>

      <section className="panel overflow-hidden" aria-labelledby="community-spaces-heading">
        <div className="border-b border-[#e8ebee] px-4 py-3 sm:px-5">
          <h2 id="community-spaces-heading" className="flex items-center gap-2 text-sm font-bold text-[#243444]">
             <Hash className="size-4 text-[#2b9188]" /> {copy.moderation.spacesHeading}
          </h2>
           <p className="mt-1 text-[11px] text-[#7a8690]">{copy.moderation.spacesDescription}</p>
        </div>
        <div className="divide-y divide-[#edf0f2]">
          {spaces.map((space) => (
            <div key={space.id} id={`space-${space.id}`} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
              <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: space.color }} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#354555]">{space.title}</p>
                 <p className="mt-0.5 line-clamp-1 text-xs text-[#7a8690]">{space.description || copy.common.noDescription}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={space.type === "announcement" ? "blue" : space.type === "discussion" ? "teal" : "neutral"}>
                   {space.type === "announcement" ? copy.common.announcement : space.type === "discussion" ? copy.common.discussion : copy.common.feed}
                </Badge>
                 <Badge tone="neutral">{copy.moderation.postsCount(formatCommunityAdminNumber(space.postCount, locale))}</Badge>
                 <Badge tone="neutral">{copy.moderation.repliesCount(formatCommunityAdminNumber(space.commentCount, locale))}</Badge>
                <button
                  type="button"
                  onClick={() => setEditingSpace(space)}
                  className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3]"
                   aria-label={copy.layout.editSpace(space.title)}
                   title={copy.moderation.editSpaceTitle}
                ><Pencil className="size-4" /></button>
                <button
                  type="button"
                  onClick={() => setDeletingSpace(space)}
                  className="focus-ring grid size-9 place-items-center rounded-md text-[#a94339] hover:bg-[#fdf0ee]"
                   aria-label={copy.layout.deleteSpace(space.title)}
                   title={copy.moderation.deleteSpaceTitle}
                ><Trash2 className="size-4" /></button>
              </div>
            </div>
          ))}
           {!spaces.length ? <p className="px-5 py-8 text-center text-sm text-[#71808b]">{copy.moderation.emptySpaces}</p> : null}
        </div>
      </section>

      <section className="panel overflow-hidden" aria-labelledby="community-feed-heading">
        <div className="border-b border-[#e8ebee] px-4 py-3 sm:px-5">
           <h2 id="community-feed-heading" className="text-sm font-bold text-[#243444]">{copy.moderation.feedHeading}</h2>
          <p className="mt-1 text-[11px] text-[#7a8690]">
             {copy.moderation.loadedPosts(formatCommunityAdminNumber(posts.length, locale))}
          </p>
          {feedRefreshing ? (
            <p
              className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#365f8d]"
              role="status"
            >
              <LoaderCircle className="size-3 animate-spin" />
               {copy.moderation.refreshing}
            </p>
          ) : null}
        </div>
        <div className="divide-y divide-[#edf0f2]">
          {posts.map((post) => (
            <article key={post.id} id={`post-${post.id}`} className="p-4 sm:p-5">
              <div className="flex items-start gap-3 sm:gap-4">
                <Avatar
                  firstName={post.firstName}
                  lastName={post.lastName}
                  src={post.authorAvatarUrl}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold text-[#354555]">{post.firstName} {post.lastName}</p>
                    <Badge tone="neutral">{post.spaceTitle}</Badge>
                    <Badge tone={post.spaceType === "announcement" ? "blue" : post.spaceType === "discussion" ? "teal" : "neutral"}>
                       {post.spaceType === "announcement" ? copy.common.announcement : post.spaceType === "discussion" ? copy.common.discussion : copy.common.feed}
                    </Badge>
                     {post.pinned ? <Badge tone="amber"><Pin className="mr-1 size-3" />{copy.moderation.pinned}</Badge> : null}
                     {post.locked ? <Badge tone="neutral"><LockKeyhole className="mr-1 size-3" />{copy.moderation.locked}</Badge> : null}
                     <span className="text-[10px] text-[#8a949d]">{formatCommunityAdminDateTime(post.createdAt, locale)}</span>
                  </div>
                  {post.title ? <h3 className="mt-2 text-sm font-bold text-[#243444]">{post.title}</h3> : null}
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#52606d]">{post.content}</p>
                   <CommunityAttachments attachments={post.attachments} compact locale={locale} />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#edf0f2] pt-3">
                    <div className="flex items-center gap-4 text-[10px] text-[#7a8690]">
                      <span className="flex items-center gap-1"><ThumbsUp className="size-3.5" />{post.likeCount}</span>
                      <span className="flex items-center gap-1"><MessageCircleMore className="size-3.5" />{post.commentCount}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => togglePin(post)}
                        disabled={pinPending && pendingPostId === post.id}
                        className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3] disabled:opacity-50"
                         aria-label={post.pinned ? copy.moderation.unpin : copy.moderation.pin}
                         title={post.pinned ? copy.moderation.unpin : copy.moderation.pin}
                      >
                        {pinPending && pendingPostId === post.id ? <LoaderCircle className="size-4 animate-spin" /> : post.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleLock(post)}
                        disabled={lockPending && pendingPostId === post.id}
                        className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3] disabled:opacity-50"
                         aria-label={post.locked ? copy.moderation.unlockReplies : copy.moderation.lockReplies}
                         title={post.locked ? copy.moderation.unlockReplies : copy.moderation.lockReplies}
                      >
                        {lockPending && pendingPostId === post.id ? <LoaderCircle className="size-4 animate-spin" /> : post.locked ? <UnlockKeyhole className="size-4" /> : <LockKeyhole className="size-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingPost(post)}
                        className="focus-ring grid size-9 place-items-center rounded-md text-[#a94339] hover:bg-[#fdf0ee]"
                         aria-label={copy.moderation.rejectPost}
                         title={copy.moderation.rejectPost}
                      ><Trash2 className="size-4" /></button>
                    </div>
                  </div>

                  <AdminCommentPreview
                    key={`${post.id}:${post.updatedAt}:${post.commentCount}`}
                    post={post}
                     onDelete={(comment) =>
                       setDeletingComment({ id: comment.id, postId: post.id })
                     }
                     locale={locale}
                  />
                </div>
              </div>
            </article>
          ))}
           {!posts.length ? <p className="px-5 py-10 text-center text-sm text-[#71808b]">{copy.moderation.emptyPosts}</p> : null}
        </div>
        {feed.hasMore && feed.nextCursor ? (
          <div className="flex flex-col items-center gap-2 border-t border-[#e8ebee] px-4 py-4 sm:px-5">
            {feedAppendError ? (
              <p className="text-center text-xs text-[#a94339]">
                {feedAppendError}
              </p>
            ) : null}
            <Button
              variant="secondary"
              disabled={feedLoadingMore || feedRefreshing}
              onClick={() => void loadMorePosts(Boolean(feedAppendError))}
            >
              {feedLoadingMore ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              {feedLoadingMore
                 ? copy.common.loading
                : feedAppendError
                   ? copy.common.retry
                   : copy.moderation.morePosts}
            </Button>
          </div>
        ) : null}
      </section>

      {editingSpace ? <SpaceEditDialog space={editingSpace} onClose={() => setEditingSpace(null)} locale={locale} /> : null}
      {deletingSpace ? <SpaceDeleteDialog space={deletingSpace} onClose={() => setDeletingSpace(null)} locale={locale} /> : null}
      {deletingPost ? (
        <DeleteContentDialog
          kind={copy.common.post}
          detail={copy.moderation.postRejectDetail}
          onClose={() => setDeletingPost(null)}
          onDelete={() => deletePostAdminAction(deletingPost.id)}
          locale={locale}
        />
      ) : null}
      {deletingComment ? (
        <DeleteContentDialog
          kind={copy.common.reply}
          detail={copy.moderation.replyRejectDetail}
          onClose={() => setDeletingComment(null)}
          onDelete={() => deleteCommentAdminAction(deletingComment.id)}
          locale={locale}
          onSuccess={() =>
            emitCommunityCommentMutation({
              type: "deleted",
              id: deletingComment.id,
            })
          }
        />
      ) : null}
      {reportDecision ? (
        <ReportDecisionDialog
          report={reportDecision.report}
          operation={reportDecision.operation}
          onClose={() => setReportDecision(null)}
          locale={locale}
        />
      ) : null}
    </>
  );
}

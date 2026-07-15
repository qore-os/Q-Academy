"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock3,
  Download,
  FileArchive,
  FileJson2,
  Fingerprint,
  LoaderCircle,
  LockKeyhole,
  Play,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import {
  approvePrivacyRequestOwnerAction,
  cancelPrivacyRequestOwnerAction,
  createPrivacyLegalHoldOwnerAction,
  processPrivacyRequestOwnerAction,
  rejectPrivacyRequestOwnerAction,
  releasePrivacyLegalHoldOwnerAction,
  verifyPrivacyIdentityOwnerAction,
  type PrivacyOwnerActionState,
} from "@/lib/privacy/owner-actions";
import {
  OwnerStepUpControl,
  type OwnerStepUpMode,
} from "@/components/admin/owner-step-up-control";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import {
  getPrivacyAdminCopy,
  type PrivacyAdminCopy,
} from "@/lib/i18n/privacy-admin";
import { useHydrated } from "@/lib/use-hydrated";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

type RequestStatus =
  | "received"
  | "identity_verified"
  | "approved"
  | "processing"
  | "blocked"
  | "completed"
  | "rejected"
  | "cancelled"
  | "failed";

type RequestRecord = {
  id: string;
  clientRequestId: string;
  type: "access_export" | "erasure";
  status: RequestStatus;
  statusReason: string | null;
  dueAt: string;
  identityVerifiedAt: string | null;
  approvedAt: string | null;
  processingStartedAt: string | null;
  completedAt: string | null;
  policyVersion: string | null;
  policySnapshot: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type EventRecord = {
  id: string;
  event: string;
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type HoldRecord = {
  id: string;
  reference: string;
  scope: string;
  reason: string;
  legalBasis: string;
  startsAt: string;
  expiresAt: string | null;
  releasedAt: string | null;
  releaseReason: string | null;
};

type ArtifactRecord = {
  id: string;
  status: "building" | "ready" | "failed" | "deleted";
  format: "json" | "zip";
  safeFileName: string;
  contentType: string;
  artifactSha256: string | null;
  sizeBytes: number | null;
  fileCount: number | null;
  expiresAt: string;
  readyAt: string | null;
  deletedAt: string | null;
  failureCode: string | null;
};

type ActionKind = "verify" | "approve" | "process" | "reject" | "cancel";
const initialState: PrivacyOwnerActionState = { ok: null, message: "" };
type PrivacyWorkflowAction = (
  state: PrivacyOwnerActionState,
  formData: FormData,
) => Promise<PrivacyOwnerActionState>;

const statusTones: Record<
  RequestStatus,
  "neutral" | "teal" | "coral" | "amber" | "blue" | "navy"
> = {
  received: "blue",
  identity_verified: "navy",
  approved: "teal",
  processing: "blue",
  blocked: "amber",
  completed: "teal",
  rejected: "coral",
  cancelled: "neutral",
  failed: "coral",
};

function actionConfiguration(copy: PrivacyAdminCopy): Record<
  ActionKind,
  {
    title: string;
    submit: string;
    action: PrivacyWorkflowAction;
    icon: typeof Fingerprint;
    reason: boolean;
    danger: boolean;
  }
> {
  return {
  verify: {
    title: copy.actions.verifyTitle,
    submit: copy.actions.verify,
    action: verifyPrivacyIdentityOwnerAction,
    icon: Fingerprint,
    reason: false,
    danger: false,
  },
  approve: {
    title: copy.actions.approveTitle,
    submit: copy.actions.approve,
    action: approvePrivacyRequestOwnerAction,
    icon: CheckCircle2,
    reason: false,
    danger: false,
  },
  process: {
    title: copy.actions.processTitle,
    submit: copy.actions.process,
    action: processPrivacyRequestOwnerAction,
    icon: Play,
    reason: false,
    danger: false,
  },
  reject: {
    title: copy.actions.rejectTitle,
    submit: copy.actions.reject,
    action: rejectPrivacyRequestOwnerAction,
    icon: Ban,
    reason: true,
    danger: true,
  },
  cancel: {
    title: copy.actions.cancelTitle,
    submit: copy.actions.cancel,
    action: cancelPrivacyRequestOwnerAction,
    icon: X,
    reason: true,
    danger: true,
  },
  };
}

const reasonKeys = {
  binary_media_export_pending: "binary_media_export_pending",
  erasure_executor_pending: "erasure_executor_pending",
  legal_hold_active: "legal_hold_active",
  structured_export_failed: "structured_export_failed",
  export_package_failed: "export_package_failed",
  erasure_execution_failed: "erasure_execution_failed",
} as const;

const eventKeys = {
  "request.received": "requestReceived",
  "identity.verified": "identityVerified",
  "request.approved": "requestApproved",
  "request.rejected": "requestRejected",
  "request.cancelled": "requestCancelled",
  "request.blocked": "requestBlocked",
  "export.processing_started": "exportStarted",
  "export.json_ready": "exportJsonReady",
  "export.zip_ready": "exportZipReady",
  "export.failed": "exportFailed",
  "erasure.processing_started": "erasureStarted",
  "erasure.completed": "erasureCompleted",
  "erasure.failed": "erasureFailed",
  "legal_hold.created": "holdCreated",
  "legal_hold.released": "holdReleased",
} as const;

const holdScopes = [
  "all", "profile", "authentication", "learning", "certificates",
  "community", "feedback", "events", "gamification", "ai", "media",
  "audit", "integrations", "communications",
] as const;

function WorkflowDialog({
  kind,
  requestId,
  ownerStepUpMode,
  onClose,
  copy,
  locale,
}: {
  kind: ActionKind;
  requestId: string;
  ownerStepUpMode: OwnerStepUpMode;
  onClose: () => void;
  copy: PrivacyAdminCopy;
  locale: AppLocale;
}) {
  const config = actionConfiguration(copy)[kind];
  const [state, action, pending] = useActionState(config.action, initialState);
  const router = useRouter();
  useEffect(() => {
    if (state.ok) {
      router.refresh();
      onClose();
    }
  }, [onClose, router, state.ok]);
  const Icon = config.icon;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[#0f263c]/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-md bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e5e9ec] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-md bg-[#eef3f4] text-[#246d68]">
              <Icon className="size-4" />
            </span>
            <h2 className="text-base font-bold text-[#243444]">{config.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="focus-ring grid size-9 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3]" aria-label={copy.common.closeDialog}>
            <X className="size-5" />
          </button>
        </div>
        <form action={action} className="space-y-4 p-5">
          <input type="hidden" name="requestId" value={requestId} />
          {config.reason ? (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.common.reason}</span>
              <textarea name="reason" required minLength={4} maxLength={1000} className="focus-ring min-h-24 w-full rounded-md border border-[#dce1e5] p-3 text-sm" />
            </label>
          ) : null}
          <OwnerStepUpControl
            mode={ownerStepUpMode}
            returnTo={`/admin/privacy/${requestId}`}
            locale={locale}
            passwordLabel={copy.stepUp.password}
            oidcDescription={copy.stepUp.oidcDescription}
            oidcButtonLabel={copy.stepUp.oidcButton}
            oidcErrorMessage={copy.stepUp.oidcError}
          />
          {state.message ? (
            <p role="status" className={cn("rounded-md border px-3 py-2 text-sm", state.ok ? "border-[#b9e8e3] bg-[#e9f8f6] text-[#167e74]" : "border-[#f4c8c2] bg-[#fdf0ee] text-[#a9473d]")}>{state.code ? copy.messages[state.code] : copy.messages.statusFailed}</p>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-4">
            <Button variant="secondary" onClick={onClose} disabled={pending}>{copy.common.cancel}</Button>
            <Button type="submit" variant={config.danger ? "danger" : "primary"} disabled={pending}>
              {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Icon className="size-4" />}
              {config.submit}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LegalHoldDialog({ requestId, ownerStepUpMode, onClose, copy, locale }: { requestId: string; ownerStepUpMode: OwnerStepUpMode; onClose: () => void; copy: PrivacyAdminCopy; locale: AppLocale }) {
  const [state, action, pending] = useActionState(createPrivacyLegalHoldOwnerAction, initialState);
  const router = useRouter();
  useEffect(() => {
    if (state.ok) {
      router.refresh();
      onClose();
    }
  }, [onClose, router, state.ok]);
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[#0f263c]/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-md bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-[#e5e9ec] bg-white px-5 py-4">
          <h2 className="text-base font-bold text-[#243444]">{copy.holds.createTitle}</h2>
          <button type="button" onClick={onClose} className="focus-ring grid size-9 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3]" aria-label={copy.common.closeDialog}><X className="size-5" /></button>
        </div>
        <form action={action} className="grid gap-4 p-5 sm:grid-cols-2">
          <input type="hidden" name="requestId" value={requestId} />
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.holds.reference}</span>
            <input name="reference" required minLength={4} maxLength={180} className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm" />
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.holds.scope}</span>
            <select name="scope" className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm">
              {holdScopes.map((scope) => <option key={scope} value={scope}>{copy.scopes[scope]}</option>)}
            </select>
          </label>
          <label className="sm:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.common.reason}</span>
            <textarea name="reason" required minLength={4} maxLength={1000} className="focus-ring min-h-20 w-full rounded-md border border-[#dce1e5] p-3 text-sm" />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.holds.legalBasis}</span>
            <textarea name="legalBasis" required minLength={4} maxLength={1000} className="focus-ring min-h-20 w-full rounded-md border border-[#dce1e5] p-3 text-sm" />
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.holds.expires}</span>
            <input name="expiresAt" type="datetime-local" className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm" />
          </label>
          <OwnerStepUpControl
            mode={ownerStepUpMode}
            returnTo={`/admin/privacy/${requestId}`}
            locale={locale}
            passwordLabel={copy.stepUp.password}
            oidcDescription={copy.stepUp.oidcDescription}
            oidcButtonLabel={copy.stepUp.oidcButton}
            oidcErrorMessage={copy.stepUp.oidcError}
          />
          {state.message ? <p role="status" className="sm:col-span-2 rounded-md border border-[#f4c8c2] bg-[#fdf0ee] px-3 py-2 text-sm text-[#a9473d]">{state.code ? copy.messages[state.code] : copy.messages.holdCreateFailed}</p> : null}
          <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-4 sm:col-span-2">
            <Button variant="secondary" onClick={onClose} disabled={pending}>{copy.common.cancel}</Button>
            <Button type="submit" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}{copy.holds.create}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReleaseHoldDialog({ requestId, hold, ownerStepUpMode, onClose, copy, locale }: { requestId: string; hold: HoldRecord; ownerStepUpMode: OwnerStepUpMode; onClose: () => void; copy: PrivacyAdminCopy; locale: AppLocale }) {
  const action = useMemo(() => releasePrivacyLegalHoldOwnerAction.bind(null, hold.id), [hold.id]);
  const [state, formAction, pending] = useActionState(action, initialState);
  const router = useRouter();
  useEffect(() => {
    if (state.ok) {
      router.refresh();
      onClose();
    }
  }, [onClose, router, state.ok]);
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[#0f263c]/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-md bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e5e9ec] px-5 py-4"><h2 className="text-base font-bold text-[#243444]">{copy.holds.releaseTitle}</h2><button type="button" onClick={onClose} aria-label={copy.common.closeDialog} className="focus-ring grid size-9 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3]"><X className="size-5" /></button></div>
        <form action={formAction} className="space-y-4 p-5">
          <input type="hidden" name="requestId" value={requestId} />
          <p className="font-mono text-xs text-[#687582]">{hold.reference}</p>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.common.reason}</span><textarea name="reason" required minLength={4} maxLength={1000} className="focus-ring min-h-20 w-full rounded-md border border-[#dce1e5] p-3 text-sm" /></label>
          <OwnerStepUpControl
            mode={ownerStepUpMode}
            returnTo={`/admin/privacy/${requestId}`}
            locale={locale}
            passwordLabel={copy.stepUp.password}
            oidcDescription={copy.stepUp.oidcDescription}
            oidcButtonLabel={copy.stepUp.oidcButton}
            oidcErrorMessage={copy.stepUp.oidcError}
          />
          {state.message ? <p role="status" className="rounded-md border border-[#f4c8c2] bg-[#fdf0ee] px-3 py-2 text-sm text-[#a9473d]">{state.code ? copy.messages[state.code] : copy.messages.holdReleaseFailed}</p> : null}
          <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-4"><Button variant="secondary" onClick={onClose} disabled={pending}>{copy.common.cancel}</Button><Button type="submit" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}{copy.holds.release}</Button></div>
        </form>
      </div>
    </div>
  );
}

function DownloadDialog({ requestId, artifact, ownerStepUpMode, onClose, copy, locale }: { requestId: string; artifact: ArtifactRecord; ownerStepUpMode: OwnerStepUpMode; onClose: () => void; copy: PrivacyAdminCopy; locale: AppLocale }) {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[#0f263c]/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-md bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e5e9ec] px-5 py-4"><h2 className="text-base font-bold text-[#243444]">{copy.detail.downloadTitle}</h2><button type="button" onClick={onClose} aria-label={copy.common.closeDialog} className="focus-ring grid size-9 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3]"><X className="size-5" /></button></div>
        <form action={`/admin/privacy/${requestId}/download`} method="post" className="space-y-4 p-5">
          <input type="hidden" name="artifactId" value={artifact.id} />
          <p className="text-sm font-semibold text-[#344454]">{artifact.safeFileName}</p>
          <OwnerStepUpControl
            mode={ownerStepUpMode}
            returnTo={`/admin/privacy/${requestId}`}
            locale={locale}
            passwordLabel={copy.stepUp.password}
            oidcDescription={copy.stepUp.oidcDescription}
            oidcButtonLabel={copy.stepUp.oidcButton}
            oidcErrorMessage={copy.stepUp.oidcError}
          />
          <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-4"><Button variant="secondary" onClick={onClose}>{copy.common.cancel}</Button><Button type="submit"><Download className="size-4" />{copy.common.download}</Button></div>
        </form>
      </div>
    </div>
  );
}

function bytes(value: number | null, locale: AppLocale) {
  if (!value) return "-";
  return new Intl.NumberFormat(intlLocale(locale), { style: "unit", unit: value >= 1_000_000 ? "megabyte" : "kilobyte", maximumFractionDigits: 1 }).format(value / (value >= 1_000_000 ? 1_000_000 : 1_000));
}

export function PrivacyRequestDetail({
  request,
  subject,
  events,
  holds,
  artifacts,
  referenceTime,
  ownerStepUpMode,
  locale,
}: {
  request: RequestRecord;
  subject: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  } | null;
  events: EventRecord[];
  holds: HoldRecord[];
  artifacts: ArtifactRecord[];
  referenceTime: string;
  ownerStepUpMode: OwnerStepUpMode;
  locale: AppLocale;
}) {
  const copy = getPrivacyAdminCopy(locale);
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(intlLocale(locale)),
    [locale],
  );
  const configurations = actionConfiguration(copy);
  const [workflowAction, setWorkflowAction] = useState<ActionKind | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const [releaseHold, setReleaseHold] = useState<HoldRecord | null>(null);
  const [downloadArtifact, setDownloadArtifact] = useState<ArtifactRecord | null>(null);
  const hydrated = useHydrated();
  const actions: ActionKind[] = request.status === "received" ? ["verify", "reject", "cancel"] : request.status === "identity_verified" ? ["approve", "reject", "cancel"] : request.status === "approved" ? ["process", "cancel"] : ["blocked", "failed"].includes(request.status) ? ["approve"] : [];
  const now = new Date(referenceTime).getTime();
  const overdue = new Date(request.dueAt).getTime() < now && !["completed", "rejected", "cancelled"].includes(request.status);
  const reasonKey = request.statusReason
    ? reasonKeys[request.statusReason as keyof typeof reasonKeys]
    : undefined;
  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div>
        <Link href="/admin/privacy" className={buttonClassName({ variant: "ghost", size: "sm", className: "-ml-3" })}>
          <ArrowLeft className="size-4" />{copy.detail.back}
        </Link>
      </div>
      <header className="flex flex-col gap-4 border-b border-[#dde3e7] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase text-[#2b9188]">{copy.detail.eyebrow}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="break-all font-mono text-xl font-bold text-[#17212b] sm:text-2xl">{request.clientRequestId}</h1>
            <Badge tone={statusTones[request.status]}>{copy.statuses[request.status]}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((kind) => {
            const config = configurations[kind];
            const Icon = config.icon;
            return (
              <Button
                key={kind}
                variant={config.danger ? "danger" : kind === "process" ? "primary" : "secondary"}
                onClick={() => setWorkflowAction(kind)}
                disabled={!hydrated}
              >
                <Icon className="size-4" />{config.submit}
              </Button>
            );
          })}
        </div>
      </header>

      {request.statusReason ? (
        <div className="flex items-start gap-3 rounded-md border border-[#ead9a8] bg-[#fbf6e7] px-4 py-3 text-sm text-[#755b18]">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>{reasonKey ? copy.reasons[reasonKey] : request.statusReason}</span>
        </div>
      ) : null}

      <section className="grid gap-px overflow-hidden rounded-md border border-[#e1e5e8] bg-[#e1e5e8] sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-white p-4">
          <p className="text-[10px] font-bold uppercase text-[#7a8691]">{copy.detail.subject}</p>
          <p className="mt-2 text-sm font-semibold text-[#243444]">{subject ? `${subject.firstName} ${subject.lastName}` : copy.manager.pseudonymized}</p>
          {subject ? <p className="mt-1 break-all text-xs text-[#687582]">{subject.email}</p> : null}
        </div>
        <div className="bg-white p-4">
          <p className="text-[10px] font-bold uppercase text-[#7a8691]">{copy.detail.type}</p>
          <p className="mt-2 text-sm font-semibold text-[#243444]">{copy.types[request.type]}</p>
          <p className="mt-1 text-xs text-[#687582]">{request.policyVersion ?? copy.detail.noPolicy}</p>
        </div>
        <div className="bg-white p-4">
          <p className="text-[10px] font-bold uppercase text-[#7a8691]">{copy.detail.due}</p>
          <p className={cn("mt-2 inline-flex items-center gap-1.5 text-sm font-semibold", overdue ? "text-[#b84e42]" : "text-[#243444]")}>
            <Clock3 className="size-4" />{formatDate(request.dueAt, undefined, locale)}
          </p>
          <p className="mt-1 text-xs text-[#687582]">{copy.detail.received(formatDateTime(request.createdAt, locale))}</p>
        </div>
        <div className="bg-white p-4">
          <p className="text-[10px] font-bold uppercase text-[#7a8691]">{copy.detail.review}</p>
          <p className="mt-2 text-sm font-semibold text-[#243444]">{request.identityVerifiedAt ? copy.detail.identityConfirmed : copy.detail.identityOpen}</p>
          <p className="mt-1 text-xs text-[#687582]">{request.approvedAt ? copy.detail.approval(formatDateTime(request.approvedAt, locale)) : copy.detail.approvalOpen}</p>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]">
        <section className="overflow-hidden rounded-md border border-[#e1e5e8] bg-white">
          <div className="flex items-center justify-between border-b border-[#e8ecef] px-4 py-3">
            <div><p className="text-[10px] font-bold uppercase text-[#2b9188]">{copy.detail.history}</p><h2 className="mt-0.5 text-base font-bold text-[#243444]">{copy.detail.timeline}</h2></div>
            <ShieldCheck className="size-5 text-[#598a85]" />
          </div>
          {events.length ? (
            <ol className="divide-y divide-[#edf0f2]">
              {events.map((event, index) => {
                const eventKey = eventKeys[event.event as keyof typeof eventKeys];
                return (
                  <li key={event.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 px-4 py-4">
                    <span className="grid size-7 place-items-center rounded-full border border-[#cfd9dd] bg-[#f5f8f8] text-[10px] font-bold text-[#50736f]">{numberFormatter.format(index + 1)}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[#344454]">{eventKey ? copy.events[eventKey] : copy.detail.unknownEvent}</p>
                        <time className="text-[11px] text-[#7a8691]">{formatDateTime(event.createdAt, locale)}</time>
                      </div>
                      {event.fromStatus && event.toStatus ? <p className="mt-1 text-xs text-[#66727f]">{copy.statuses[event.fromStatus]} -&gt; {copy.statuses[event.toStatus]}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : <p className="p-4 text-sm text-[#66727f]">{copy.detail.noEvents}</p>}
        </section>

        <div className="space-y-6">
          <section className="overflow-hidden rounded-md border border-[#e1e5e8] bg-white">
            <div className="flex items-center justify-between border-b border-[#e8ecef] px-4 py-3">
              <div><p className="text-[10px] font-bold uppercase text-[#2b9188]">{copy.holds.eyebrow}</p><h2 className="mt-0.5 text-base font-bold text-[#243444]">{copy.holds.title}</h2></div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setHoldOpen(true)}
                disabled={!hydrated}
              ><Plus className="size-4" />{copy.common.create}</Button>
            </div>
            {holds.length ? (
              <div className="divide-y divide-[#edf0f2]">
                {holds.map((hold) => (
                  <div key={hold.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div><p className="font-mono text-xs font-semibold text-[#344454]">{hold.reference}</p><p className="mt-1 text-xs text-[#687582]">{copy.scopes[hold.scope as keyof typeof copy.scopes] ?? copy.scopes.all} / {copy.holds.since(formatDate(hold.startsAt, undefined, locale))}</p></div>
                      <Badge tone={hold.releasedAt ? "neutral" : "amber"}>{hold.releasedAt ? copy.common.released : copy.common.active}</Badge>
                    </div>
                    <p className="mt-3 text-sm text-[#52606d]">{hold.reason}</p>
                    <p className="mt-2 text-xs text-[#66727f]">{copy.holds.legalBasisValue(hold.legalBasis)}</p>
                    {!hold.releasedAt ? <Button size="sm" variant="ghost" className="mt-3" onClick={() => setReleaseHold(hold)} disabled={!hydrated}><RotateCcw className="size-4" />{copy.holds.release}</Button> : null}
                  </div>
                ))}
              </div>
            ) : <p className="p-4 text-sm text-[#66727f]">{copy.holds.empty}</p>}
          </section>

          <section className="overflow-hidden rounded-md border border-[#e1e5e8] bg-white">
            <div className="border-b border-[#e8ecef] px-4 py-3"><p className="text-[10px] font-bold uppercase text-[#2b9188]">{copy.detail.artifacts}</p><h2 className="mt-0.5 text-base font-bold text-[#243444]">{copy.detail.exports}</h2></div>
            {artifacts.length ? (
              <div className="divide-y divide-[#edf0f2]">
                {artifacts.map((artifact) => {
                  const downloadable = artifact.status === "ready" && !artifact.deletedAt && new Date(artifact.expiresAt).getTime() > now;
                  const ArtifactIcon = artifact.format === "zip" ? FileArchive : FileJson2;
                  return (
                    <div key={artifact.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]"><ArtifactIcon className="size-4" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-[#344454]">{artifact.safeFileName}</p>
                          <p className="mt-1 text-xs text-[#66727f]">{bytes(artifact.sizeBytes, locale)} / {copy.common.files(numberFormatter.format(artifact.fileCount ?? 0))} / {copy.detail.expires(formatDateTime(artifact.expiresAt, locale))}</p>
                        </div>
                        <Badge tone={artifact.status === "ready" ? "teal" : artifact.status === "failed" ? "coral" : "neutral"}>{copy.artifactStatuses[artifact.status]}</Badge>
                      </div>
                      {downloadable ? <Button size="sm" variant="secondary" className="mt-3" onClick={() => setDownloadArtifact(artifact)} disabled={!hydrated}><Download className="size-4" />{copy.common.download}</Button> : null}
                    </div>
                  );
                })}
              </div>
            ) : <p className="p-4 text-sm text-[#66727f]">{copy.detail.noArtifacts}</p>}
          </section>
        </div>
      </div>
      {workflowAction ? <WorkflowDialog kind={workflowAction} requestId={request.id} ownerStepUpMode={ownerStepUpMode} onClose={() => setWorkflowAction(null)} copy={copy} locale={locale} /> : null}
      {holdOpen ? <LegalHoldDialog requestId={request.id} ownerStepUpMode={ownerStepUpMode} onClose={() => setHoldOpen(false)} copy={copy} locale={locale} /> : null}
      {releaseHold ? <ReleaseHoldDialog requestId={request.id} hold={releaseHold} ownerStepUpMode={ownerStepUpMode} onClose={() => setReleaseHold(null)} copy={copy} locale={locale} /> : null}
      {downloadArtifact ? <DownloadDialog requestId={request.id} artifact={downloadArtifact} ownerStepUpMode={ownerStepUpMode} onClose={() => setDownloadArtifact(null)} copy={copy} locale={locale} /> : null}
    </div>
  );
}

"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  Ban,
  BookOpen,
  Braces,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  Copy,
  ExternalLink,
  Eye,
  Globe2,
  Inbox,
  KeyRound,
  ListFilter,
  LoaderCircle,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  Webhook,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import {
  OwnerStepUpControl,
  type OwnerStepUpMode,
} from "@/components/admin/owner-step-up-control";
import {
  createApiKeyAdminAction,
  createWebhookAdminAction,
  deleteWebhookAdminAction,
  revokeApiKeyAdminAction,
  rotateWebhookSecretAdminAction,
  toggleWebhookAdminAction,
  getWebhookDeliveryAdminAction,
  listFailedWebhookDeliveriesAdminAction,
  replayWebhookDeliveryAdminAction,
  type ApiAdminActionState,
} from "@/lib/api/admin-actions";
import { isOwnerBoundApiScope } from "@/lib/api/scopes";
import type {
  WebhookDeliveryDetail,
  WebhookDeliverySummary,
} from "@/lib/api/webhook-delivery-model";
import {
  formatApiConsoleBytes,
  formatApiConsoleDateTime,
  formatApiConsoleNumber,
  formatApiConsolePercent,
  getApiConsoleCopy,
  resolveApiAdminActionMessage,
  type ApiConsoleCopy,
} from "@/lib/i18n/api-console";
import type { AppLocale } from "@/lib/i18n/model";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

export type ApiConsoleTab = "access" | "endpoints" | "webhooks" | "requests";
export type ApiEnvironment = "production" | "sandbox" | "development";
export type ApiHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
export type ApiKeyStatus = "active" | "expired" | "revoked";
export type ApiWebhookStatus = "active" | "paused" | "failing";
export type ApiEndpointStability = "stable" | "beta" | "deprecated";
export type ApiCodeLanguage = "curl" | "javascript";

export interface ApiScopeDefinition {
  id: string;
  label: string;
  description: string;
  category?: string;
  access?: "read" | "write" | "admin";
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  maskedValue: string;
  status: ApiKeyStatus;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  ownerName?: string;
  environment?: ApiEnvironment;
  requestCount?: number;
  manageHref?: string;
}

export interface ApiEndpointParameter {
  name: string;
  location: "path" | "query" | "header" | "body";
  type: string;
  required?: boolean;
  description: string;
  example?: string;
}

export interface ApiEndpointResponse {
  status: number;
  description: string;
}

export interface ApiEndpointRecord {
  id: string;
  method: ApiHttpMethod;
  path: string;
  title: string;
  description: string;
  group: string;
  scopes: string[];
  stability?: ApiEndpointStability;
  version?: string;
  requiresAuthentication?: boolean;
  parameters?: ApiEndpointParameter[];
  responses?: ApiEndpointResponse[];
  requestBodyExample?: string;
  responseExample?: string;
  codeExamples?: Partial<Record<ApiCodeLanguage, string>>;
}

export interface ApiWebhookRecord {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: ApiWebhookStatus;
  createdAt?: string;
  lastDeliveryAt?: string | null;
  lastDeliveryStatus?: number | null;
  successRate?: number | null;
  signingSecretHint?: string;
  manageHref?: string;
}

export interface ApiRequestLogRecord {
  id: string;
  timestamp: string;
  method: ApiHttpMethod;
  path: string;
  status: number;
  durationMs: number;
  requestId: string;
  apiKeyName?: string;
  ipAddress?: string;
  responseSizeBytes?: number;
}

export interface ApiConsoleLinks {
  createKey?: string;
  createWebhook?: string;
  documentation?: string;
}

export interface ApiConsoleProps<
  TKey extends ApiKeyRecord = ApiKeyRecord,
  TEndpoint extends ApiEndpointRecord = ApiEndpointRecord,
  TWebhook extends ApiWebhookRecord = ApiWebhookRecord,
  TRequest extends ApiRequestLogRecord = ApiRequestLogRecord,
> {
  locale: AppLocale;
  workspaceName: string;
  baseUrl: string;
  environment: ApiEnvironment;
  apiVersion?: string;
  apiKeys: readonly TKey[];
  scopes: readonly ApiScopeDefinition[];
  endpoints: readonly TEndpoint[];
  webhooks: readonly TWebhook[];
  failedWebhookDeliveries?: readonly WebhookDeliverySummary[];
  requestLogs: readonly TRequest[];
  webhookEvents?: readonly string[];
  canManage?: boolean;
  canManagePrivacyScopes?: boolean;
  ownerStepUpMode?: OwnerStepUpMode;
  links?: ApiConsoleLinks;
  defaultTab?: ApiConsoleTab;
  defaultEndpointId?: string;
  className?: string;
}

const tabDefinitions: Array<{
  id: ApiConsoleTab;
  icon: typeof KeyRound;
}> = [
  { id: "access", icon: KeyRound },
  { id: "endpoints", icon: Code2 },
  { id: "webhooks", icon: Webhook },
  { id: "requests", icon: Activity },
];

const methodStyles: Record<ApiHttpMethod, string> = {
  GET: "border-[#b9e8e3] bg-[#e9f8f6] text-[#167e74]",
  POST: "border-[#cedbed] bg-[#eef3f9] text-[#365f8d]",
  PUT: "border-[#ead9a8] bg-[#fbf6e7] text-[#8d6a12]",
  PATCH: "border-[#d8d1ec] bg-[#f3f0fa] text-[#65518f]",
  DELETE: "border-[#f4c8c2] bg-[#fdf0ee] text-[#b84e42]",
  HEAD: "border-[#dfe4e8] bg-[#f4f6f7] text-[#5a6875]",
  OPTIONS: "border-[#dfe4e8] bg-[#f4f6f7] text-[#5a6875]",
};

const accessStyles: Record<NonNullable<ApiScopeDefinition["access"]>, string> = {
  read: "border-[#cedbed] bg-[#eef3f9] text-[#365f8d]",
  write: "border-[#ead9a8] bg-[#fbf6e7] text-[#8d6a12]",
  admin: "border-[#f4c8c2] bg-[#fdf0ee] text-[#b84e42]",
};

function endpointUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function statusTone(status: number) {
  if (status >= 500) return "text-[#b84e42] bg-[#fdf0ee]";
  if (status >= 400) return "text-[#8d6a12] bg-[#fbf6e7]";
  if (status >= 300) return "text-[#365f8d] bg-[#eef3f9]";
  return "text-[#167e74] bg-[#e9f8f6]";
}

function MethodBadge({ method }: { method: ApiHttpMethod }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-14 shrink-0 items-center justify-center rounded border px-1.5 font-mono text-[10px] font-bold",
        methodStyles[method],
      )}
    >
      {method}
    </span>
  );
}

function CopyButton({
  locale,
  value,
  label,
  className,
}: {
  locale: AppLocale;
  value: string;
  label?: string;
  className?: string;
}) {
  const copy = getApiConsoleCopy(locale);
  const resolvedLabel = label ?? copy.common.copy;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  async function copyValue() {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    resetTimer.current = setTimeout(() => setCopyState("idle"), 1800);
  }

  const feedback =
    copyState === "copied"
      ? copy.common.copied
      : copyState === "error"
        ? copy.common.copyFailed
        : resolvedLabel;

  return (
    <span className="group relative inline-flex shrink-0">
      <button
        type="button"
        onClick={copyValue}
        className={cn(
          "focus-ring grid size-8 place-items-center rounded-md text-[#71808b] transition-colors hover:bg-[#edf1f3] hover:text-[#17324d]",
          copyState === "copied" && "bg-[#e9f8f6] text-[#167e74]",
          copyState === "error" && "bg-[#fdf0ee] text-[#b84e42]",
          className,
        )}
        aria-label={resolvedLabel}
      >
        {copyState === "copied" ? <Check className="size-4" /> : copyState === "error" ? <XCircle className="size-4" /> : <Copy className="size-4" />}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 whitespace-nowrap rounded bg-[#0f263c] px-2 py-1 text-[10px] font-semibold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {feedback}
      </span>
    </span>
  );
}

const initialAdminActionState: ApiAdminActionState = {
  ok: null,
  message: null,
};

function ModalShell({
  locale,
  title,
  eyebrow,
  icon: Icon,
  onClose,
  children,
  width = "max-w-2xl",
  closeDisabled = false,
}: {
  locale: AppLocale;
  title: string;
  eyebrow: string;
  icon: typeof KeyRound;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
  closeDisabled?: boolean;
}) {
  const copy = getApiConsoleCopy(locale);
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !closeDisabled) onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [closeDisabled, onClose]);

  return (
    <div className="fixed inset-0 z-[80] grid grid-cols-[minmax(0,1fr)] place-items-center p-3 sm:p-5">
      <button type="button" className="absolute inset-0 bg-[#0f263c]/50 backdrop-blur-[1px] disabled:cursor-wait" onClick={onClose} disabled={closeDisabled} aria-label={copy.common.closeDialog} />
      <section role="dialog" aria-modal="true" aria-label={title} className={cn("relative z-[1] flex max-h-[92dvh] min-w-0 w-full max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg bg-white shadow-2xl sm:max-w-[calc(100vw-2.5rem)]", width)}>
        <header className="z-10 flex shrink-0 items-center justify-between gap-4 border-b border-[#e8ebee] bg-white px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#e9f8f6] text-[#167e74]"><Icon className="size-4.5" /></span>
            <div className="min-w-0"><p className="text-[9px] font-bold uppercase text-[#2b9188]">{eyebrow}</p><h3 className="truncate text-base font-bold text-[#243444]">{title}</h3></div>
          </div>
          <button type="button" onClick={onClose} disabled={closeDisabled} className="focus-ring grid size-9 shrink-0 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3] disabled:cursor-wait disabled:opacity-45" aria-label={copy.common.closeDialog}><X className="size-4.5" /></button>
        </header>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </section>
    </div>
  );
}

function SecretReveal({
  locale,
  secret,
  kind,
  onClose,
}: {
  locale: AppLocale;
  secret: string;
  kind: string;
  onClose: () => void;
}) {
  const copy = getApiConsoleCopy(locale);
  return (
    <div className="p-4 sm:p-5">
      <div className="flex gap-3 rounded-md border border-[#ead9a8] bg-[#fbf6e7] p-3.5">
        <ShieldAlert className="mt-0.5 size-4.5 shrink-0 text-[#8d6a12]" />
        <div><p className="text-xs font-bold text-[#6f5410]">{copy.secret.once}</p><p className="mt-1 text-[11px] leading-5 text-[#786a44]">{copy.secret.description}</p></div>
      </div>
      <div className="mt-4 rounded-md border border-[#dfe4e8] bg-[#10283e] p-3">
        <div className="flex items-start gap-2"><code className="min-w-0 flex-1 break-all font-mono text-xs leading-6 text-[#e4edf4]">{secret}</code><CopyButton locale={locale} value={secret} label={copy.secret.copy(kind)} className="text-[#c5d2dc] hover:bg-white/10 hover:text-white" /></div>
      </div>
      <div className="mt-5 flex justify-end"><Button type="button" onClick={onClose}>{copy.common.done}</Button></div>
    </div>
  );
}

function CreateApiKeyDialog({
  locale,
  scopes,
  canManagePrivacyScopes,
  ownerStepUpMode,
  onClose,
}: {
  locale: AppLocale;
  scopes: readonly ApiScopeDefinition[];
  canManagePrivacyScopes: boolean;
  ownerStepUpMode: OwnerStepUpMode;
  onClose: () => void;
}) {
  const copy = getApiConsoleCopy(locale);
  const [state, action, pending] = useActionState(createApiKeyAdminAction, initialAdminActionState);
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(
    () => new Set(),
  );
  const availableScopes = scopes.filter((scope) => scope.id !== "*");
  const ownerBoundSelected = [...selectedScopes].some(isOwnerBoundApiScope);
  const groupedScopes = availableScopes.reduce<Record<string, ApiScopeDefinition[]>>((groups, scope) => {
    const category = scope.category ?? copy.createKey.otherCategory;
    (groups[category] ??= []).push(scope);
    return groups;
  }, {});

  useEffect(() => {
    if (state.ok === true && state.message) {
      toast.success(resolveApiAdminActionMessage(locale, state.message));
    }
    if (state.ok === false && state.message) {
      toast.error(resolveApiAdminActionMessage(locale, state.message));
    }
  }, [locale, state]);

  return (
    <ModalShell locale={locale} title={copy.createKey.title} eyebrow={copy.createKey.eyebrow} icon={KeyRound} onClose={onClose} closeDisabled={pending}>
      {state.ok && state.secret ? <SecretReveal locale={locale} secret={state.secret} kind={copy.secret.apiKey} onClose={onClose} /> : (
        <form action={action} className="p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
            <label><span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.createKey.name}</span><input name="name" autoFocus required maxLength={160} className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm" placeholder={copy.createKey.namePlaceholder} /></label>
            <label><span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#52606d]"><CalendarClock className="size-3.5" />{copy.createKey.expiration}</span><input name="expiresAt" type="date" className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm" /></label>
          </div>
          <fieldset className="mt-5"><legend className="text-xs font-bold text-[#354555]">{copy.createKey.scopes}</legend><p className="mt-0.5 text-[10px] text-[#7a8690]">{copy.createKey.scopesHint}</p>
            <div className="mt-3 grid gap-x-5 gap-y-4 md:grid-cols-2">
              {Object.entries(groupedScopes).map(([category, categoryScopes]) => <div key={category}><p className="mb-1.5 text-[9px] font-bold uppercase text-[#8a949d]">{category}</p><div className="space-y-1">{categoryScopes.map((scope) => <label key={scope.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-[#f4f7f8]"><input type="checkbox" name="scopes" value={scope.id} checked={selectedScopes.has(scope.id)} onChange={(event) => setSelectedScopes((current) => { const next = new Set(current); if (event.target.checked) next.add(scope.id); else next.delete(scope.id); return next; })} className="mt-0.5 size-3.5 accent-[#2b9188]" /><span className="min-w-0"><span className="block text-[11px] font-semibold text-[#354555]">{scope.label}</span><code className="block truncate text-[9px] text-[#8a949d]">{scope.id}</code></span></label>)}</div></div>)}
            </div>
          </fieldset>
          {canManagePrivacyScopes && ownerBoundSelected ? (
            <OwnerStepUpControl
              mode={ownerStepUpMode}
              returnTo="/admin/api"
              locale={locale}
              passwordName="currentPassword"
              passwordLabel={copy.createKey.passwordLabel}
              oidcDescription={copy.createKey.oidcDescription}
              oidcButtonLabel={copy.createKey.oidcButton}
              oidcErrorMessage={copy.createKey.oidcError}
              className="mt-5"
            />
          ) : null}
          {state.ok === false && state.message ? <p className="mt-4 rounded-md bg-[#fdf0ee] p-3 text-xs text-[#a94339]" role="alert">{resolveApiAdminActionMessage(locale, state.message)}</p> : null}
          <div className="relative z-[1] mt-5 flex justify-end gap-2 border-t border-[#edf0f2] bg-white pt-4"><Button type="button" variant="secondary" onClick={onClose} disabled={pending}>{copy.common.cancel}</Button><Button type="submit" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}{pending ? copy.createKey.submitting : copy.createKey.submit}</Button></div>
        </form>
      )}
    </ModalShell>
  );
}

function CreateWebhookDialog({ locale, events, onClose }: { locale: AppLocale; events: readonly string[]; onClose: () => void }) {
  const copy = getApiConsoleCopy(locale);
  const [state, action, pending] = useActionState(createWebhookAdminAction, initialAdminActionState);

  useEffect(() => {
    if (state.ok === true && state.message) toast.success(resolveApiAdminActionMessage(locale, state.message));
    if (state.ok === false && state.message) toast.error(resolveApiAdminActionMessage(locale, state.message));
  }, [locale, state]);

  return (
    <ModalShell locale={locale} title={copy.createWebhook.title} eyebrow={copy.createWebhook.eyebrow} icon={Webhook} onClose={onClose} closeDisabled={pending}>
      {state.ok && state.secret ? <SecretReveal locale={locale} secret={state.secret} kind={copy.secret.webhook} onClose={onClose} /> : (
        <form action={action} className="p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label><span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.createWebhook.name}</span><input name="name" autoFocus required maxLength={160} className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm" placeholder={copy.createWebhook.namePlaceholder} /></label>
            <label><span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.createWebhook.target}</span><input name="url" type="url" inputMode="url" required maxLength={2000} pattern="https://.*" className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm" placeholder={copy.createWebhook.targetPlaceholder} /></label>
          </div>
          <fieldset className="mt-5"><legend className="text-xs font-bold text-[#354555]">{copy.createWebhook.events}</legend><p className="mt-0.5 text-[10px] text-[#7a8690]">{copy.createWebhook.eventsHint}</p><div className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{events.map((event) => <label key={event} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-[#f4f7f8]"><input type="checkbox" name="events" value={event} className="size-3.5 accent-[#2b9188]" /><code className="min-w-0 truncate text-[10px] text-[#455463]">{event}</code></label>)}</div></fieldset>
          {state.ok === false && state.message ? <p className="mt-4 rounded-md bg-[#fdf0ee] p-3 text-xs text-[#a94339]" role="alert">{resolveApiAdminActionMessage(locale, state.message)}</p> : null}
          <div className="mt-5 flex justify-end gap-2 border-t border-[#edf0f2] pt-4"><Button type="button" variant="secondary" onClick={onClose} disabled={pending}>{copy.common.cancel}</Button><Button type="submit" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Webhook className="size-4" />}{pending ? copy.createWebhook.submitting : copy.createWebhook.submit}</Button></div>
        </form>
      )}
    </ModalShell>
  );
}

function ConfirmDialog({
  locale,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
  onClose,
}: {
  locale: AppLocale;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const copy = getApiConsoleCopy(locale);
  return (
    <ModalShell locale={locale} title={title} eyebrow={copy.confirm.eyebrow} icon={ShieldAlert} onClose={onClose} width="max-w-md" closeDisabled={pending}>
      <div className="p-4 sm:p-5"><p className="text-sm leading-6 text-[#52606d]">{description}</p><div className="mt-5 flex justify-end gap-2 border-t border-[#edf0f2] pt-4"><Button type="button" variant="secondary" onClick={onClose} disabled={pending}>{copy.common.cancel}</Button><Button type="button" variant="danger" onClick={onConfirm} disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}{pending ? copy.common.working : confirmLabel}</Button></div></div>
    </ModalShell>
  );
}

function ActionIconButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  danger = false,
}: {
  label: string;
  icon: typeof KeyRound;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <span className="group relative inline-flex">
      <button type="button" onClick={onClick} disabled={disabled} className={cn("focus-ring grid size-8 place-items-center rounded-md text-[#71808b] transition-colors hover:bg-[#edf1f3] hover:text-[#17324d] disabled:cursor-not-allowed disabled:opacity-45", danger && "hover:bg-[#fdf0ee] hover:text-[#b84e42]")} aria-label={label}><Icon className={cn("size-3.5", Icon === LoaderCircle && "animate-spin")} /></button>
      <span role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-30 mb-1.5 whitespace-nowrap rounded bg-[#0f263c] px-2 py-1 text-[9px] font-semibold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{label}</span>
    </span>
  );
}

function ApiKeyRowActions({ locale, item }: { locale: AppLocale; item: ApiKeyRecord }) {
  const copy = getApiConsoleCopy(locale);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function revoke() {
    startTransition(async () => {
      const result = await revokeApiKeyAdminAction(item.id);
      if (result.ok && result.message) {
        toast.success(resolveApiAdminActionMessage(locale, result.message));
        setConfirmOpen(false);
      } else if (result.message) {
        toast.error(resolveApiAdminActionMessage(locale, result.message));
      }
    });
  }

  if (item.status === "revoked") return null;
  return <><ActionIconButton label={copy.keyActions.revoke} icon={Ban} onClick={() => setConfirmOpen(true)} disabled={pending} danger />{confirmOpen ? <ConfirmDialog locale={locale} title={copy.keyActions.revoke} description={copy.keyActions.revokeDescription(item.name)} confirmLabel={copy.keyActions.confirmRevoke} pending={pending} onConfirm={revoke} onClose={() => setConfirmOpen(false)} /> : null}</>;
}

function WebhookRowActions({ locale, item }: { locale: AppLocale; item: ApiWebhookRecord }) {
  const copy = getApiConsoleCopy(locale);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<"toggle" | "rotate" | "delete" | null>(null);
  const [pending, startTransition] = useTransition();

  function run(
    kind: "toggle" | "rotate" | "delete",
    action: () => Promise<ApiAdminActionState>,
  ) {
    setActiveAction(kind);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok && result.message) {
          toast.success(resolveApiAdminActionMessage(locale, result.message));
          if (result.secret) setSecret(result.secret);
          if (kind === "delete") setDeleteOpen(false);
        } else if (result.message) {
          toast.error(resolveApiAdminActionMessage(locale, result.message));
        }
      } catch {
        toast.error(copy.webhookActions.failed);
      } finally {
        setActiveAction(null);
      }
    });
  }

  return <><div className="flex justify-end gap-0.5"><ActionIconButton label={item.status === "paused" ? copy.webhookActions.activate : copy.webhookActions.deactivate} icon={activeAction === "toggle" ? LoaderCircle : item.status === "paused" ? PlayCircle : PauseCircle} onClick={() => run("toggle", () => toggleWebhookAdminAction(item.id))} disabled={pending} /><ActionIconButton label={copy.webhookActions.rotate} icon={activeAction === "rotate" ? LoaderCircle : RefreshCw} onClick={() => run("rotate", () => rotateWebhookSecretAdminAction(item.id))} disabled={pending} /><ActionIconButton label={copy.webhookActions.delete} icon={Trash2} onClick={() => setDeleteOpen(true)} disabled={pending} danger /></div>{deleteOpen ? <ConfirmDialog locale={locale} title={copy.webhookActions.delete} description={copy.webhookActions.deleteDescription(item.name)} confirmLabel={copy.webhookActions.delete} pending={pending && activeAction === "delete"} onConfirm={() => run("delete", () => deleteWebhookAdminAction(item.id))} onClose={() => setDeleteOpen(false)} /> : null}{secret ? <ModalShell locale={locale} title={copy.webhookActions.rotatedTitle} eyebrow={copy.webhookActions.rotatedEyebrow} icon={RefreshCw} onClose={() => setSecret(null)} width="max-w-lg"><SecretReveal locale={locale} secret={secret} kind={copy.secret.webhook} onClose={() => setSecret(null)} /></ModalShell> : null}</>;
}

function SearchField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <label className={cn("relative block", className)}>
      <span className="sr-only">{placeholder}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#84909a]" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="focus-ring h-9 w-full rounded-md border border-[#dfe4e8] bg-[#f8f9fa] pl-9 pr-3 text-xs text-[#2b3a48] placeholder:text-[var(--theme-muted-text)]"
        placeholder={placeholder}
      />
    </label>
  );
}

function EmptyState({ icon: Icon, title, description }: { icon: typeof KeyRound; title: string; description: string }) {
  return (
    <div className="grid min-h-52 place-items-center px-5 py-10 text-center">
      <div>
        <span className="mx-auto grid size-10 place-items-center rounded-md bg-[#edf6f5] text-[#258d84]">
          <Icon className="size-5" />
        </span>
        <p className="mt-3 text-sm font-semibold text-[#2b3a48]">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[#7a8690]">{description}</p>
      </div>
    </div>
  );
}

function DeliveryAttempt({ delivery }: { delivery: WebhookDeliverySummary }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#52606d]">
      <RotateCcw className="size-3 text-[#8a949d]" />
      {delivery.attempt} / {delivery.maxAttempts}
    </span>
  );
}

function getLocalizedDeliveryResponseSummary(
  delivery: WebhookDeliveryDetail,
  copy: ApiConsoleCopy,
) {
  if (!delivery.responseSummary) return null;
  if (delivery.responseStatus !== null) {
    return copy.deadLetters.responseSummaries.http(delivery.responseStatus);
  }

  switch (delivery.failureKind) {
    case "timeout":
      return copy.deadLetters.responseSummaries.timeout;
    case "dns":
      return copy.deadLetters.responseSummaries.dns;
    case "tls":
      return copy.deadLetters.responseSummaries.tls;
    case "configuration":
      return copy.deadLetters.responseSummaries.configuration;
    case "connection":
      return copy.deadLetters.responseSummaries.connection;
    case "http":
    case "unknown":
    case null:
      return copy.deadLetters.responseSummaries.unknown;
  }
}

function WebhookDeadLetterSection({
  locale,
  initialDeliveries,
  canReplay,
}: {
  locale: AppLocale;
  initialDeliveries: readonly WebhookDeliverySummary[];
  canReplay: boolean;
}) {
  const copy = getApiConsoleCopy(locale);
  const [deliveries, setDeliveries] = useState<WebhookDeliverySummary[]>(() => [
    ...initialDeliveries,
  ]);
  const [query, setQuery] = useState("");
  const [refreshState, setRefreshState] = useState<"idle" | "loading" | "error">("idle");
  const [refreshError, setRefreshError] = useState("");
  const [detailTarget, setDetailTarget] = useState<WebhookDeliverySummary | null>(null);
  const [detail, setDetail] = useState<WebhookDeliveryDetail | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "error">("idle");
  const [detailError, setDetailError] = useState("");
  const [replayPending, startReplayTransition] = useTransition();
  const detailRequest = useRef(0);
  const localizedResponseSummary = detail
    ? getLocalizedDeliveryResponseSummary(detail, copy)
    : null;

  const normalizedQuery = query.trim().toLowerCase();
  const filteredDeliveries = useMemo(
    () =>
      deliveries.filter((delivery) =>
        `${delivery.webhookName} ${delivery.event} ${delivery.responseStatus ?? ""} ${delivery.failureKind ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    [deliveries, normalizedQuery],
  );

  async function refreshDeliveries() {
    setRefreshState("loading");
    setRefreshError("");
    try {
      const result = await listFailedWebhookDeliveriesAdminAction();
      if (!result.ok) {
        setRefreshState("error");
        setRefreshError(resolveApiAdminActionMessage(locale, result.message));
        return;
      }
      setDeliveries(result.data);
      setRefreshState("idle");
      if (detailTarget && !result.data.some((item) => item.id === detailTarget.id)) {
        setDetailTarget(null);
        setDetail(null);
      }
    } catch {
      setRefreshState("error");
      setRefreshError(copy.deadLetters.loadFailed);
    }
  }

  async function openDetail(delivery: WebhookDeliverySummary) {
    const requestId = detailRequest.current + 1;
    detailRequest.current = requestId;
    setDetailTarget(delivery);
    setDetail(null);
    setDetailError("");
    setDetailState("loading");
    try {
      const result = await getWebhookDeliveryAdminAction(
        delivery.webhookId,
        delivery.id,
      );
      if (detailRequest.current !== requestId) return;
      if (!result.ok) {
        setDetailState("error");
        setDetailError(resolveApiAdminActionMessage(locale, result.message));
        return;
      }
      setDetail(result.data);
      setDetailState("idle");
    } catch {
      if (detailRequest.current !== requestId) return;
      setDetailState("error");
      setDetailError(copy.deadLetters.detailLoadFailed);
    }
  }

  function closeDetail() {
    if (replayPending) return;
    detailRequest.current += 1;
    setDetailTarget(null);
    setDetail(null);
    setDetailError("");
    setDetailState("idle");
  }

  function replayDelivery() {
    if (!detail || !canReplay || !detail.replayable) return;
    setDetailError("");
    startReplayTransition(async () => {
      try {
        const result = await replayWebhookDeliveryAdminAction(detail.id);
        if (!result.ok) {
          setDetailError(resolveApiAdminActionMessage(locale, result.message));
          return;
        }
        setDeliveries((current) => current.filter((item) => item.id !== detail.id));
        toast.success(resolveApiAdminActionMessage(locale, result.message));
        closeDetail();
      } catch {
        setDetailError(copy.deadLetters.requeueFailed);
      }
    });
  }

  return (
    <div className="border-t-8 border-[#f3f5f6]" data-testid="webhook-dead-letter-section">
      <div className="flex flex-col gap-3 border-b border-[#e8ebee] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-[#243444]">{copy.deadLetters.title}</h3>
            <Badge tone={deliveries.length ? "coral" : "neutral"}>{deliveries.length}</Badge>
            {!canReplay ? <Badge tone="neutral">{copy.common.readOnly}</Badge> : null}
          </div>
          <p className="mt-0.5 text-[11px] text-[#7a8690]">{copy.deadLetters.description}</p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <SearchField value={query} onChange={setQuery} placeholder={copy.deadLetters.search} className="min-w-0 flex-1 sm:w-64" />
          <ActionIconButton
            label={copy.deadLetters.refresh}
            icon={refreshState === "loading" ? LoaderCircle : RefreshCw}
            onClick={refreshDeliveries}
            disabled={refreshState === "loading"}
          />
        </div>
      </div>

      {refreshState === "loading" ? (
        <div className="flex items-center gap-2 border-b border-[#e8ebee] bg-[#f7f9fa] px-4 py-2 text-[10px] font-semibold text-[#52606d]" role="status">
          <LoaderCircle className="size-3.5 animate-spin text-[#2b9188]" />
          {copy.deadLetters.refreshing}
        </div>
      ) : null}
      {refreshState === "error" ? (
        <div className="flex flex-col gap-3 border-b border-[#f4c8c2] bg-[#fdf0ee] px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <p className="text-xs text-[#a94339]">{refreshError}</p>
          <Button size="sm" variant="secondary" onClick={refreshDeliveries}>
            <RefreshCw className="size-3.5" />
            {copy.common.retry}
          </Button>
        </div>
      ) : null}

      {filteredDeliveries.length ? (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead>
                <tr className="bg-[#f7f8f9] text-[9px] font-bold uppercase text-[#7c8790]">
                  <th className="px-4 py-2.5">{copy.deadLetters.columns.targetEvent}</th>
                  <th className="px-4 py-2.5">{copy.deadLetters.columns.error}</th>
                  <th className="px-4 py-2.5">{copy.deadLetters.columns.attempt}</th>
                  <th className="px-4 py-2.5">{copy.deadLetters.columns.time}</th>
                  <th className="w-14 px-3 py-2.5"><span className="sr-only">{copy.deadLetters.columns.details}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf0f2]">
                {filteredDeliveries.map((delivery) => (
                  <tr key={delivery.id} className="hover:bg-[#fafbfb]" data-testid={`dead-letter-${delivery.id}`}>
                    <td className="px-4 py-3">
                      <p className="text-xs font-semibold text-[#2b3a48]">{delivery.webhookName}</p>
                      <code className="mt-0.5 block max-w-xs truncate text-[9px] text-[#71808b]">{delivery.event}</code>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex min-w-10 justify-center rounded bg-[#fdf0ee] px-1.5 py-1 font-mono text-[10px] font-bold text-[#b84e42]">{delivery.responseStatus ?? "NET"}</span>
                        <span className="text-[10px] font-semibold text-[#52606d]">{delivery.failureKind ? copy.deadLetters.failureKinds[delivery.failureKind] : copy.common.error}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><DeliveryAttempt delivery={delivery} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-[10px] text-[#66727f]">{formatApiConsoleDateTime(delivery.updatedAt, locale)}</td>
                    <td className="px-3 py-3"><ActionIconButton label={copy.deadLetters.showDetails} icon={Eye} onClick={() => openDetail(delivery)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-[#edf0f2] md:hidden">
            {filteredDeliveries.map((delivery) => (
              <button
                key={delivery.id}
                type="button"
                onClick={() => openDetail(delivery)}
                className="focus-ring block w-full scroll-mt-20 p-4 text-left transition-colors hover:bg-[#fafbfb]"
                aria-label={copy.deadLetters.showDetails}
                data-testid={`dead-letter-mobile-${delivery.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-[#2b3a48]">{delivery.webhookName}</p>
                    <code className="mt-1 block break-all text-[9px] leading-4 text-[#71808b]">{delivery.event}</code>
                  </div>
                  <Eye className="mt-1 size-4 shrink-0 text-[#71808b]" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="inline-flex rounded bg-[#fdf0ee] px-1.5 py-1 font-mono text-[10px] font-bold text-[#b84e42]">{delivery.responseStatus ?? "NET"}</span>
                  <DeliveryAttempt delivery={delivery} />
                  <span className="text-[10px] text-[#71808b]">{formatApiConsoleDateTime(delivery.updatedAt, locale)}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          icon={Inbox}
          title={deliveries.length ? copy.deadLetters.noMatchesTitle : copy.deadLetters.emptyTitle}
          description={deliveries.length ? copy.deadLetters.noMatchesDescription : copy.deadLetters.emptyDescription}
        />
      )}

      {detailTarget ? (
        <ModalShell
          locale={locale}
          title={detailTarget.webhookName}
          eyebrow={copy.deadLetters.detailEyebrow}
          icon={AlertTriangle}
          onClose={closeDetail}
          width="max-w-xl"
          closeDisabled={replayPending}
        >
          {detailState === "loading" ? (
            <div className="grid min-h-64 place-items-center p-6" role="status">
              <div className="text-center"><LoaderCircle className="mx-auto size-6 animate-spin text-[#2b9188]" /><p className="mt-3 text-xs font-semibold text-[#52606d]">{copy.deadLetters.loadingDetails}</p></div>
            </div>
          ) : detailState === "error" && !detail ? (
            <div className="p-5">
              <div className="rounded-md border border-[#f4c8c2] bg-[#fdf0ee] p-4" role="alert"><p className="text-xs text-[#a94339]">{detailError}</p></div>
              <div className="mt-4 flex justify-end"><Button size="sm" variant="secondary" onClick={() => openDetail(detailTarget)}><RefreshCw className="size-3.5" />{copy.common.retry}</Button></div>
            </div>
          ) : detail ? (
            <div className="p-4 sm:p-5">
              <dl className="grid gap-4 sm:grid-cols-2">
                <div><dt className="text-[9px] font-bold uppercase text-[#8a949d]">{copy.deadLetters.event}</dt><dd className="mt-1 break-all font-mono text-[11px] font-semibold text-[#354555]">{detail.event}</dd></div>
                <div><dt className="text-[9px] font-bold uppercase text-[#8a949d]">{copy.access.columns.status}</dt><dd className="mt-1"><Badge tone="coral">{copy.deadLetters.failed}</Badge></dd></div>
                <div><dt className="text-[9px] font-bold uppercase text-[#8a949d]">{copy.deadLetters.attempts}</dt><dd className="mt-1 text-xs font-semibold text-[#354555]">{copy.deadLetters.attemptOf(detail.attempt, detail.maxAttempts)}</dd></div>
                <div><dt className="text-[9px] font-bold uppercase text-[#8a949d]">{copy.deadLetters.runtime}</dt><dd className="mt-1 text-xs font-semibold text-[#354555]">{detail.durationMs === null ? "-" : `${formatApiConsoleNumber(detail.durationMs, locale)} ms`}</dd></div>
                <div><dt className="text-[9px] font-bold uppercase text-[#8a949d]">{copy.deadLetters.httpStatus}</dt><dd className="mt-1 font-mono text-xs font-bold text-[#b84e42]">{detail.responseStatus ?? copy.common.noHttpStatus}</dd></div>
                <div><dt className="text-[9px] font-bold uppercase text-[#8a949d]">{copy.deadLetters.lastAttempt}</dt><dd className="mt-1 text-xs font-semibold text-[#354555]">{formatApiConsoleDateTime(detail.updatedAt, locale)}</dd></div>
              </dl>

              {localizedResponseSummary ? (
                <div className="mt-5 rounded-md border border-[#f4c8c2] bg-[#fdf0ee] p-3.5">
                  <div className="flex gap-2.5"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#b84e42]" /><div><p className="text-[10px] font-bold text-[#923d34]">{detail.failureKind ? copy.deadLetters.failureKinds[detail.failureKind] : copy.deadLetters.deliveryError}</p><p className="mt-1 text-[11px] leading-5 text-[#7e514c]">{localizedResponseSummary}</p></div></div>
                </div>
              ) : null}

              <div
                className="mt-5 border-t border-[#edf0f2] pt-4"
                data-testid="webhook-attempt-history"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[9px] font-bold uppercase text-[#8a949d]">
                    {copy.deadLetters.history}
                  </p>
                  <span className="text-[9px] font-semibold text-[#71808b]">
                    {copy.deadLetters.entries(detail.attempts.length)}
                  </span>
                </div>
                {detail.attempts.length ? (
                  <ol className="mt-3 divide-y divide-[#edf0f2] border-y border-[#edf0f2]">
                    {detail.attempts.map((attempt) => (
                      <li
                        key={attempt.id}
                        className="flex gap-3 py-3"
                        data-testid={`webhook-attempt-${attempt.replayGeneration}-${attempt.attempt}`}
                      >
                        <span
                          className={cn(
                            "mt-0.5 grid size-7 shrink-0 place-items-center rounded-md",
                            attempt.outcome === "delivered"
                              ? "bg-[#e9f8f6] text-[#167e74]"
                              : attempt.outcome === "retrying"
                                ? "bg-[#fbf6e7] text-[#8d6a12]"
                                : "bg-[#fdf0ee] text-[#b84e42]",
                          )}
                        >
                          {attempt.outcome === "delivered" ? (
                            <Check className="size-3.5" />
                          ) : attempt.outcome === "retrying" ? (
                            <RotateCcw className="size-3.5" />
                          ) : (
                            <XCircle className="size-3.5" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                            <p className="text-[10px] font-bold text-[#354555]">
                              {copy.deadLetters.runAttempt(attempt.replayGeneration + 1, attempt.attempt)}
                            </p>
                            <span className="text-[9px] font-semibold text-[#66727f]">
                              {copy.deadLetters.outcomes[attempt.outcome]}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-[#71808b]">
                            <span>{formatApiConsoleDateTime(attempt.completedAt, locale)}</span>
                            <span>{formatApiConsoleNumber(attempt.durationMs, locale)} ms</span>
                            <span>HTTP {attempt.responseStatus ?? "-"}</span>
                            {attempt.failureKind ? (
                              <span>{copy.deadLetters.failureKinds[attempt.failureKind]}</span>
                            ) : null}
                          </div>
                          {attempt.responseBodyRedacted ? (
                            <p className="mt-1.5 text-[9px] text-[#8a949d]">
                              {copy.deadLetters.responseRedacted}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-2 text-[10px] text-[#71808b]">
                    {copy.deadLetters.noAttemptHistory}
                  </p>
                )}
              </div>

              <div className="mt-5 border-t border-[#edf0f2] pt-4">
                <p className="text-[9px] font-bold uppercase text-[#8a949d]">{copy.deadLetters.safePayload}</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div><p className="text-[9px] text-[#8a949d]">{copy.deadLetters.payloadId}</p><p className="mt-0.5 break-all font-mono text-[10px] text-[#455463]">{detail.payload.id ?? "-"}</p></div>
                  <div><p className="text-[9px] text-[#8a949d]">{copy.deadLetters.payloadType}</p><p className="mt-0.5 break-all font-mono text-[10px] text-[#455463]">{detail.payload.type ?? "-"}</p></div>
                </div>
                {detail.payload.dataKeys.length ? <div className="mt-3"><p className="text-[9px] text-[#8a949d]">{copy.deadLetters.dataFields}</p><div className="mt-1.5 flex flex-wrap gap-1">{detail.payload.dataKeys.map((key) => <code key={key} className="max-w-full break-all rounded border border-[#e1e5e8] bg-[#f5f7f8] px-1.5 py-0.5 text-[9px] text-[#52606d]">{key}</code>)}</div></div> : null}
              </div>

              {detailError ? <p className="mt-4 rounded-md bg-[#fdf0ee] p-3 text-xs text-[#a94339]" role="alert">{detailError}</p> : null}
              <div className="mt-5 flex flex-col-reverse gap-2 border-t border-[#edf0f2] pt-4 sm:flex-row sm:justify-end">
                <Button variant="secondary" onClick={closeDetail} disabled={replayPending}>{copy.deadLetters.close}</Button>
                {canReplay && detail.replayable ? <Button onClick={replayDelivery} disabled={replayPending}>{replayPending ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}{replayPending ? copy.deadLetters.queueing : copy.deadLetters.requeue}</Button> : null}
              </div>
            </div>
          ) : null}
        </ModalShell>
      ) : null}
    </div>
  );
}

function buildCodeExample(
  endpoint: ApiEndpointRecord,
  baseUrl: string,
  language: ApiCodeLanguage,
  copy: ApiConsoleCopy,
) {
  const supplied = endpoint.codeExamples?.[language];
  if (supplied) return supplied;

  const url = endpointUrl(baseUrl, endpoint.path);
  const hasBody = !["GET", "HEAD", "DELETE"].includes(endpoint.method);
  const requiresAuthentication = endpoint.requiresAuthentication !== false;
  const body =
    endpoint.requestBodyExample ??
    `{\n  "title": "${copy.endpoints.codeExampleTitle}"\n}`;

  if (language === "curl") {
    const parts = [
      `curl --request ${endpoint.method}`,
      `  --url '${url}'`,
      ...(requiresAuthentication ? ["  --header 'Authorization: Bearer $Q_ACADEMY_API_KEY'"] : []),
      ...(hasBody ? ["  --header 'Content-Type: application/json'", `  --data '${body.replace(/\n/g, "")}'`] : []),
    ];
    return parts.map((part, index) => `${part}${index < parts.length - 1 ? " \\" : ""}`).join("\n");
  }

  return [
    `const response = await fetch("${url}", {`,
    `  method: "${endpoint.method}",`,
    ...(requiresAuthentication || hasBody
      ? [
          "  headers: {",
          ...(requiresAuthentication ? ['    Authorization: `Bearer ${process.env.Q_ACADEMY_API_KEY}`,'] : []),
          ...(hasBody ? ['    "Content-Type": "application/json",'] : []),
          "  },",
        ]
      : []),
    ...(hasBody ? [`  body: JSON.stringify(${body}),`] : []),
    "});",
    "",
    "if (!response.ok) {",
    '  throw new Error(`API request failed: ${response.status}`);',
    "}",
    "",
    "const data = await response.json();",
  ].join("\n");
}

export function ApiConsole<
  TKey extends ApiKeyRecord = ApiKeyRecord,
  TEndpoint extends ApiEndpointRecord = ApiEndpointRecord,
  TWebhook extends ApiWebhookRecord = ApiWebhookRecord,
  TRequest extends ApiRequestLogRecord = ApiRequestLogRecord,
>({
  locale,
  workspaceName,
  baseUrl,
  environment,
  apiVersion = "v1",
  apiKeys,
  scopes,
  endpoints,
  webhooks,
  failedWebhookDeliveries = [],
  requestLogs,
  webhookEvents = [],
  canManage = false,
  canManagePrivacyScopes = false,
  ownerStepUpMode = "password",
  links,
  defaultTab = "access",
  defaultEndpointId,
  className,
}: ApiConsoleProps<TKey, TEndpoint, TWebhook, TRequest>) {
  const copy = getApiConsoleCopy(locale);
  const [activeTab, setActiveTab] = useState<ApiConsoleTab>(defaultTab);
  const [keyQuery, setKeyQuery] = useState("");
  const [endpointQuery, setEndpointQuery] = useState("");
  const [webhookQuery, setWebhookQuery] = useState("");
  const [requestQuery, setRequestQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [selectedEndpointId, setSelectedEndpointId] = useState(defaultEndpointId ?? endpoints[0]?.id ?? "");
  const [codeLanguage, setCodeLanguage] = useState<ApiCodeLanguage>("curl");
  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const [createWebhookOpen, setCreateWebhookOpen] = useState(false);
  const hydrated = useHydrated();

  const normalizedKeyQuery = keyQuery.trim().toLowerCase();
  const normalizedEndpointQuery = endpointQuery.trim().toLowerCase();
  const normalizedWebhookQuery = webhookQuery.trim().toLowerCase();
  const normalizedRequestQuery = requestQuery.trim().toLowerCase();

  const filteredKeys = useMemo(
    () =>
      apiKeys.filter(
        (key) =>
          (scopeFilter === "all" || key.scopes.includes(scopeFilter)) &&
          (!normalizedKeyQuery ||
            `${key.name} ${key.maskedValue} ${key.ownerName ?? ""} ${key.environment ?? ""}`
              .toLowerCase()
              .includes(normalizedKeyQuery)),
      ),
    [apiKeys, normalizedKeyQuery, scopeFilter],
  );

  const filteredEndpoints = useMemo(
    () =>
      endpoints.filter(
        (endpoint) =>
          (scopeFilter === "all" || endpoint.scopes.includes(scopeFilter)) &&
          (!normalizedEndpointQuery ||
            `${endpoint.title} ${endpoint.path} ${endpoint.method} ${endpoint.group} ${endpoint.description}`
              .toLowerCase()
              .includes(normalizedEndpointQuery)),
      ),
    [endpoints, normalizedEndpointQuery, scopeFilter],
  );

  const filteredWebhooks = useMemo(
    () =>
      webhooks.filter((item) =>
        `${item.name} ${item.url} ${item.events.join(" ")}`.toLowerCase().includes(normalizedWebhookQuery),
      ),
    [normalizedWebhookQuery, webhooks],
  );

  const filteredRequests = useMemo(
    () =>
      requestLogs.filter((item) =>
        `${item.method} ${item.path} ${item.status} ${item.requestId} ${item.apiKeyName ?? ""} ${item.ipAddress ?? ""}`
          .toLowerCase()
          .includes(normalizedRequestQuery),
      ),
    [normalizedRequestQuery, requestLogs],
  );

  const selectedEndpoint =
    filteredEndpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? filteredEndpoints[0];
  const activeKeyCount = apiKeys.filter((key) => key.status === "active").length;
  const healthyWebhookCount = webhooks.filter((item) => item.status === "active").length;
  const failedRequestCount = requestLogs.filter((item) => item.status >= 400).length;
  const errorRate = requestLogs.length ? (failedRequestCount / requestLogs.length) * 100 : 0;
  const scopeById = new Map(scopes.map((scope) => [scope.id, scope]));

  const tabCounts: Record<ApiConsoleTab, number> = {
    access: apiKeys.length,
    endpoints: endpoints.length,
    webhooks: webhooks.length,
    requests: requestLogs.length,
  };
  const tabLabels: Record<ApiConsoleTab, string> = {
    access: copy.tabs.access,
    endpoints: copy.tabs.endpoints,
    webhooks: copy.tabs.webhooks,
    requests: copy.tabs.requests,
  };

  return (
    <div className={cn("panel w-full min-w-0 max-w-full overflow-hidden", className)}>
      <header className="border-b border-[#e5e8eb] bg-white px-4 py-4 md:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase text-[#2b9188]">{copy.header.eyebrow}</span>
              <span className="h-3 w-px bg-[#dfe4e8]" />
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#66727f]">
                <span className={cn("size-1.5 rounded-full", environment === "production" ? "bg-[#2bb7a9]" : "bg-[#d6a536]")} />
                {environment === "production" ? copy.header.production : environment === "sandbox" ? copy.header.sandbox : copy.header.development}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-lg font-bold text-[#243444]">{copy.header.title}</h2>
              <span className="text-xs text-[#7a8690]">{workspaceName}</span>
            </div>
            <div className="mt-2 flex max-w-full items-center gap-1 rounded-md border border-[#e1e5e8] bg-[#f8f9fa] py-1 pl-2 pr-1 sm:w-fit">
              <Globe2 className="size-3.5 shrink-0 text-[#71808b]" />
              <code className="min-w-0 truncate text-[11px] text-[#455463]">{baseUrl}</code>
              <CopyButton locale={locale} value={baseUrl} label={copy.header.copyBaseUrl} className="size-7" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {links?.documentation ? (
              <a href={links.documentation} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                <BookOpen className="size-3.5" />
                {copy.header.documentation}
                <ExternalLink className="size-3" />
              </a>
            ) : null}
            {canManage ? (
              <Button
                size="sm"
                onClick={() => setCreateKeyOpen(true)}
                disabled={!hydrated}
              >
                <Plus className="size-3.5" />
                {copy.header.apiKey}
              </Button>
            ) : links?.createKey ? (
              <a href={links.createKey} className={buttonClassName({ size: "sm" })}>
                <Plus className="size-3.5" />
                {copy.header.apiKey}
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 border-b border-[#e5e8eb] bg-[#fafbfb] md:grid-cols-4">
        <div className="flex min-w-0 items-center gap-3 border-r border-[#e8ebee] px-4 py-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[#e9f8f6] text-[#167e74]"><KeyRound className="size-4" /></span>
          <div className="min-w-0"><p className="text-[10px] font-semibold text-[#7a8690]">{copy.header.activeKeys}</p><p className="mt-0.5 text-sm font-bold text-[#243444]">{activeKeyCount}</p></div>
        </div>
        <div className="flex min-w-0 items-center gap-3 px-4 py-3 md:border-r md:border-[#e8ebee]">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]"><Zap className="size-4" /></span>
          <div className="min-w-0"><p className="text-[10px] font-semibold text-[#7a8690]">{copy.header.endpoints}</p><p className="mt-0.5 text-sm font-bold text-[#243444]">{endpoints.length}</p></div>
        </div>
        <div className="flex min-w-0 items-center gap-3 border-r border-t border-[#e8ebee] px-4 py-3 md:border-t-0">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[#fbf6e7] text-[#8d6a12]"><Webhook className="size-4" /></span>
          <div className="min-w-0"><p className="text-[10px] font-semibold text-[#7a8690]">{copy.header.healthyWebhooks}</p><p className="mt-0.5 text-sm font-bold text-[#243444]">{healthyWebhookCount}/{webhooks.length}</p></div>
        </div>
        <div className="flex min-w-0 items-center gap-3 border-t border-[#e8ebee] px-4 py-3 md:border-t-0">
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", errorRate > 5 ? "bg-[#fdf0ee] text-[#b84e42]" : "bg-[#e9f8f6] text-[#167e74]")}><Activity className="size-4" /></span>
          <div className="min-w-0"><p className="text-[10px] font-semibold text-[#7a8690]">{copy.header.errorRate}</p><p className="mt-0.5 text-sm font-bold text-[#243444]">{formatApiConsolePercent(errorRate, locale)}</p></div>
        </div>
      </section>

      <nav className="w-full min-w-0 max-w-full overflow-x-auto border-b border-[#e5e8eb] bg-white px-2 md:px-4" role="tablist" aria-label={copy.tabs.ariaLabel}>
        <div className="flex min-w-max">
          {tabDefinitions.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              aria-controls={`api-console-panel-${id}`}
              onClick={() => setActiveTab(id)}
              disabled={!hydrated}
              className={cn(
                "focus-ring relative flex h-12 items-center gap-2 px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 md:px-4",
                activeTab === id ? "text-[#17324d]" : "text-[#71808b] hover:text-[#243444]",
              )}
            >
              <Icon className={cn("size-4", activeTab === id && "text-[#2b9188]")} />
              {tabLabels[id]}
              <span className={cn("rounded px-1.5 py-0.5 text-[9px]", activeTab === id ? "bg-[#e9f8f6] text-[#167e74]" : "bg-[#f0f2f4] text-[#7a8690]")}>
                {tabCounts[id]}
              </span>
              {activeTab === id ? <span className="absolute inset-x-3 bottom-0 h-0.5 bg-[#2bb7a9]" /> : null}
            </button>
          ))}
        </div>
      </nav>

      {activeTab === "access" ? (
        <section id="api-console-panel-access" role="tabpanel" className="grid min-h-[480px] w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.75fr)]">
          <div className="min-w-0 border-b border-[#e5e8eb] lg:border-b-0 lg:border-r">
            <div className="flex flex-col gap-3 border-b border-[#e8ebee] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div><h3 className="text-sm font-bold text-[#243444]">{copy.access.title}</h3><p className="mt-0.5 text-[11px] text-[#7a8690]">{copy.access.description}</p></div>
              <div className="flex min-w-0 flex-1 gap-2 sm:max-w-md">
                <SearchField value={keyQuery} onChange={setKeyQuery} placeholder={copy.access.search} className="min-w-0 flex-1" />
                <label className="relative shrink-0">
                  <span className="sr-only">{copy.access.filterAria}</span>
                  <ListFilter className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#84909a]" />
                  <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value)} className="focus-ring h-9 max-w-40 rounded-md border border-[#dfe4e8] bg-white pl-8 pr-2 text-xs text-[#52606d]">
                    <option value="all">{copy.access.allScopes}</option>
                    {scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.label}</option>)}
                  </select>
                </label>
              </div>
            </div>
            {filteredKeys.length ? (
              <div className="table-scroll min-w-0 max-w-full overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-left">
                  <thead><tr className="bg-[#f7f8f9] text-[9px] font-bold uppercase text-[#7c8790]"><th className="px-4 py-2.5">{copy.access.columns.key}</th><th className="px-4 py-2.5">{copy.access.columns.scopes}</th><th className="px-4 py-2.5">{copy.access.columns.usage}</th><th className="px-4 py-2.5">{copy.access.columns.created}</th><th className="px-4 py-2.5">{copy.access.columns.status}</th><th className="w-10 px-3 py-2.5"><span className="sr-only">{copy.access.columns.action}</span></th></tr></thead>
                  <tbody className="divide-y divide-[#edf0f2]">
                    {filteredKeys.map((key) => (
                      <tr key={key.id} className="hover:bg-[#fafbfb]">
                        <td className="px-4 py-3"><div className="flex items-center gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-md border border-[#dfe4e8] bg-white text-[#52606d]"><KeyRound className="size-3.5" /></span><div><p className="text-xs font-semibold text-[#2b3a48]">{key.name}</p><code className="mt-0.5 block text-[10px] text-[#7a8690]">{key.maskedValue}</code>{key.ownerName ? <p className="mt-0.5 text-[9px] text-[#8a949d]">{key.ownerName}</p> : null}</div></div></td>
                        <td className="max-w-64 px-4 py-3"><div className="flex flex-wrap gap-1">{key.scopes.slice(0, 3).map((scopeId) => <span key={scopeId} className="rounded border border-[#e1e5e8] bg-[#f5f7f8] px-1.5 py-0.5 font-mono text-[9px] text-[#52606d]">{scopeById.get(scopeId)?.label ?? scopeId}</span>)}{key.scopes.length > 3 ? <span className="px-1 py-0.5 text-[9px] font-semibold text-[#7a8690]">+{key.scopes.length - 3}</span> : null}</div></td>
                        <td className="px-4 py-3"><p className="text-[10px] font-medium text-[#52606d]">{key.requestCount === undefined ? "-" : copy.access.requests(formatApiConsoleNumber(key.requestCount, locale))}</p><p className="mt-1 text-[9px] text-[#8a949d]">{copy.access.lastUsed(formatApiConsoleDateTime(key.lastUsedAt, locale))}</p></td>
                        <td className="px-4 py-3"><p className="text-[10px] text-[#52606d]">{formatApiConsoleDateTime(key.createdAt, locale)}</p>{key.expiresAt ? <p className="mt-1 text-[9px] text-[#8a949d]">{copy.access.validUntil(formatApiConsoleDateTime(key.expiresAt, locale))}</p> : <p className="mt-1 text-[9px] text-[#8a949d]">{copy.access.unlimited}</p>}</td>
                        <td className="px-4 py-3"><Badge tone={key.status === "active" ? "teal" : key.status === "expired" ? "amber" : "coral"}>{key.status === "active" ? copy.access.active : key.status === "expired" ? copy.access.expired : copy.access.revoked}</Badge></td>
                        <td className="px-3 py-3">{canManage ? <ApiKeyRowActions locale={locale} item={key} /> : key.manageHref ? <a href={key.manageHref} className="focus-ring grid size-8 place-items-center rounded-md text-[#71808b] hover:bg-[#edf1f3] hover:text-[#17324d]" aria-label={copy.common.manage(key.name)}><ChevronRight className="size-4" /></a> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState icon={KeyRound} title={copy.access.emptyTitle} description={copy.access.emptyDescription} />}
          </div>

          <aside className="min-w-0 bg-[#fafbfb]">
            <div className="border-b border-[#e8ebee] p-4"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-[#2b9188]" /><h3 className="text-sm font-bold text-[#243444]">{copy.access.catalogTitle}</h3></div><p className="mt-1 text-[11px] leading-5 text-[#7a8690]">{copy.access.catalogDescription}</p></div>
            <div className="divide-y divide-[#e8ebee]">
              {scopes.map((scope) => (
                <button key={scope.id} type="button" onClick={() => setScopeFilter(scopeFilter === scope.id ? "all" : scope.id)} className={cn("focus-ring w-full px-4 py-3 text-left transition-colors hover:bg-white", scopeFilter === scope.id && "bg-[#edf6f5]")}>
                  <span className="flex items-start justify-between gap-3"><span className="min-w-0"><span className="block text-xs font-semibold text-[#2b3a48]">{scope.label}</span><code className="mt-0.5 block truncate text-[9px] text-[#7a8690]">{scope.id}</code></span>{scope.access ? <span className={cn("rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase", accessStyles[scope.access])}>{scope.access === "read" ? copy.access.read : scope.access === "write" ? copy.access.write : copy.access.admin}</span> : null}</span>
                  <span className="mt-2 block text-[10px] leading-4 text-[#66727f]">{scope.description}</span>
                </button>
              ))}
              {!scopes.length ? <EmptyState icon={ShieldCheck} title={copy.access.noScopesTitle} description={copy.access.noScopesDescription} /> : null}
            </div>
          </aside>
        </section>
      ) : null}

      {activeTab === "endpoints" ? (
        <section id="api-console-panel-endpoints" role="tabpanel" className="grid min-h-[640px] w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="min-w-0 border-b border-[#e5e8eb] lg:border-b-0 lg:border-r">
            <div className="grid gap-2 border-b border-[#e8ebee] p-3">
              <SearchField value={endpointQuery} onChange={setEndpointQuery} placeholder={copy.endpoints.search} />
              <label className="relative">
                <span className="sr-only">{copy.endpoints.filterAria}</span>
                <ListFilter className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#84909a]" />
                <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value)} className="focus-ring h-9 w-full rounded-md border border-[#dfe4e8] bg-white pl-9 pr-3 text-xs text-[#52606d]">
                  <option value="all">{copy.endpoints.allScopes}</option>
                  {scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.label}</option>)}
                </select>
              </label>
            </div>
            <div className="max-h-[560px] overflow-y-auto p-2">
              {filteredEndpoints.map((endpoint) => (
                <button key={endpoint.id} type="button" onClick={() => setSelectedEndpointId(endpoint.id)} className={cn("focus-ring mb-1 w-full rounded-md px-2.5 py-2.5 text-left transition-colors", selectedEndpoint?.id === endpoint.id ? "bg-[#edf6f5]" : "hover:bg-[#f5f7f8]")}>
                  <span className="flex items-center gap-2"><MethodBadge method={endpoint.method} /><code className="min-w-0 flex-1 truncate text-[10px] font-semibold text-[#455463]">{endpoint.path}</code><ChevronRight className={cn("size-3.5 shrink-0 text-[#9aa3aa]", selectedEndpoint?.id === endpoint.id && "text-[#2b9188]")} /></span>
                  <span className="mt-1.5 block truncate text-[11px] font-semibold text-[#2b3a48]">{endpoint.title}</span>
                  <span className="mt-0.5 block text-[9px] font-medium uppercase text-[#8a949d]">{endpoint.group}</span>
                </button>
              ))}
              {!filteredEndpoints.length ? <EmptyState icon={Code2} title={copy.endpoints.emptyTitle} description={copy.endpoints.emptyDescription} /> : null}
            </div>
          </aside>

          {selectedEndpoint ? (
            <div className="min-w-0">
              <div className="border-b border-[#e8ebee] p-4 md:p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><MethodBadge method={selectedEndpoint.method} /><span className="text-[10px] font-bold uppercase text-[#7a8690]">{selectedEndpoint.group}</span>{selectedEndpoint.stability ? <Badge tone={selectedEndpoint.stability === "stable" ? "teal" : selectedEndpoint.stability === "beta" ? "amber" : "coral"}>{selectedEndpoint.stability === "stable" ? copy.endpoints.stable : selectedEndpoint.stability === "beta" ? copy.endpoints.beta : copy.endpoints.deprecated}</Badge> : null}</div>
                    <h3 className="mt-3 text-lg font-bold text-[#243444]">{selectedEndpoint.title}</h3>
                    <p className="mt-1 max-w-3xl text-xs leading-5 text-[#66727f]">{selectedEndpoint.description}</p>
                  </div>
                  <span className="flex max-w-full items-center gap-1 rounded-md border border-[#dfe4e8] bg-[#f8f9fa] py-1 pl-2 pr-1"><code className="min-w-0 truncate text-[10px] text-[#455463]">{selectedEndpoint.path}</code><CopyButton locale={locale} value={selectedEndpoint.path} label={copy.endpoints.copyPath} className="size-7" /></span>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-1.5"><span className="mr-1 text-[9px] font-bold uppercase text-[#8a949d]">{copy.endpoints.requiredScopes}</span>{selectedEndpoint.scopes.length ? selectedEndpoint.scopes.map((scopeId) => <span key={scopeId} className="rounded border border-[#dfe4e8] bg-white px-2 py-1 font-mono text-[9px] text-[#52606d]">{scopeById.get(scopeId)?.label ?? scopeId}</span>) : <span className="text-[10px] text-[#7a8690]">{copy.endpoints.public}</span>}</div>
              </div>

              <div className="grid gap-6 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)] xl:p-5">
                <div className="min-w-0">
                  <div className="flex items-center justify-between"><h4 className="text-xs font-bold uppercase text-[#52606d]">{copy.endpoints.requestContract}</h4><span className="text-[10px] text-[#8a949d]">{selectedEndpoint.version ?? apiVersion}</span></div>
                  {selectedEndpoint.parameters?.length ? (
                    <div className="table-scroll mt-3 overflow-x-auto rounded-md border border-[#e1e5e8]">
                      <table className="w-full min-w-[560px] border-collapse text-left"><thead><tr className="bg-[#f7f8f9] text-[9px] font-bold uppercase text-[#7c8790]"><th className="px-3 py-2">{copy.endpoints.parameter}</th><th className="px-3 py-2">{copy.endpoints.location}</th><th className="px-3 py-2">{copy.endpoints.type}</th><th className="px-3 py-2">{copy.endpoints.description}</th></tr></thead><tbody className="divide-y divide-[#edf0f2]">{selectedEndpoint.parameters.map((parameter) => <tr key={`${parameter.location}-${parameter.name}`}><td className="px-3 py-2.5"><code className="text-[10px] font-semibold text-[#243444]">{parameter.name}</code>{parameter.required ? <span className="ml-1 text-[9px] font-bold text-[#b84e42]">*</span> : null}</td><td className="px-3 py-2.5"><span className="rounded bg-[#f0f2f4] px-1.5 py-0.5 text-[9px] font-semibold text-[#66727f]">{parameter.location}</span></td><td className="px-3 py-2.5 font-mono text-[10px] text-[#52606d]">{parameter.type}</td><td className="px-3 py-2.5 text-[10px] leading-4 text-[#66727f]">{parameter.description}{parameter.example ? <code className="mt-1 block text-[9px] text-[#8a949d]">{copy.endpoints.example(parameter.example)}</code> : null}</td></tr>)}</tbody></table>
                    </div>
                  ) : <div className="mt-3 rounded-md border border-dashed border-[#dfe4e8] px-4 py-5 text-center text-[11px] text-[#7a8690]">{copy.endpoints.noParameters}</div>}

                  {selectedEndpoint.responses?.length ? <div className="mt-6"><h4 className="text-xs font-bold uppercase text-[#52606d]">{copy.endpoints.responses}</h4><div className="mt-3 divide-y divide-[#edf0f2] rounded-md border border-[#e1e5e8]">{selectedEndpoint.responses.map((response) => <div key={response.status} className="flex items-center gap-3 px-3 py-2.5"><span className={cn("min-w-10 rounded px-1.5 py-1 text-center font-mono text-[10px] font-bold", statusTone(response.status))}>{response.status}</span><span className="text-[10px] text-[#66727f]">{response.description}</span></div>)}</div></div> : null}
                </div>

                <div className="min-w-0">
                  <div className="overflow-hidden rounded-md border border-[#233b52] bg-[#10283e] shadow-sm">
                    <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                      <div className="flex items-center gap-1 rounded bg-white/5 p-0.5" role="tablist" aria-label={copy.endpoints.codeLanguageAria}>
                        {(["curl", "javascript"] as const).map((language) => <button key={language} type="button" role="tab" aria-selected={codeLanguage === language} onClick={() => setCodeLanguage(language)} className={cn("focus-ring flex h-7 items-center gap-1.5 rounded px-2.5 text-[10px] font-semibold transition-colors", codeLanguage === language ? "bg-white text-[#17324d]" : "text-[#b9c6d1] hover:text-white")}>{language === "curl" ? <Terminal className="size-3" /> : <Braces className="size-3" />}{language === "curl" ? "cURL" : "JavaScript"}</button>)}
                      </div>
                      <CopyButton locale={locale} value={buildCodeExample(selectedEndpoint, baseUrl, codeLanguage, copy)} label={copy.endpoints.copyCode} className="text-[#b9c6d1] hover:bg-white/10 hover:text-white" />
                    </div>
                    <pre className="table-scroll max-h-80 overflow-auto p-4 font-mono text-[11px] leading-5 text-[#d8e4ed]"><code>{buildCodeExample(selectedEndpoint, baseUrl, codeLanguage, copy)}</code></pre>
                  </div>
                  {selectedEndpoint.responseExample ? <div className="mt-4 overflow-hidden rounded-md border border-[#dfe4e8]"><div className="flex items-center justify-between border-b border-[#e8ebee] bg-[#f7f8f9] px-3 py-2"><span className="flex items-center gap-1.5 text-[10px] font-bold text-[#52606d]"><CircleDot className="size-3 text-[#2b9188]" />{copy.endpoints.responseExample}</span><CopyButton locale={locale} value={selectedEndpoint.responseExample} label={copy.endpoints.copyResponse} className="size-7" /></div><pre className="table-scroll max-h-56 overflow-auto bg-white p-3 font-mono text-[10px] leading-5 text-[#455463]"><code>{selectedEndpoint.responseExample}</code></pre></div> : null}
                </div>
              </div>
            </div>
          ) : <EmptyState icon={Code2} title={copy.endpoints.selectTitle} description={copy.endpoints.selectDescription} />}
        </section>
      ) : null}

      {activeTab === "webhooks" ? (
        <section id="api-console-panel-webhooks" role="tabpanel" className="min-h-[480px]">
          <div className="flex flex-col gap-3 border-b border-[#e8ebee] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><h3 className="text-sm font-bold text-[#243444]">{copy.webhooks.title}</h3><p className="mt-0.5 text-[11px] text-[#7a8690]">{copy.webhooks.description}</p></div>
            <div className="flex min-w-0 gap-2"><SearchField value={webhookQuery} onChange={setWebhookQuery} placeholder={copy.webhooks.search} className="min-w-0 flex-1 sm:w-64" />{canManage ? <Button size="sm" onClick={() => setCreateWebhookOpen(true)}><Plus className="size-3.5" />Webhook</Button> : links?.createWebhook ? <a href={links.createWebhook} className={buttonClassName({ size: "sm" })}><Plus className="size-3.5" />Webhook</a> : null}</div>
          </div>
          {filteredWebhooks.length ? (
            <>
            <div className="table-scroll hidden overflow-x-auto md:block">
              <table className="w-full min-w-[940px] border-collapse text-left"><thead><tr className="bg-[#f7f8f9] text-[9px] font-bold uppercase text-[#7c8790]"><th className="px-4 py-2.5">{copy.webhooks.columns.target}</th><th className="px-4 py-2.5">{copy.webhooks.columns.events}</th><th className="px-4 py-2.5">{copy.webhooks.columns.lastDelivery}</th><th className="px-4 py-2.5">{copy.webhooks.columns.successRate}</th><th className="px-4 py-2.5">{copy.webhooks.columns.status}</th><th className="w-28 px-3 py-2.5"><span className="sr-only">{copy.webhooks.columns.actions}</span></th></tr></thead>
                <tbody className="divide-y divide-[#edf0f2]">{filteredWebhooks.map((item) => <tr key={item.id} className="hover:bg-[#fafbfb]"><td className="px-4 py-3"><div className="flex items-center gap-3"><span className={cn("grid size-8 shrink-0 place-items-center rounded-md", item.status === "active" ? "bg-[#e9f8f6] text-[#167e74]" : item.status === "failing" ? "bg-[#fdf0ee] text-[#b84e42]" : "bg-[#f4f6f7] text-[#66727f]")}><Webhook className="size-4" /></span><div className="min-w-0"><p className="text-xs font-semibold text-[#2b3a48]">{item.name}</p><div className="mt-0.5 flex max-w-xs items-center gap-1"><code className="truncate text-[9px] text-[#7a8690]">{item.url}</code><CopyButton locale={locale} value={item.url} label={copy.webhooks.copyUrl} className="size-6" /></div>{item.signingSecretHint ? <p className="mt-0.5 font-mono text-[9px] text-[#8a949d]">{copy.webhooks.signature(item.signingSecretHint)}</p> : null}</div></div></td><td className="max-w-72 px-4 py-3"><div className="flex flex-wrap gap-1">{item.events.slice(0, 3).map((event) => <span key={event} className="rounded border border-[#e1e5e8] bg-[#f5f7f8] px-1.5 py-0.5 font-mono text-[9px] text-[#52606d]">{event}</span>)}{item.events.length > 3 ? <span className="px-1 py-0.5 text-[9px] font-semibold text-[#7a8690]">+{item.events.length - 3}</span> : null}</div></td><td className="px-4 py-3"><div className="flex items-center gap-1.5"><span className={cn("size-1.5 rounded-full", item.lastDeliveryStatus === null || item.lastDeliveryStatus === undefined ? "bg-[#aab2b9]" : item.lastDeliveryStatus < 400 ? "bg-[#2bb7a9]" : "bg-[#ee6c5d]")} /><span className="text-[10px] font-semibold text-[#52606d]">{item.lastDeliveryStatus ?? "-"}</span></div><p className="mt-1 text-[9px] text-[#8a949d]">{formatApiConsoleDateTime(item.lastDeliveryAt, locale)}</p></td><td className="px-4 py-3"><p className="text-xs font-semibold text-[#2b3a48]">{item.successRate === null || item.successRate === undefined ? "-" : formatApiConsolePercent(item.successRate, locale)}</p><div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-[#edf0f2]"><span className={cn("block h-full rounded-full", (item.successRate ?? 0) >= 95 ? "bg-[#2bb7a9]" : "bg-[#ee6c5d]")} style={{ width: `${Math.min(100, Math.max(0, item.successRate ?? 0))}%` }} /></div></td><td className="px-4 py-3"><Badge tone={item.status === "active" ? "teal" : item.status === "failing" ? "coral" : "neutral"}>{item.status === "active" ? copy.webhooks.active : item.status === "failing" ? copy.webhooks.failing : copy.webhooks.paused}</Badge></td><td className="px-3 py-3">{canManage ? <WebhookRowActions locale={locale} item={item} /> : item.manageHref ? <a href={item.manageHref} className="focus-ring grid size-8 place-items-center rounded-md text-[#71808b] hover:bg-[#edf1f3] hover:text-[#17324d]" aria-label={copy.common.manage(item.name)}><ChevronRight className="size-4" /></a> : null}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="divide-y divide-[#edf0f2] md:hidden">
              {filteredWebhooks.map((item) => (
                <article key={item.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", item.status === "active" ? "bg-[#e9f8f6] text-[#167e74]" : item.status === "failing" ? "bg-[#fdf0ee] text-[#b84e42]" : "bg-[#f4f6f7] text-[#66727f]")}><Webhook className="size-4" /></span>
                    <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-[#2b3a48]">{item.name}</p><div className="mt-1 flex min-w-0 items-center gap-1"><code className="min-w-0 flex-1 truncate text-[9px] text-[#71808b]">{item.url}</code><CopyButton locale={locale} value={item.url} label={copy.webhooks.copyUrl} className="size-6" /></div></div>
                    <Badge tone={item.status === "active" ? "teal" : item.status === "failing" ? "coral" : "neutral"}>{item.status === "active" ? copy.webhooks.active : item.status === "failing" ? copy.webhooks.failing : copy.webhooks.paused}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">{item.events.slice(0, 3).map((event) => <code key={event} className="max-w-full break-all rounded border border-[#e1e5e8] bg-[#f5f7f8] px-1.5 py-0.5 text-[9px] text-[#52606d]">{event}</code>)}{item.events.length > 3 ? <span className="px-1 py-0.5 text-[9px] font-semibold text-[#7a8690]">+{item.events.length - 3}</span> : null}</div>
                  <div className="mt-3 flex items-end justify-between gap-3 border-t border-[#edf0f2] pt-3">
                    <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[10px] text-[#71808b]"><span>HTTP {item.lastDeliveryStatus ?? "-"}</span><span>{formatApiConsoleDateTime(item.lastDeliveryAt, locale)}</span><span>{item.successRate === null || item.successRate === undefined ? copy.webhooks.noRate : copy.webhooks.successfulRate(formatApiConsolePercent(item.successRate, locale))}</span></div>
                    {canManage ? <WebhookRowActions locale={locale} item={item} /> : item.manageHref ? <a href={item.manageHref} className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-[#71808b] hover:bg-[#edf1f3] hover:text-[#17324d]" aria-label={copy.common.manage(item.name)}><ChevronRight className="size-4" /></a> : null}
                  </div>
                </article>
              ))}
            </div>
            </>
          ) : <EmptyState icon={Webhook} title={copy.webhooks.emptyTitle} description={copy.webhooks.emptyDescription} />}
          <WebhookDeadLetterSection
            locale={locale}
            initialDeliveries={failedWebhookDeliveries}
            canReplay={canManage}
          />
        </section>
      ) : null}

      {activeTab === "requests" ? (
        <section id="api-console-panel-requests" role="tabpanel" className="min-h-[480px]">
          <div className="flex flex-col gap-3 border-b border-[#e8ebee] p-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-bold text-[#243444]">{copy.requests.title}</h3><p className="mt-0.5 text-[11px] text-[#7a8690]">{copy.requests.description}</p></div><SearchField value={requestQuery} onChange={setRequestQuery} placeholder={copy.requests.search} className="sm:w-72" /></div>
          {filteredRequests.length ? (
            <div className="table-scroll min-w-0 max-w-full overflow-x-auto"><table className="w-full min-w-[920px] border-collapse text-left"><thead><tr className="bg-[#f7f8f9] text-[9px] font-bold uppercase text-[#7c8790]"><th className="px-4 py-2.5">{copy.requests.columns.time}</th><th className="px-4 py-2.5">{copy.requests.columns.request}</th><th className="px-4 py-2.5">{copy.requests.columns.status}</th><th className="px-4 py-2.5">{copy.requests.columns.latency}</th><th className="px-4 py-2.5">{copy.requests.columns.apiKey}</th><th className="px-4 py-2.5">{copy.requests.columns.requestId}</th><th className="px-4 py-2.5">{copy.requests.columns.response}</th></tr></thead><tbody className="divide-y divide-[#edf0f2]">{filteredRequests.map((request) => <tr key={request.id} className="hover:bg-[#fafbfb]"><td className="whitespace-nowrap px-4 py-3"><p className="text-[10px] text-[#52606d]">{formatApiConsoleDateTime(request.timestamp, locale)}</p>{request.ipAddress ? <p className="mt-1 font-mono text-[9px] text-[#8a949d]">{request.ipAddress}</p> : null}</td><td className="max-w-sm px-4 py-3"><div className="flex items-center gap-2"><MethodBadge method={request.method} /><code className="truncate text-[10px] font-semibold text-[#455463]">{request.path}</code></div></td><td className="px-4 py-3"><span className={cn("inline-flex min-w-10 justify-center rounded px-1.5 py-1 font-mono text-[10px] font-bold", statusTone(request.status))}>{request.status}</span></td><td className="px-4 py-3"><span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold", request.durationMs > 1000 ? "text-[#b84e42]" : request.durationMs > 400 ? "text-[#8d6a12]" : "text-[#52606d]")}><Clock3 className="size-3" />{formatApiConsoleNumber(request.durationMs, locale)} ms</span></td><td className="px-4 py-3 text-[10px] text-[#52606d]">{request.apiKeyName ?? "-"}</td><td className="px-4 py-3"><div className="flex items-center gap-1"><code className="max-w-36 truncate text-[9px] text-[#66727f]">{request.requestId}</code><CopyButton locale={locale} value={request.requestId} label={copy.requests.copyRequestId} className="size-6" /></div></td><td className="px-4 py-3 text-[10px] text-[#66727f]">{formatApiConsoleBytes(request.responseSizeBytes, locale)}</td></tr>)}</tbody></table></div>
          ) : <EmptyState icon={Activity} title={copy.requests.emptyTitle} description={copy.requests.emptyDescription} />}
          {filteredRequests.length ? <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#edf0f2] px-4 py-3 text-[10px] text-[#7a8690]"><span>{copy.requests.shown(filteredRequests.length, requestLogs.length)}</span><span className="flex items-center gap-1.5">{errorRate > 5 ? <AlertTriangle className="size-3 text-[#d6a536]" /> : <ShieldCheck className="size-3 text-[#2b9188]" />}{copy.requests.errorRate(formatApiConsolePercent(errorRate, locale))}</span></div> : null}
        </section>
      ) : null}
      {createKeyOpen ? <CreateApiKeyDialog locale={locale} scopes={scopes} canManagePrivacyScopes={canManagePrivacyScopes} ownerStepUpMode={ownerStepUpMode} onClose={() => setCreateKeyOpen(false)} /> : null}
      {createWebhookOpen ? <CreateWebhookDialog locale={locale} events={webhookEvents} onClose={() => setCreateWebhookOpen(false)} /> : null}
    </div>
  );
}

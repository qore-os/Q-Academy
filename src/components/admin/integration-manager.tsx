"use client";

import {
  CheckCircle2,
  Copy,
  Headphones,
  KeyRound,
  Link2,
  LoaderCircle,
  PackageOpen,
  PlugZap,
  Power,
  PowerOff,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  X,
  Workflow,
} from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  createCommerceMappingAction,
  createCommerceProductAction,
  createN8nWorkflowAction,
  saveCommerceConnectionAction,
  saveSupportSettingsAction,
  toggleCommerceResourceAction,
  type CommerceAdminActionCode,
  type CommerceAdminActionState,
} from "@/lib/commerce/admin-actions";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import {
  getIntegrationAdminCopy,
  type IntegrationAdminCopy,
} from "@/lib/i18n/integration-admin";

const initialState: CommerceAdminActionState = { ok: null, message: "" };
const inputClass =
  "focus-ring brand-radius h-10 w-full border border-[#dce1e5] bg-white px-3 text-sm text-[#243444] placeholder:text-[var(--theme-muted-text)]";

const workflowEventCopyKeys = {
  "commerce.order.created": "orderCreated",
  "commerce.subscription.activated": "subscriptionActivated",
  "commerce.subscription.payment_failed": "paymentFailed",
  "commerce.subscription.cancelled": "subscriptionCancelled",
  "commerce.subscription.expired": "subscriptionExpired",
  "commerce.entitlement.granted": "entitlementGranted",
  "commerce.entitlement.revoked": "entitlementRevoked",
  "automation.member.upserted": "memberUpserted",
  "automation.n8n.triggered": "n8nTriggered",
} as const;

const workflowEvents: (keyof typeof workflowEventCopyKeys)[] = [
  "commerce.order.created",
  "commerce.subscription.activated",
  "commerce.subscription.payment_failed",
  "commerce.subscription.cancelled",
  "commerce.subscription.expired",
  "commerce.entitlement.granted",
  "commerce.entitlement.revoked",
  "automation.member.upserted",
  "automation.n8n.triggered",
];

type OperatorActionCode = Extract<
  CommerceAdminActionCode,
  | "connectionSignatureUnsupported"
  | "connectionPreflightPassed"
  | "connectionPreflightFailed"
  | "connectionEndpointRotated"
  | "supportPreflightPassed"
  | "supportPreflightFailed"
  | "workflowTestQueued"
>;

const operatorCopy: Record<
  AppLocale,
  {
    preflight: string;
    testDelivery: string;
    rotateEndpoint: string;
    confirmRotation: string;
    cancel: string;
    messages: Record<OperatorActionCode, string>;
  }
> = {
  de: {
    preflight: "Konfiguration pruefen",
    testDelivery: "Testzustellung senden",
    rotateEndpoint: "Geheimen Endpunkt rotieren",
    confirmRotation: "Der bisherige Provider-Endpunkt wird sofort ungueltig.",
    cancel: "Abbrechen",
    messages: {
      connectionSignatureUnsupported:
        "Dieser Signaturmodus ist fuer den Provider nicht zulaessig.",
      connectionPreflightPassed:
        "Signaturadapter und aktive Produktzuordnung sind gueltig.",
      connectionPreflightFailed:
        "Provideradapter oder Produktzuordnung sind nicht einsatzbereit.",
      connectionEndpointRotated: "Der geheime Provider-Endpunkt wurde rotiert.",
      supportPreflightPassed: "Der effektive Support-Launcher ist gueltig.",
      supportPreflightFailed: "Der Support-Launcher ist nicht einsatzbereit.",
      workflowTestQueued: "Die signierte Testzustellung wurde eingereiht.",
    },
  },
  en: {
    preflight: "Check configuration",
    testDelivery: "Send test delivery",
    rotateEndpoint: "Rotate secret endpoint",
    confirmRotation: "The previous provider endpoint becomes invalid immediately.",
    cancel: "Cancel",
    messages: {
      connectionSignatureUnsupported:
        "This signature mode is not allowed for the provider.",
      connectionPreflightPassed:
        "The signature adapter and active product mapping are valid.",
      connectionPreflightFailed:
        "The provider adapter or product mapping is not ready.",
      connectionEndpointRotated: "The secret provider endpoint was rotated.",
      supportPreflightPassed: "The effective support launcher is valid.",
      supportPreflightFailed: "The support launcher is not ready.",
      workflowTestQueued: "The signed test delivery was queued.",
    },
  },
  it: {
    preflight: "Verifica configurazione",
    testDelivery: "Invia consegna di prova",
    rotateEndpoint: "Ruota endpoint segreto",
    confirmRotation: "L'endpoint precedente diventa subito non valido.",
    cancel: "Annulla",
    messages: {
      connectionSignatureUnsupported:
        "Questa modalita di firma non e consentita per il provider.",
      connectionPreflightPassed:
        "L'adattatore di firma e la mappatura attiva sono validi.",
      connectionPreflightFailed:
        "L'adattatore o la mappatura del prodotto non sono pronti.",
      connectionEndpointRotated: "L'endpoint segreto del provider e stato ruotato.",
      supportPreflightPassed: "Il launcher di supporto effettivo e valido.",
      supportPreflightFailed: "Il launcher di supporto non e pronto.",
      workflowTestQueued: "La consegna di prova firmata e stata accodata.",
    },
  },
  es: {
    preflight: "Comprobar configuracion",
    testDelivery: "Enviar entrega de prueba",
    rotateEndpoint: "Rotar endpoint secreto",
    confirmRotation: "El endpoint anterior deja de ser valido inmediatamente.",
    cancel: "Cancelar",
    messages: {
      connectionSignatureUnsupported:
        "Este modo de firma no esta permitido para el proveedor.",
      connectionPreflightPassed:
        "El adaptador de firma y la asignacion activa son validos.",
      connectionPreflightFailed:
        "El adaptador o la asignacion del producto no estan listos.",
      connectionEndpointRotated: "El endpoint secreto del proveedor se ha rotado.",
      supportPreflightPassed: "El lanzador de soporte efectivo es valido.",
      supportPreflightFailed: "El lanzador de soporte no esta listo.",
      workflowTestQueued: "La entrega de prueba firmada se ha encolado.",
    },
  },
  fr: {
    preflight: "Verifier la configuration",
    testDelivery: "Envoyer une livraison de test",
    rotateEndpoint: "Renouveler le endpoint secret",
    confirmRotation: "L'ancien endpoint devient immediatement invalide.",
    cancel: "Annuler",
    messages: {
      connectionSignatureUnsupported:
        "Ce mode de signature n'est pas autorise pour le fournisseur.",
      connectionPreflightPassed:
        "L'adaptateur de signature et l'association active sont valides.",
      connectionPreflightFailed:
        "L'adaptateur ou l'association du produit ne sont pas prets.",
      connectionEndpointRotated: "Le endpoint secret du fournisseur a ete renouvele.",
      supportPreflightPassed: "Le lanceur d'assistance effectif est valide.",
      supportPreflightFailed: "Le lanceur d'assistance n'est pas pret.",
      workflowTestQueued: "La livraison de test signee a ete mise en file.",
    },
  },
};

type ConnectionRecord = {
  id: string;
  provider: string;
  displayName: string;
  endpointKey: string;
  signatureMode: string;
  active: boolean;
  autoCreateMembers: boolean;
};

type ProductRecord = {
  id: string;
  name: string;
  sku: string;
  bundleId: string;
  bundleName: string;
  active: boolean;
};

type MappingRecord = {
  id: string;
  connectionId: string;
  provider: string;
  productName: string;
  providerProductId: string;
  providerVariantId: string;
  active: boolean;
};

function StatusToggle({
  kind,
  id,
  active,
  copy,
}: {
  kind: "product" | "mapping" | "workflow";
  id: string;
  active: boolean;
  copy: IntegrationAdminCopy;
}) {
  return (
    <form action={toggleCommerceResourceAction}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <button
        type="submit"
        title={active ? copy.common.deactivate : copy.common.activate}
        aria-label={active ? copy.common.deactivate : copy.common.activate}
        className="focus-ring grid size-8 place-items-center rounded-md border border-[#dfe4e8] text-[#52606d] hover:bg-[#f4f6f7]"
      >
        {active ? <PowerOff className="size-4" /> : <Power className="size-4" />}
      </button>
    </form>
  );
}

type SupportDefaults = {
  enabled: boolean;
  provider: string;
  launcherLabel: string;
  supportUrl: string | null;
  supportEmail: string | null;
  intercomAppId: string | null;
  identitySecretConfigured: boolean;
};

function FormResult({
  state,
  copy,
  locale,
}: {
  state: CommerceAdminActionState;
  copy: IntegrationAdminCopy;
  locale: AppLocale;
}) {
  const operatorMessage = state.code
    ? (operatorCopy[locale].messages as Partial<
        Record<CommerceAdminActionCode, string>
      >)[state.code]
    : undefined;
  const regularMessages = copy.messages as Record<string, string>;
  const message =
    operatorMessage ??
    (state.code ? regularMessages[state.code] : undefined) ??
    regularMessages.invalid;
  return state.message ? (
    <p
      role={state.ok ? "status" : "alert"}
      className={state.ok ? "text-xs text-[#167e74]" : "text-xs text-[#a94339]"}
    >
      {message}
    </p>
  ) : null;
}

function CopyEndpoint({ value, copy }: { value: string; copy: IntegrationAdminCopy }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={copy.connection.copyEndpoint}
      aria-label={copy.connection.copyEndpoint}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
      className="focus-ring grid size-8 shrink-0 place-items-center rounded-md border border-[#dfe4e8] text-[#52606d] hover:bg-[#f4f6f7]"
    >
      {copied ? <CheckCircle2 className="size-4 text-[#167e74]" /> : <Copy className="size-4" />}
    </button>
  );
}

function ConnectionForm({
  connection,
  copy,
  locale,
}: {
  connection?: ConnectionRecord;
  copy: IntegrationAdminCopy;
  locale: AppLocale;
}) {
  const [state, action, pending] = useActionState(
    saveCommerceConnectionAction,
    initialState,
  );
  const [confirmRotation, setConfirmRotation] = useState(false);
  const actions = operatorCopy[locale];
  return (
    <form action={action} className="panel overflow-hidden">
      {connection ? (
        <input type="hidden" name="connectionId" value={connection.id} />
      ) : null}
      <div className="border-b border-[#edf0f2] px-5 py-4">
        <div className="flex items-center gap-2">
          <PlugZap className="size-4 text-[var(--brand-accent)]" />
          <h2 className="text-sm font-bold text-[#243444]">
            {connection ? connection.displayName : copy.connection.connectProvider}
          </h2>
        </div>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.connection.provider}</span>
          <select
            name="provider"
            defaultValue={connection?.provider ?? "digistore24"}
            disabled={Boolean(connection)}
            className={inputClass}
          >
            <option value="digistore24">Digistore24</option>
            <option value="ablefy">Ablefy</option>
            <option value="copecart">Copecart</option>
          </select>
          {connection ? <input type="hidden" name="provider" value={connection.provider} /> : null}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.connection.displayName}</span>
          <input name="displayName" required minLength={2} maxLength={120} defaultValue={connection?.displayName} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.connection.signatureMode}</span>
          <select name="signatureMode" defaultValue={connection?.signatureMode ?? "hmac_sha256"} className={inputClass}>
            <option value="hmac_sha256">{copy.connection.hmac}</option>
            <option value="digistore_sha512">{copy.connection.digistore}</option>
            <option value="shared_token">{copy.connection.token}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#52606d]">
            <KeyRound className="size-3.5" /> {copy.connection.secret}
          </span>
          <input
            name="signingSecret"
            type="password"
            minLength={connection ? undefined : 16}
            maxLength={4096}
            required={!connection}
            placeholder={connection ? copy.connection.unchanged : copy.connection.minimum}
            autoComplete="new-password"
            className={inputClass}
          />
        </label>
        <div className="flex flex-wrap gap-5 md:col-span-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-[#52606d]">
            <input name="active" type="checkbox" defaultChecked={connection?.active ?? true} className="focus-ring size-4 accent-[var(--brand-accent)]" />
            {copy.common.active}
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-[#52606d]">
            <input name="autoCreateMembers" type="checkbox" defaultChecked={connection?.autoCreateMembers ?? true} className="focus-ring size-4 accent-[var(--brand-accent)]" />
            {copy.connection.inviteMembers}
          </label>
        </div>
        {connection ? (
          <div className="rounded-md border border-[#dfe4e8] bg-[#f8fafb] md:col-span-2">
            <div className="flex items-center gap-2 p-2">
              <code className="min-w-0 flex-1 break-all text-xs text-[#354555]">
                {`/api/integrations/commerce/${connection.provider}/${connection.endpointKey}`}
              </code>
              <CopyEndpoint value={`/api/integrations/commerce/${connection.provider}/${connection.endpointKey}`} copy={copy} />
              <button
                type="button"
                title={actions.rotateEndpoint}
                aria-label={actions.rotateEndpoint}
                onClick={() => setConfirmRotation(true)}
                disabled={pending}
                className="focus-ring grid size-8 shrink-0 place-items-center rounded-md border border-[#dfe4e8] text-[#52606d] hover:bg-white disabled:opacity-50"
              >
                <RefreshCw className="size-4" />
              </button>
            </div>
            {confirmRotation ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#dfe4e8] px-3 py-2">
                <p className="text-xs text-[#8f3f38]">{actions.confirmRotation}</p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirmRotation(false)}
                    disabled={pending}
                  >
                    <X className="size-3.5" /> {actions.cancel}
                  </Button>
                  <Button
                    type="submit"
                    name="intent"
                    value="rotate_endpoint"
                    size="sm"
                    variant="danger"
                    disabled={pending}
                  >
                    <RefreshCw className="size-3.5" /> {actions.rotateEndpoint}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3 md:col-span-2">
          <FormResult state={state} copy={copy} locale={locale} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {connection ? (
              <Button
                type="submit"
                name="intent"
                value="preflight"
                variant="secondary"
                disabled={pending}
              >
                <ShieldCheck className="size-4" /> {actions.preflight}
              </Button>
            ) : null}
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              {copy.common.save}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

export function IntegrationManager({
  connections,
  products,
  mappings,
  bundles,
  support,
  stats,
  workflows,
  locale,
}: {
  connections: ConnectionRecord[];
  products: ProductRecord[];
  mappings: MappingRecord[];
  bundles: Array<{ id: string; name: string }>;
  support: SupportDefaults;
  stats: { orders: number; subscriptions: number; activeEntitlements: number; failedEvents: number };
  workflows: Array<{
    id: string;
    name: string;
    url: string;
    events: string[];
    active: boolean;
  }>;
  locale: AppLocale;
}) {
  const copy = getIntegrationAdminCopy(locale);
  const numberFormatter = new Intl.NumberFormat(intlLocale(locale));
  const [productState, productAction, productPending] = useActionState(
    createCommerceProductAction,
    initialState,
  );
  const [mappingState, mappingAction, mappingPending] = useActionState(
    createCommerceMappingAction,
    initialState,
  );
  const [supportState, supportAction, supportPending] = useActionState(
    saveSupportSettingsAction,
    initialState,
  );
  const [workflowState, workflowAction, workflowPending] = useActionState(
    createN8nWorkflowAction,
    initialState,
  );
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={copy.stats.aria}>
        {[
          [copy.stats.orders, stats.orders],
          [copy.stats.subscriptions, stats.subscriptions],
          [copy.stats.entitlements, stats.activeEntitlements],
          [copy.stats.failedEvents, stats.failedEvents],
        ].map(([label, value]) => (
          <div key={String(label)} className="panel px-4 py-3">
            <p className="text-[10px] font-bold uppercase text-[#71808b]">{label}</p>
            <p className="mt-1 text-xl font-bold text-[#243444]">{numberFormatter.format(Number(value))}</p>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-bold text-[#243444]">
          <PlugZap className="size-4 text-[var(--brand-accent)]" /> {copy.connection.sectionTitle}
        </h2>
        <div className="grid gap-4 xl:grid-cols-2">
          {connections.map((connection) => (
            <ConnectionForm
              key={connection.id}
              connection={connection}
              copy={copy}
              locale={locale}
            />
          ))}
          {connections.length < 3 ? (
            <ConnectionForm copy={copy} locale={locale} />
          ) : null}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <form action={productAction} className="panel p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[#243444]">
            <PackageOpen className="size-4 text-[var(--brand-accent)]" /> {copy.product.title}
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input name="name" required placeholder={copy.product.name} className={inputClass} />
            <input name="sku" required placeholder={copy.product.sku} className={inputClass} />
            <select name="bundleId" required className={`${inputClass} sm:col-span-2`}>
              <option value="">{copy.product.selectBundle}</option>
              {bundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.name}</option>)}
            </select>
            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              <FormResult state={productState} copy={copy} locale={locale} />
              <Button type="submit" disabled={productPending || !bundles.length}>
                {productPending ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                {copy.common.create}
              </Button>
            </div>
          </div>
          {products.length ? (
            <div className="mt-5 divide-y divide-[#edf0f2] border-t border-[#edf0f2]">
              {products.map((product) => (
                <div key={product.id} className="flex items-center justify-between gap-3 py-3 text-xs">
                  <span><strong className="block text-[#243444]">{product.name}</strong><span className="text-[#71808b]">{product.sku} · {product.bundleName}</span></span>
                  <StatusToggle kind="product" id={product.id} active={product.active} copy={copy} />
                </div>
              ))}
            </div>
          ) : null}
        </form>

        <form action={mappingAction} className="panel p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[#243444]">
            <Link2 className="size-4 text-[var(--brand-accent)]" /> {copy.mapping.title}
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <select name="connectionId" required className={inputClass}>
              <option value="">{copy.mapping.selectProvider}</option>
              {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.displayName}</option>)}
            </select>
            <select name="productId" required className={inputClass}>
              <option value="">{copy.mapping.selectProduct}</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
            <input name="providerProductId" required placeholder={copy.mapping.providerProductId} className={inputClass} />
            <input name="providerVariantId" placeholder={copy.mapping.variant} className={inputClass} />
            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              <FormResult state={mappingState} copy={copy} locale={locale} />
              <Button type="submit" disabled={mappingPending || !connections.length || !products.length}>
                {mappingPending ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                {copy.mapping.submit}
              </Button>
            </div>
          </div>
          {mappings.length ? (
            <div className="mt-5 divide-y divide-[#edf0f2] border-t border-[#edf0f2]">
              {mappings.map((mapping) => (
                <div key={mapping.id} className="flex items-center justify-between gap-3 py-3 text-xs">
                  <span><strong className="block text-[#243444]">{mapping.productName}</strong>
                  <span className="text-[#71808b]">{mapping.provider}: {mapping.providerProductId}{mapping.providerVariantId ? ` / ${mapping.providerVariantId}` : ""}</span></span>
                  <StatusToggle kind="mapping" id={mapping.id} active={mapping.active} copy={copy} />
                </div>
              ))}
            </div>
          ) : null}
        </form>
      </section>

      <form action={workflowAction} className="panel overflow-hidden">
        <header className="border-b border-[#edf0f2] px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[#243444]">
            <Workflow className="size-4 text-[var(--brand-accent)]" /> {copy.workflow.title}
          </h2>
        </header>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <input name="name" required placeholder={copy.workflow.name} className={inputClass} />
          <input name="url" type="url" required placeholder="https://n8n.example.com/webhook/..." className={inputClass} />
          <input name="signingSecret" type="password" required minLength={16} placeholder={copy.workflow.secret} autoComplete="new-password" className={inputClass} />
          <label className="flex items-center gap-2 text-xs font-semibold text-[#52606d]">
            <input name="active" type="checkbox" defaultChecked className="focus-ring size-4 accent-[var(--brand-accent)]" /> {copy.common.active}
          </label>
          <fieldset className="grid gap-2 border-y border-[#edf0f2] py-3 sm:grid-cols-2 md:col-span-2 lg:grid-cols-3">
            <legend className="px-1 text-xs font-semibold text-[#52606d]">{copy.workflow.events}</legend>
            {workflowEvents.map((event) => (
              <label key={event} className="flex items-center gap-2 text-xs text-[#52606d]">
                <input name="events" value={event} type="checkbox" defaultChecked={event === "automation.n8n.triggered"} className="focus-ring size-4 accent-[var(--brand-accent)]" />
                <span className="min-w-0"><span className="block truncate">{copy.workflow[workflowEventCopyKeys[event]]}</span><code className="block truncate text-[9px] text-[#8a949d]">{event}</code></span>
              </label>
            ))}
          </fieldset>
          <div className="flex items-center justify-between gap-3 md:col-span-2">
            <FormResult state={workflowState} copy={copy} locale={locale} />
            <Button type="submit" disabled={workflowPending}>
              {workflowPending ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {copy.common.connect}
            </Button>
          </div>
          {workflows.length ? (
            <div className="divide-y divide-[#edf0f2] border-t border-[#edf0f2] md:col-span-2">
              {workflows.map((workflow) => (
                <div key={workflow.id} className="flex items-center justify-between gap-4 py-3 text-xs">
                  <span className="min-w-0">
                    <strong className="block text-[#243444]">{workflow.name}</strong>
                    <span className="block truncate text-[#71808b]">{workflow.url}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      name="workflowIntent"
                      value={`test:${workflow.id}`}
                      title={operatorCopy[locale].testDelivery}
                      aria-label={operatorCopy[locale].testDelivery}
                      disabled={workflowPending || !workflow.active}
                      className="focus-ring grid size-8 place-items-center rounded-md border border-[#dfe4e8] text-[#52606d] hover:bg-[#f4f6f7] disabled:opacity-50"
                    >
                      <Send className="size-4" />
                    </button>
                    <StatusToggle kind="workflow" id={workflow.id} active={workflow.active} copy={copy} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </form>

      <form action={supportAction} className="panel overflow-hidden">
        <header className="border-b border-[#edf0f2] px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[#243444]">
            <Headphones className="size-4 text-[var(--brand-accent)]" /> {copy.support.title}
          </h2>
        </header>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-[#52606d] md:col-span-2">
            <input name="enabled" type="checkbox" defaultChecked={support.enabled} className="focus-ring size-4 accent-[var(--brand-accent)]" /> {copy.common.active}
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.support.channel}</span>
            <select name="supportProvider" defaultValue={support.provider} className={inputClass}>
              <option value="link">{copy.support.link}</option>
              <option value="email">{copy.support.email}</option>
              <option value="intercom">Intercom</option>
            </select>
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.support.launcher}</span>
            <input name="launcherLabel" required defaultValue={support.launcherLabel} className={inputClass} />
          </label>
          <input name="supportUrl" type="url" placeholder="https://support.example.com" defaultValue={support.supportUrl ?? ""} className={inputClass} />
          <input name="supportEmail" type="email" placeholder="support@example.com" defaultValue={support.supportEmail ?? ""} className={inputClass} />
          <input name="intercomAppId" placeholder={copy.support.appId} defaultValue={support.intercomAppId ?? ""} className={inputClass} />
          <input name="identitySecret" type="password" placeholder={support.identitySecretConfigured ? copy.support.secretUnchanged : copy.support.secret} className={inputClass} autoComplete="new-password" />
          {support.identitySecretConfigured ? (
            <label className="flex items-center gap-2 text-xs text-[#52606d] md:col-span-2">
              <input name="clearIdentitySecret" type="checkbox" className="focus-ring size-4 accent-[#d85d50]" /> {copy.support.removeSecret}
            </label>
          ) : null}
          <div className="flex items-center justify-between gap-3 md:col-span-2">
            <FormResult state={supportState} copy={copy} locale={locale} />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="submit"
                name="intent"
                value="preflight"
                variant="secondary"
                disabled={supportPending || !support.enabled}
              >
                <ShieldCheck className="size-4" /> {operatorCopy[locale].preflight}
              </Button>
              <Button type="submit" disabled={supportPending}>
                {supportPending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                {copy.common.save}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

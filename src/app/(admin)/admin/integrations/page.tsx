import type { Metadata } from "next";
import { and, count, desc, eq } from "drizzle-orm";
import { IntegrationManager } from "@/components/admin/integration-manager";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db";
import {
  bundles,
  automationWorkflowConnections,
  commerceEntitlements,
  commerceInboundEvents,
  commerceOrders,
  commerceProductMappings,
  commerceProducts,
  commerceProviderConnections,
  commerceSubscriptions,
  webhooks,
} from "@/db/schema";
import { requireTeamPermission } from "@/lib/auth";
import { getSupportSettings } from "@/lib/support";
import { getIntegrationAdminCopy } from "@/lib/i18n/integration-admin";
import { resolveUserLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const actor = await requireTeamPermission("integrations.view");
  const locale = await resolveUserLocale(actor);
  return { title: getIntegrationAdminCopy(locale).page.metadataTitle };
}

export default async function IntegrationsPage() {
  const actor = await requireTeamPermission("integrations.view");
  const organizationId = actor.organizationId;
  const [
    connections,
    products,
    mappings,
    bundleRows,
    support,
    orderCount,
    subscriptionCount,
    entitlementCount,
    failedEventCount,
    workflows,
    locale,
  ] = await Promise.all([
    db.select({
      id: commerceProviderConnections.id,
      provider: commerceProviderConnections.provider,
      displayName: commerceProviderConnections.displayName,
      endpointKey: commerceProviderConnections.endpointKey,
      signatureMode: commerceProviderConnections.signatureMode,
      active: commerceProviderConnections.active,
      autoCreateMembers: commerceProviderConnections.autoCreateMembers,
    }).from(commerceProviderConnections)
      .where(eq(commerceProviderConnections.organizationId, organizationId))
      .orderBy(commerceProviderConnections.provider),
    db.select({
      id: commerceProducts.id,
      name: commerceProducts.name,
      sku: commerceProducts.sku,
      bundleId: commerceProducts.bundleId,
      bundleName: bundles.name,
      active: commerceProducts.active,
    }).from(commerceProducts).innerJoin(bundles, and(
      eq(bundles.id, commerceProducts.bundleId),
      eq(bundles.organizationId, organizationId),
    )).where(eq(commerceProducts.organizationId, organizationId))
      .orderBy(desc(commerceProducts.createdAt)),
    db.select({
      id: commerceProductMappings.id,
      connectionId: commerceProductMappings.connectionId,
      provider: commerceProviderConnections.provider,
      productName: commerceProducts.name,
      providerProductId: commerceProductMappings.providerProductId,
      providerVariantId: commerceProductMappings.providerVariantId,
      active: commerceProductMappings.active,
    }).from(commerceProductMappings)
      .innerJoin(commerceProviderConnections, and(
        eq(commerceProviderConnections.id, commerceProductMappings.connectionId),
        eq(commerceProviderConnections.organizationId, organizationId),
      ))
      .innerJoin(commerceProducts, and(
        eq(commerceProducts.id, commerceProductMappings.productId),
        eq(commerceProducts.organizationId, organizationId),
      ))
      .where(eq(commerceProductMappings.organizationId, organizationId))
      .orderBy(desc(commerceProductMappings.createdAt)),
    db.select({ id: bundles.id, name: bundles.name }).from(bundles)
      .where(and(eq(bundles.organizationId, organizationId), eq(bundles.active, true)))
      .orderBy(bundles.name),
    getSupportSettings(organizationId),
    db.select({ value: count() }).from(commerceOrders)
      .where(eq(commerceOrders.organizationId, organizationId)),
    db.select({ value: count() }).from(commerceSubscriptions)
      .where(eq(commerceSubscriptions.organizationId, organizationId)),
    db.select({ value: count() }).from(commerceEntitlements)
      .where(and(
        eq(commerceEntitlements.organizationId, organizationId),
        eq(commerceEntitlements.status, "active"),
      )),
    db.select({ value: count() }).from(commerceInboundEvents)
      .where(and(
        eq(commerceInboundEvents.organizationId, organizationId),
        eq(commerceInboundEvents.status, "failed"),
      )),
    db.select({
      id: automationWorkflowConnections.id,
      name: automationWorkflowConnections.name,
      url: webhooks.url,
      events: webhooks.events,
      active: webhooks.active,
    }).from(automationWorkflowConnections).innerJoin(webhooks, and(
      eq(webhooks.id, automationWorkflowConnections.webhookId),
      eq(webhooks.organizationId, organizationId),
    )).where(eq(automationWorkflowConnections.organizationId, organizationId))
      .orderBy(desc(automationWorkflowConnections.createdAt)),
    resolveUserLocale(actor),
  ]);
  const copy = getIntegrationAdminCopy(locale);
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        eyebrow={copy.page.eyebrow}
        title={copy.page.title}
        description={copy.page.description}
      />
      <IntegrationManager
        connections={connections}
        products={products}
        mappings={mappings}
        bundles={bundleRows}
        support={{
          enabled: support.enabled,
          provider: support.provider,
          launcherLabel: support.launcherLabel,
          supportUrl: support.supportUrl,
          supportEmail: support.supportEmail,
          intercomAppId: support.intercomAppId,
          identitySecretConfigured: Boolean(support.identitySecretEncrypted),
        }}
        stats={{
          orders: Number(orderCount[0]?.value ?? 0),
          subscriptions: Number(subscriptionCount[0]?.value ?? 0),
          activeEntitlements: Number(entitlementCount[0]?.value ?? 0),
          failedEvents: Number(failedEventCount[0]?.value ?? 0),
        }}
        workflows={workflows}
        locale={locale}
      />
    </div>
  );
}

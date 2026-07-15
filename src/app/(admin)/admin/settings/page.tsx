import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { CustomFieldManager } from "@/components/admin/custom-field-manager";
import { CustomDomainPanel } from "@/components/admin/custom-domain-panel";
import { DataStructureManager } from "@/components/admin/data-structure-manager";
import { MemberWelcomeSettingsForm } from "@/components/admin/member-welcome-settings-form";
import { MemberSidebarLinksManager } from "@/components/admin/member-sidebar-links-manager";
import { MfaPolicyPanel } from "@/components/admin/mfa-policy-panel";
import { NativeStartSettings } from "@/components/admin/native-start-settings";
import { OidcSettingsForm } from "@/components/admin/oidc-settings-form";
import { OrganizationContractPanel } from "@/components/admin/organization-contract-panel";
import { PlatformCustomCodeSettings } from "@/components/admin/platform-custom-code-settings";
import { SettingsForm } from "@/components/admin/settings-form";
import { SettingsSectionNav } from "@/components/admin/settings-section-nav";
import { TranscriptSearchSettingsForm } from "@/components/admin/transcript-search-settings-form";
import { OrganizationLocaleSettings } from "@/components/shared/locale-settings-panel";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db";
import {
  customFieldDefinitions,
  dataFormFields,
  dataForms,
  dataProfileDefinitions,
  dataProfileFields,
} from "@/db/schema";
import { requireOrganizationAdmin } from "@/lib/auth";
import {
  canonicalTenantAuthOrigin,
  getTenantBranding,
} from "@/lib/branding";
import { ensureDefaultDataProfileDefinition } from "@/lib/data-profiles";
import { getMemberWelcomeSettings } from "@/lib/member-welcome";
import { getOidcConfiguration } from "@/lib/oidc-configuration";
import { getTranscriptSearchSettings } from "@/lib/transcript-search-settings";
import { headers } from "next/headers";
import {
  getOrganizationMfaPolicyState,
  getOwnMfaState,
} from "@/lib/mfa/queries";
import { getOrganizationContractOverview } from "@/lib/organization-contracts";
import {
  getOrganizationDefaultLocale,
  resolveUserLocale,
} from "@/lib/i18n/server";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { listCustomDomainClaims } from "@/lib/custom-domains";
import { getNativeStartDestination } from "@/lib/mobile/start-destination";
import { listMemberSidebarLinks } from "@/lib/member-sidebar-links";
import { getSettingsAdminCopy } from "@/lib/i18n/settings-admin";
import { getPlatformCustomCodeConfiguration } from "@/lib/platform-custom-code-service";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireOrganizationAdmin();
  const locale = await resolveUserLocale(user);
  return { title: getSettingsAdminCopy(locale).page.metadataTitle };
}

export default async function SettingsPage() {
  const user = await requireOrganizationAdmin();
  await ensureDefaultDataProfileDefinition(user.organizationId);
  const [
    branding,
    welcomeSettings,
    oidcSettings,
    transcriptSearchSettings,
    fields,
    definitions,
    profileFieldRows,
    forms,
    formFieldRows,
    mfaPolicy,
    defaultLocale,
    locale,
    contractOverview,
    domainClaims,
    nativeStartDestination,
    sidebarLinks,
    customCode,
    ownMfaState,
  ] = await Promise.all([
    getTenantBranding(user.organizationId),
    getMemberWelcomeSettings(user.organizationId),
    getOidcConfiguration(user.organizationId),
    getTranscriptSearchSettings(user.organizationId),
    db
      .select({
        id: customFieldDefinitions.id,
        key: customFieldDefinitions.key,
        label: customFieldDefinitions.label,
        description: customFieldDefinitions.description,
        type: customFieldDefinitions.type,
        category: customFieldDefinitions.category,
        required: customFieldDefinitions.required,
        visibility: customFieldDefinitions.visibility,
        personalizationEnabled:
          customFieldDefinitions.personalizationEnabled,
        options: customFieldDefinitions.options,
        active: customFieldDefinitions.active,
        sortOrder: customFieldDefinitions.sortOrder,
      })
      .from(customFieldDefinitions)
      .where(eq(customFieldDefinitions.organizationId, user.organizationId))
      .orderBy(
        asc(customFieldDefinitions.category),
        asc(customFieldDefinitions.sortOrder),
        asc(customFieldDefinitions.label),
      ),
    db
      .select()
      .from(dataProfileDefinitions)
      .where(eq(dataProfileDefinitions.organizationId, user.organizationId))
      .orderBy(
        asc(dataProfileDefinitions.sortOrder),
        asc(dataProfileDefinitions.name),
      ),
    db
      .select({
        definitionId: dataProfileFields.profileDefinitionId,
        fieldId: dataProfileFields.fieldId,
      })
      .from(dataProfileFields)
      .where(eq(dataProfileFields.organizationId, user.organizationId))
      .orderBy(asc(dataProfileFields.sortOrder)),
    db
      .select()
      .from(dataForms)
      .where(eq(dataForms.organizationId, user.organizationId))
      .orderBy(asc(dataForms.name)),
    db
      .select({ formId: dataFormFields.formId, fieldId: dataFormFields.fieldId })
      .from(dataFormFields)
      .where(eq(dataFormFields.organizationId, user.organizationId))
      .orderBy(asc(dataFormFields.sortOrder)),
    getOrganizationMfaPolicyState(user.organizationId),
    getOrganizationDefaultLocale(user.organizationId),
    resolveUserLocale(user),
    getOrganizationContractOverview(user.organizationId),
    user.role === "owner"
      ? listCustomDomainClaims(user.organizationId)
      : Promise.resolve([]),
    getNativeStartDestination(user.organizationId),
    listMemberSidebarLinks(user.organizationId, { includeInactive: true }),
    getPlatformCustomCodeConfiguration(user.organizationId),
    getOwnMfaState(user),
  ]);
  const copy = getMainPageDictionary(locale).admin.headers.settings;
  const requestHeaders = await headers();
  const developmentHost = requestHeaders.get("host");
  const callbackOrigin = canonicalTenantAuthOrigin(
    branding,
    developmentHost ? `http://${developmentHost}` : null,
  );
  const oidcCallbackUrl = new URL(
    "/api/v1/auth/oidc/callback",
    callbackOrigin,
  ).toString();
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        {...copy}
      />
      <SettingsSectionNav locale={locale} />
      <MfaPolicyPanel
        policy={mfaPolicy}
        canManage={user.role === "owner"}
        passwordRequired={oidcSettings.passwordLoginEnabled}
        locale={locale}
      />
      <OrganizationLocaleSettings defaultLocale={defaultLocale} />
      <NativeStartSettings destination={nativeStartDestination} locale={locale} />
      <MemberSidebarLinksManager links={sidebarLinks} locale={locale} />
      <OrganizationContractPanel overview={contractOverview} locale={locale} />
      {user.role === "owner" ? (
        <CustomDomainPanel
          locale={locale}
          claims={domainClaims.map((claim) => ({
            ...claim,
            challengeExpiresAt: claim.challengeExpiresAt.toISOString(),
            lastCheckedAt: claim.lastCheckedAt?.toISOString() ?? null,
            verifiedAt: claim.verifiedAt?.toISOString() ?? null,
            revokedAt: claim.revokedAt?.toISOString() ?? null,
            createdAt: claim.createdAt.toISOString(),
            updatedAt: claim.updatedAt.toISOString(),
          }))}
        />
      ) : null}
      <div id="design" className="scroll-mt-24">
        <SettingsForm defaults={branding} locale={locale} />
      </div>
      <PlatformCustomCodeSettings
        configuration={customCode}
        locale={locale}
        canManage={user.role === "owner"}
        sandboxNonce={requestHeaders.get("x-nonce")}
      />
      <OidcSettingsForm
        defaults={oidcSettings}
        callbackUrl={oidcCallbackUrl}
        canManage={user.role === "owner"}
        mfaStepUpRequired={ownMfaState?.status === "enabled"}
        locale={locale}
      />
      <MemberWelcomeSettingsForm defaults={welcomeSettings} locale={locale} />
      <TranscriptSearchSettingsForm defaults={transcriptSearchSettings} locale={locale} />
      <CustomFieldManager fields={fields} locale={locale} />
      <DataStructureManager
        fields={fields.map((field) => ({
          id: field.id,
          label: field.label,
          category: field.category,
          visibility: field.visibility,
          active: field.active,
        }))}
        definitions={definitions.map((definition) => ({
          ...definition,
          fieldIds: profileFieldRows
            .filter((row) => row.definitionId === definition.id)
            .map((row) => row.fieldId),
        }))}
        forms={forms.map((form) => ({
          ...form,
          fieldIds: formFieldRows
            .filter((row) => row.formId === form.id)
            .map((row) => row.fieldId),
        }))}
        locale={locale}
      />
    </div>
  );
}

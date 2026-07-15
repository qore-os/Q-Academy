import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { EmailCenterTabs } from "@/components/admin/email-center-tabs";
import { EmailTemplateEditor } from "@/components/admin/email-template-editor";
import { PageHeader } from "@/components/ui/page-header";
import { requireOrganizationAdmin } from "@/lib/auth";
import { getEmailTemplateSettings } from "@/lib/email-center";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import {
  SUPPORTED_LOCALES,
  type AppLocale,
} from "@/lib/i18n/model";
import {
  getOrganizationDefaultLocale,
  resolveUserLocale,
} from "@/lib/i18n/server";
import { listMemberPropertyVariableCatalog } from "@/lib/member-properties";
import { getEmailSuppressionCopy } from "@/lib/email-suppression-copy";

export async function generateMetadata(): Promise<Metadata> {
  const actor = await requireOrganizationAdmin();
  const locale = await resolveUserLocale(actor);
  return {
    title: getCoreDictionary(locale).experience.emailCenter.tabs.templates,
  };
}

export default async function EmailTemplatesPage() {
  const actor = await requireOrganizationAdmin();
  const [defaultLocale, locale, localizedSettings, propertyVariables] = await Promise.all([
    getOrganizationDefaultLocale(actor.organizationId),
    resolveUserLocale(actor),
    Promise.all(
      SUPPORTED_LOCALES.map((locale) =>
        getEmailTemplateSettings(actor.organizationId, locale),
      ),
    ),
    listMemberPropertyVariableCatalog(actor.organizationId),
  ]);
  const settingsByLocale = Object.fromEntries(
    SUPPORTED_LOCALES.map((locale, index) => [
      locale,
      localizedSettings[index]!,
    ]),
  ) as Record<AppLocale, (typeof localizedSettings)[number]>;
  const copy = getCoreDictionary(locale).experience.emailCenter;
  const editorCopy = Object.fromEntries(
    Object.entries(copy).filter(([key]) => key !== "entries"),
  ) as Omit<typeof copy, "entries">;
  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
      />
      <EmailCenterTabs
        active="templates"
        copy={copy}
        suppressionLabel={getEmailSuppressionCopy(locale).tab}
      />
      <EmailTemplateEditor
        initialSettingsByLocale={Object.fromEntries(
          SUPPORTED_LOCALES.map((locale) => [
            locale,
            {
              version: settingsByLocale[locale].version,
              templates: settingsByLocale[locale].templates,
            },
          ]),
        ) as Record<AppLocale, { version: 1; templates: (typeof settingsByLocale)[AppLocale]["templates"] }>}
        initialTestRequestId={randomUUID()}
        recipientEmail={actor.email}
        updatedAtByLocale={Object.fromEntries(
          SUPPORTED_LOCALES.map((locale) => [
            locale,
            settingsByLocale[locale].updatedAt?.toISOString() ?? null,
          ]),
        ) as Record<AppLocale, string | null>}
        defaultLocale={defaultLocale}
        copy={editorCopy}
        memberPropertyVariables={propertyVariables.map((variable) => ({
          token: variable.emailToken,
          label: variable.label,
        }))}
      />
    </div>
  );
}

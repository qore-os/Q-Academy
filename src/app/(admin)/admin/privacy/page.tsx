import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { PrivacyRequestManager } from "@/components/admin/privacy-request-manager";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import { listPrivacyRequests } from "@/lib/privacy/request-service";
import { getPrivacyAdminCopy } from "@/lib/i18n/privacy-admin";
import { resolveUserLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const owner = await requireOwner();
  const locale = await resolveUserLocale(owner);
  return { title: getPrivacyAdminCopy(locale).page.metadataTitle };
}

export default async function PrivacyPage() {
  const owner = await requireOwner();
  const [requestRows, members, locale] = await Promise.all([
    listPrivacyRequests(owner.organizationId),
    db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        status: users.status,
      })
      .from(users)
      .where(eq(users.organizationId, owner.organizationId))
      .orderBy(asc(users.lastName), asc(users.firstName), asc(users.email)),
    resolveUserLocale(owner),
  ]);
  const copy = getPrivacyAdminCopy(locale);

  const requests = requestRows.map(({ request, subject }) => ({
    id: request.id,
    clientRequestId: request.clientRequestId,
    type: request.type,
    status: request.status,
    statusReason: request.statusReason,
    dueAt: request.dueAt.toISOString(),
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    subject: subject
      ? {
          id: subject.id,
          email: subject.email,
          firstName: subject.firstName,
          lastName: subject.lastName,
        }
      : null,
  }));

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <PageHeader
        eyebrow={copy.page.eyebrow}
        title={copy.page.title}
        description={copy.page.description}
      />
      <PrivacyRequestManager
        requests={requests}
        members={members}
        referenceTime={new Date().toISOString()}
        locale={locale}
      />
    </div>
  );
}

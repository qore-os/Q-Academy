import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import {
  ArrowUpRight,
  Bot,
  CalendarDays,
  ClipboardList,
  Code2,
  Compass,
  ExternalLink,
  MessageCircleQuestion,
  PanelsTopLeft,
  Sparkles,
  Target,
  Trophy,
  UserRound,
} from "lucide-react";
import type { HubLayout } from "@/db/schema";
import { PageHeader } from "@/components/ui/page-header";
import { EmbeddedDataForm } from "@/components/academy/embedded-data-form";
import { EmbeddedAiAgent } from "@/components/academy/embedded-ai-agent";
import { requireUser } from "@/lib/auth";
import { listAccessiblePublishedAiAgents } from "@/lib/ai/agent-studio";
import { getMemberCourses, getMemberHubs } from "@/lib/data";
import { hubLayoutAiAgentIds } from "@/lib/hub-layout";
import { hubCustomCodeDocument } from "@/lib/hub-custom-code";
import { safeHubEmbedUrl } from "@/lib/hub-embed-policy";
import { resolveHubLayoutVariables } from "@/lib/hub-variables";
import { resolveMemberPropertyVariables } from "@/lib/member-properties";
import { cn } from "@/lib/utils";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import { intlLocale } from "@/lib/i18n/model";
import { getAiMemberCopy } from "@/lib/i18n/ai-member";
import { resolveUserLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireUser();
  const locale = await resolveUserLocale(user);
  return {
    title: getCoreDictionary(locale).experience.hub.defaultTitle,
  };
}

const iconByType = {
  link: ExternalLink,
  text: Target,
  contact: UserRound,
  stat: Trophy,
  event: CalendarDays,
  data_form: ClipboardList,
  ai_agent: Bot,
  embed: PanelsTopLeft,
  code: Code2,
} as const;

function widgetDestination(value?: string) {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) {
    return { href: value, external: false };
  }
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { href: url.toString(), external: true };
    }
  } catch {
    return null;
  }
  return null;
}

function widgetAccent(widget: HubLayout[number]["columns"][number]) {
  return widget.color?.match(/^#[0-9a-fA-F]{6}$/) ? widget.color : "#2bb7a9";
}

export default async function HubPage({
  searchParams,
}: {
  searchParams: Promise<{ hub?: string }>;
}) {
  const user = await requireUser();
  const [
    { hub: selectedHubSlug },
    hubs,
    courses,
    locale,
    propertyVariables,
    requestHeaders,
  ] = await Promise.all([
    searchParams,
    getMemberHubs(user.id, user.organizationId),
    getMemberCourses(user.id, user.organizationId),
    resolveUserLocale(user),
    resolveMemberPropertyVariables({
      organizationId: user.organizationId,
      userId: user.id,
      locale: user.preferredLocale ?? "de",
    }),
    headers(),
  ]);
  const sandboxNonce = requestHeaders.get("x-nonce");
  const pageCopy = getCoreDictionary(locale).experience.hub;
  const aiCopy = getAiMemberCopy(locale);
  const percentFormat = new Intl.NumberFormat(intlLocale(locale), {
    style: "percent",
    maximumFractionDigits: 0,
  });
  const hub =
    hubs.find((item) => item.slug === selectedHubSlug) ??
    hubs.find((item) => item.slug === "lern-dashboard") ??
    hubs[0];
  const accessibleCourses = courses.filter(
    (course) => course.access.accessible,
  );
  const focusCourse =
    accessibleCourses.find((course) => course.status === "in_progress") ??
    accessibleCourses.find((course) => course.status === "not_started") ??
    accessibleCourses[0];
  if (!hub) {
    return (
      <div className="mx-auto max-w-[1300px] space-y-6">
        <PageHeader
          eyebrow={pageCopy.eyebrow}
          title={pageCopy.defaultTitle}
          description={pageCopy.defaultDescription}
        />
        <div className="panel grid min-h-64 place-items-center p-8 text-center">
          <div>
            <Compass className="mx-auto size-8 text-[#9aa4ad]" />
            <h2 className="mt-3 text-base font-bold text-[#354555]">
              {pageCopy.emptyTitle}
            </h2>
            <p className="mt-1 text-xs text-[#71808b]">
              {pageCopy.emptyDescription}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const resolvedLayout = resolveHubLayoutVariables(hub.layout, {
    member: { firstName: user.firstName, lastName: user.lastName },
    course: focusCourse
      ? { title: focusCourse.title, progress: focusCourse.progress }
      : null,
    properties: propertyVariables.text,
  });

  const embeddedAgentIds = new Set(hubLayoutAiAgentIds(hub.layout));
  const accessibleAgentIds = embeddedAgentIds.size
    ? new Set(
        (
          await listAccessiblePublishedAiAgents({
            organizationId: user.organizationId,
            userId: user.id,
          })
        )
          .filter((agent) => embeddedAgentIds.has(agent.agentId))
          .map((agent) => agent.agentId),
      )
    : new Set<string>();

  return (
    <div className="mx-auto max-w-[1300px] space-y-6">
      <PageHeader
        eyebrow={pageCopy.eyebrow}
        title={hub.title}
        description={
          hub.description ?? pageCopy.defaultDescription
        }
      />

      {hubs.length > 1 ? (
        <nav
          className="flex gap-1 overflow-x-auto border-b border-[#dfe4e8]"
          aria-label={pageCopy.availableHubs}
        >
          {hubs.map((item) => {
            const active = item.id === hub.id;
            return (
              <Link
                key={item.id}
                href={`/academy/hub?hub=${encodeURIComponent(item.slug)}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring h-10 shrink-0 border-b-2 px-4 py-3 text-xs font-semibold",
                  active
                    ? "border-[#2bb7a9] text-[#17324d]"
                    : "border-transparent text-[#71808b] hover:text-[#354555]",
                )}
              >
                {item.title}
              </Link>
            );
          })}
        </nav>
      ) : null}

      <div className="space-y-4">
        {resolvedLayout.map((row, rowIndex) => (
          <div key={row.id} className="space-y-3">
            {row.category &&
            row.category !== resolvedLayout[rowIndex - 1]?.category ? (
              <h2 className="text-sm font-bold text-[#354555]">
                {row.category}
              </h2>
            ) : null}
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {row.columns.map((widget, index) => {
              const Icon = iconByType[widget.type];
              const destination = widgetDestination(widget.href);
              const color = widgetAccent(widget);
              if (widget.type === "ai_agent") {
                return (
                  <div
                    key={`${row.id}:${index}:${widget.title}`}
                    className="min-w-0 md:col-span-2 xl:col-span-3"
                  >
                    {accessibleAgentIds.has(widget.agentId) ? (
                      <EmbeddedAiAgent
                        locale={locale}
                        agentId={widget.agentId}
                        canInteract={true}
                      />
                    ) : (
                      <section
                        className="flex min-h-20 items-center gap-3 rounded-md border border-[#dfe4e8] bg-[#f7f9fa] p-4 text-sm text-[#66727f]"
                        role="status"
                      >
                        <Bot aria-hidden="true" className="size-4 shrink-0" />
                        {aiCopy.embedded.unavailable}
                      </section>
                    )}
                  </div>
                );
              }
              if (widget.type === "data_form" && widget.formId) {
                return (
                  <article
                    key={`${row.id}:${index}:${widget.title}`}
                    className="panel p-5 md:col-span-2 xl:col-span-3"
                  >
                    <EmbeddedDataForm
                      formId={widget.formId}
                      sourceType="hub"
                      sourceId={hub.id}
                      locale={locale}
                    />
                  </article>
                );
              }
              if (widget.type === "embed") {
                const embedUrl = safeHubEmbedUrl(widget.href);
                if (!embedUrl) return null;
                return (
                  <article
                    key={`${row.id}:${index}:${widget.title}`}
                    className="panel overflow-hidden md:col-span-2 xl:col-span-3"
                  >
                    <header className="border-b border-[#e8ebee] px-5 py-4">
                      <h2 className="text-sm font-bold text-[#243444]">
                        {widget.title}
                      </h2>
                      {widget.description ? (
                        <p className="mt-1 text-xs leading-5 text-[#6c7882]">
                          {widget.description}
                        </p>
                      ) : null}
                    </header>
                    <iframe
                      src={embedUrl}
                      title={widget.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      sandbox="allow-scripts allow-popups allow-presentation"
                      allow="fullscreen; picture-in-picture"
                      className="aspect-video w-full border-0 bg-black"
                    />
                  </article>
                );
              }
              if (widget.type === "code") {
                const sandboxDocument = hubCustomCodeDocument(
                  widget.description,
                  sandboxNonce,
                );
                if (!sandboxDocument) return null;
                return (
                  <article
                    key={`${row.id}:${index}:${widget.title}`}
                    className="panel min-w-0 overflow-hidden md:col-span-2 xl:col-span-3"
                  >
                    <h2 className="border-b border-[#e8ebee] px-5 py-4 text-sm font-bold text-[#243444]">
                      {widget.title}
                    </h2>
                    <iframe
                      srcDoc={sandboxDocument}
                      title={widget.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      sandbox="allow-scripts"
                      allow=""
                      data-hub-code-sandbox="true"
                      className="h-80 w-full border-0 bg-white"
                    />
                  </article>
                );
              }
              const content = (
                <>
                  <div className="flex items-start justify-between">
                    <span
                      className="grid size-11 place-items-center rounded-md"
                      style={{ color, backgroundColor: `${color}18` }}
                    >
                      <Icon className="size-5" />
                    </span>
                    {destination ? (
                      <ArrowUpRight className="size-4 text-[#89949d] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    ) : null}
                  </div>
                  <h2 className="mt-5 text-base font-bold text-[#243444]">
                    {widget.title}
                  </h2>
                  <p className="mt-2 min-h-10 text-xs leading-5 text-[#6c7882]">
                    {widget.description}
                  </p>
                </>
              );

              if (destination?.external) {
                return (
                  <a
                    href={destination.href}
                    target="_blank"
                    rel="noreferrer"
                    key={`${row.id}:${index}:${widget.title}`}
                    className="focus-ring panel group p-5"
                  >
                    {content}
                  </a>
                );
              }
              if (destination) {
                return (
                  <Link
                    href={destination.href}
                    key={`${row.id}:${index}:${widget.title}`}
                    className="focus-ring panel group p-5"
                  >
                    {content}
                  </Link>
                );
              }
              return (
                <article
                  key={`${row.id}:${index}:${widget.title}`}
                  className="panel p-5"
                >
                  {content}
                </article>
              );
            })}
            </section>
          </div>
        ))}
        {!resolvedLayout.length ? (
          <div className="panel grid min-h-48 place-items-center p-8 text-center">
            <div>
              <Compass className="mx-auto size-7 text-[#9aa4ad]" />
              <p className="mt-3 text-sm font-semibold text-[#354555]">
                {pageCopy.noContent}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="overflow-hidden rounded-md bg-[#17324d] p-6 text-white md:p-8">
          <Sparkles className="size-6 text-[#63d5ca]" />
          <h2 className="mt-4 text-2xl font-bold">{pageCopy.nextStep}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/70">
            {focusCourse
              ? focusCourse.status === "completed"
                ? pageCopy.courseCompleted(focusCourse.title)
                : pageCopy.continueCourse(focusCourse.title)
              : pageCopy.noAssignedCourse}
          </p>
          {focusCourse ? (
            <>
              <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/12">
                <div
                  className="h-full rounded-full bg-[#2bb7a9]"
                  style={{ width: `${focusCourse.progress}%` }}
                />
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-white/55">
                <span>{pageCopy.courseProgress}</span>
                <span>{percentFormat.format(focusCourse.progress / 100)}</span>
              </div>
              <Link
                href={`/academy/courses/${focusCourse.slug}`}
                className="focus-ring mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-white px-3 text-xs font-bold text-[#17324d] hover:bg-[#eef2f4]"
              >
                {pageCopy.openCourse}
                <ArrowUpRight className="size-3.5" />
              </Link>
            </>
          ) : null}
        </div>
        <aside className="panel p-5">
          <MessageCircleQuestion className="size-5 text-[#4f7cac]" />
          <h2 className="mt-4 text-base font-bold text-[#243444]">Q-Coach</h2>
          <p className="mt-2 text-xs leading-5 text-[#6c7882]">
            {pageCopy.coachDescription}
          </p>
          <Link
            href="/academy/ai"
            className="focus-ring mt-5 flex h-10 items-center justify-center gap-2 rounded-md border border-[#dfe4e8] text-xs font-semibold text-[#52606d] hover:bg-[#f3f5f6]"
          >
            <Sparkles className="size-4" />
            {pageCopy.openChat}
          </Link>
        </aside>
      </section>
    </div>
  );
}

import { ArrowRight, ArrowUpRight, ImageIcon, Info } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import type { CourseWidgetSnapshot } from "@/db/schema";
import { safeCourseImageSource } from "@/lib/content-blocks/interactive-documents";
import {
  isExternalRichTextHref,
  safeRichTextHref,
} from "@/lib/rich-text/document";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import type { AppLocale } from "@/lib/i18n/model";

function linkProps(href: string) {
  return isExternalRichTextHref(href)
    ? {
        target: "_blank" as const,
        rel: "noopener noreferrer nofollow",
        referrerPolicy: "no-referrer" as const,
      }
    : {};
}

function AuthorWidget({
  widget,
  courseAuthor,
}: {
  widget: CourseWidgetSnapshot;
  courseAuthor: string;
}) {
  if (!widget.author) return null;
  const role = widget.authorRole || widget.author.jobTitle || courseAuthor;
  const description = widget.authorDescription || widget.author.bio;
  return (
    <article
      className="rounded-md border border-[#dfe5e8] bg-white p-5 sm:p-6"
      data-course-widget="author"
    >
      <div className="flex items-start gap-4">
        <Avatar
          firstName={widget.author.firstName}
          lastName={widget.author.lastName}
          src={widget.author.avatarUrl}
          size="xl"
        />
        <div className="min-w-0">
          <p className="text-base font-bold text-[#243444]">
            {widget.author.firstName} {widget.author.lastName}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-[#2b9188]">{role}</p>
          {description ? (
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-[#66727f]">
              {description}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function InfoWidget({
  widget,
  learnMore,
}: {
  widget: CourseWidgetSnapshot;
  learnMore: string;
}) {
  if (!widget.title || !widget.text) return null;
  const href = safeRichTextHref(widget.linkUrl);
  const Icon = href && isExternalRichTextHref(href) ? ArrowUpRight : ArrowRight;
  return (
    <article
      className="rounded-md border border-[#d8e4e8] bg-[#f6fafb] p-5 sm:p-6"
      data-course-widget="info"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-white text-[#276b88] shadow-sm">
          <Info className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-[#243444]">{widget.title}</h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#66727f]">
            {widget.text}
          </p>
          {href ? (
            <a
              href={href}
              {...linkProps(href)}
              className="focus-ring mt-4 inline-flex min-h-9 items-center gap-2 rounded-sm text-xs font-bold text-[#276b88] underline decoration-[#9bc2cf] underline-offset-4 hover:text-[#174d67]"
            >
              {learnMore}
              <Icon className="size-3.5" />
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ImageLinkWidget({ widget }: { widget: CourseWidgetSnapshot }) {
  const source = safeCourseImageSource(widget.imageUrl);
  const href = safeRichTextHref(widget.linkUrl);
  if (!source || !href || !widget.altText) {
    return null;
  }
  return (
    <a
      href={href}
      {...linkProps(href)}
      className="focus-ring group relative block aspect-[16/8] overflow-hidden rounded-md border border-[#dfe5e8] bg-[#eef2f4]"
      data-course-widget="image_link"
      aria-label={widget.altText}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={source}
        alt={widget.altText}
        loading="lazy"
        decoding="async"
        className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
      />
      <span className="absolute bottom-3 right-3 grid size-9 place-items-center rounded-md bg-white/95 text-[#243444] shadow-md">
        <ArrowUpRight className="size-4" />
      </span>
    </a>
  );
}

export function CourseOverviewWidgets({
  widgets,
  locale,
}: {
  widgets: CourseWidgetSnapshot[];
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).academy.courseDetail;
  if (!widgets.length) return null;
  const ordered = [...widgets].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
  );
  return (
    <section aria-label={copy.courseInformation}>
      <div className="mb-3 flex items-center gap-2 text-xs font-bold text-[#52606d]">
        <ImageIcon className="size-4 text-[#2b9188]" />
        {copy.aboutCourse}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {ordered.map((widget) => {
          if (widget.type === "author") {
            return (
              <AuthorWidget
                key={widget.id}
                widget={widget}
                courseAuthor={copy.courseAuthor}
              />
            );
          }
          if (widget.type === "info") {
            return (
              <InfoWidget
                key={widget.id}
                widget={widget}
                learnMore={copy.learnMore}
              />
            );
          }
          return <ImageLinkWidget key={widget.id} widget={widget} />;
        })}
      </div>
    </section>
  );
}

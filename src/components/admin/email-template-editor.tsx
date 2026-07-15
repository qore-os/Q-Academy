"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Braces,
  Check,
  CodeXml,
  LoaderCircle,
  Languages,
  MailCheck,
  Save,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CoreDictionary } from "@/lib/i18n/dictionaries";
import {
  queueEmailTemplateTestAction,
  updateEmailTemplatesAction,
  type EmailCenterActionState,
} from "@/lib/email-center-actions";
import {
  authenticationLinkTemplateVariables,
  EMAIL_TEMPLATE_SAMPLE_COPY,
  EMAIL_TEMPLATE_EVENTS,
  EMAIL_TEMPLATE_VARIABLES,
  emailTemplateSettingsSchema,
  renderEmailTemplate,
  type EmailTemplateEvent,
  type EmailTemplateSettings,
} from "@/lib/email-center-model";
import { cn, PLATFORM_TIME_ZONE } from "@/lib/utils";
import {
  intlLocale,
  LOCALE_OPTIONS,
  type AppLocale,
} from "@/lib/i18n/model";

const initialActionState: EmailCenterActionState = { ok: null, message: "" };

type EmailTemplateEditorCopy = Omit<
  CoreDictionary["experience"]["emailCenter"],
  "entries"
>;

const templateEventCopyKeys: Record<
  EmailTemplateEvent,
  | "feedbackReply"
  | "lessonAvailable"
  | "courseModulesReleased"
  | "invitationCreated"
  | "passwordReset"
> = {
  "feedback.reply": "feedbackReply",
  "lesson.available": "lessonAvailable",
  "course.modules.released": "courseModulesReleased",
  "invitation.created": "invitationCreated",
  "password.reset": "passwordReset",
};

const courseReleaseLabels: Record<AppLocale, string> = {
  de: "Kursmodule freigegeben",
  en: "Course modules released",
  it: "Moduli del corso pubblicati",
  es: "Modulos del curso publicados",
  fr: "Modules du cours publies",
};

const samplePropertyValues: Record<AppLocale, string> = {
  de: "Beispielwert",
  en: "Sample value",
  it: "Valore di esempio",
  es: "Valor de ejemplo",
  fr: "Valeur d'exemple",
};

function sampleVariables(locale: AppLocale) {
  const sample = EMAIL_TEMPLATE_SAMPLE_COPY[locale];
  return {
    "feedback.reply": {
      defaultSubject: sample.feedbackSubject,
      defaultMessage: sample.feedbackMessage,
      firstName: "Mara",
      platformName: "Q Academy",
    },
    "lesson.available": {
      defaultSubject: sample.lessonSubject,
      defaultMessage: sample.lessonMessage,
      firstName: "Mara",
      platformName: "Q Academy",
      lessonTitle: sample.lessonTitle,
      courseTitle: sample.courseTitle,
      lessonUrl: "https://academy.example/academy/courses/sample",
    },
    "course.modules.released": {
      firstName: "Mara",
      platformName: "Q Academy",
      courseTitle: sample.courseTitle,
      moduleList: sample.moduleList,
      courseUrl: "https://academy.example/academy/courses/sample",
    },
    "invitation.created": {
      ...authenticationLinkTemplateVariables("invitation.created", {
        firstName: "Mara",
        link: "https://academy.example/invitations/sample",
        locale,
      }),
      platformName: "Q Academy",
    },
    "password.reset": {
      ...authenticationLinkTemplateVariables("password.reset", {
        firstName: "Mara",
        link: "https://academy.example/password/reset?token=sample",
        locale,
      }),
      platformName: "Q Academy",
    },
  } satisfies Record<EmailTemplateEvent, Record<string, string>>;
}

function cloneSettings(settings: EmailTemplateSettings): EmailTemplateSettings {
  return {
    version: 1,
    templates: {
      "feedback.reply": { ...settings.templates["feedback.reply"] },
      "lesson.available": { ...settings.templates["lesson.available"] },
      "course.modules.released": {
        ...settings.templates["course.modules.released"],
      },
      "invitation.created": { ...settings.templates["invitation.created"] },
      "password.reset": { ...settings.templates["password.reset"] },
    },
  };
}

function ActionMessage({ state }: { state: EmailCenterActionState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={cn(
        "text-xs leading-5",
        state.ok ? "text-[#167e74]" : "text-[#b8493e]",
      )}
    >
      {state.message}
    </p>
  );
}

export function EmailTemplateEditor({
  initialSettingsByLocale,
  initialTestRequestId,
  recipientEmail,
  updatedAtByLocale,
  defaultLocale,
  copy,
  memberPropertyVariables,
}: {
  initialSettingsByLocale: Record<AppLocale, EmailTemplateSettings>;
  initialTestRequestId: string;
  recipientEmail: string;
  updatedAtByLocale: Record<AppLocale, string | null>;
  defaultLocale: AppLocale;
  copy: EmailTemplateEditorCopy;
  memberPropertyVariables: Array<{ token: string; label: string }>;
}) {
  const [settingsByLocale, setSettingsByLocale] = useState(() =>
    Object.fromEntries(
      LOCALE_OPTIONS.map(({ value }) => [
        value,
        cloneSettings(initialSettingsByLocale[value]),
      ]),
    ) as Record<AppLocale, EmailTemplateSettings>,
  );
  const [savedSettingsByLocale, setSavedSettingsByLocale] = useState(() =>
    Object.fromEntries(
      LOCALE_OPTIONS.map(({ value }) => [
        value,
        cloneSettings(initialSettingsByLocale[value]),
      ]),
    ) as Record<AppLocale, EmailTemplateSettings>,
  );
  const [locale, setLocale] = useState<AppLocale>(defaultLocale);
  const [event, setEvent] = useState<EmailTemplateEvent>("feedback.reply");
  const [previewMode, setPreviewMode] = useState<"text" | "html">("text");
  const [activeField, setActiveField] = useState<"subject" | "body">("body");
  const [testRequestId, setTestRequestId] = useState(initialTestRequestId);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const submittedSettings = useRef<{
    locale: AppLocale;
    settings: EmailTemplateSettings;
  } | null>(null);
  const handledTestDelivery = useRef<string | null>(null);
  const [saveState, saveAction, savePending] = useActionState(
    updateEmailTemplatesAction,
    initialActionState,
  );
  const [testState, testAction, testPending] = useActionState(
    queueEmailTemplateTestAction,
    initialActionState,
  );

  useEffect(() => {
    if (saveState.ok && submittedSettings.current) {
      const submitted = submittedSettings.current;
      const saved = cloneSettings(submitted.settings);
      setSettingsByLocale((current) => ({
        ...current,
        [submitted.locale]: saved,
      }));
      setSavedSettingsByLocale((current) => ({
        ...current,
        [submitted.locale]: saved,
      }));
      submittedSettings.current = null;
    }
  }, [saveState]);

  useEffect(() => {
    if (
      testState.ok &&
      testState.resourceId &&
      handledTestDelivery.current !== testState.resourceId
    ) {
      handledTestDelivery.current = testState.resourceId;
      setTestRequestId(crypto.randomUUID());
    }
  }, [testState]);

  const settings = settingsByLocale[locale];
  const dirty =
    JSON.stringify(settings) !== JSON.stringify(savedSettingsByLocale[locale]);
  const template = settings.templates[event];
  const eventPropertyVariables = useMemo(
    () =>
      event === "feedback.reply" || event === "lesson.available"
        ? memberPropertyVariables
        : [],
    [event, memberPropertyVariables],
  );
  const preview = useMemo(() => {
    try {
      return {
        result: renderEmailTemplate({
          event,
          settings,
          variables: {
            ...sampleVariables(locale)[event],
            ...Object.fromEntries(
              eventPropertyVariables.map((variable) => [
                variable.token,
                samplePropertyValues[locale],
              ]),
            ),
          },
          additionalAllowedVariables: eventPropertyVariables.map(
            (variable) => variable.token,
          ),
        }),
        error: null,
      };
    } catch {
      return { result: null, error: copy.validationHint };
    }
  }, [
    copy.validationHint,
    event,
    eventPropertyVariables,
    locale,
    settings,
  ]);

  function updateField(field: "subject" | "body", value: string) {
    setSettingsByLocale((current) => ({
      ...current,
      [locale]: {
        ...current[locale],
        templates: {
          ...current[locale].templates,
          [event]: { ...current[locale].templates[event], [field]: value },
        },
      },
    }));
  }

  function insertVariable(variable: string) {
    const field = activeField;
    const element = field === "subject" ? subjectRef.current : bodyRef.current;
    const value = template[field];
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? start;
    const insertion = `{{${variable}}}`;
    updateField(field, `${value.slice(0, start)}${insertion}${value.slice(end)}`);
    requestAnimationFrame(() => {
      const nextElement = field === "subject" ? subjectRef.current : bodyRef.current;
      nextElement?.focus();
      nextElement?.setSelectionRange(start + insertion.length, start + insertion.length);
    });
  }

  return (
    <div className="space-y-5">
      <section
        className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
        aria-labelledby="template-language-title"
      >
        <div>
          <h2
            id="template-language-title"
            className="flex items-center gap-2 text-sm font-bold text-[#243444]"
          >
            <Languages className="size-4 text-[var(--brand-accent)]" />
            {copy.language}
          </h2>
          <p className="mt-1 text-[11px] text-[#71808b]">
            {copy.recipientHint}
          </p>
        </div>
        <div
          className="grid grid-cols-5 gap-1 rounded-md border border-[#dfe4e8] bg-[#f5f7f8] p-1"
          role="tablist"
          aria-label={copy.language}
        >
          {LOCALE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={locale === option.value}
              onClick={() => setLocale(option.value)}
              className={cn(
                "focus-ring h-8 rounded px-2 text-[11px] font-semibold",
                locale === option.value
                  ? "bg-white text-[#243444] shadow-sm"
                  : "text-[#71808b]",
              )}
              title={option.label}
            >
              {option.value.toUpperCase()}
            </button>
          ))}
        </div>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4e8eb]">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label={copy.tabs.templates}>
          {EMAIL_TEMPLATE_EVENTS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={event === item}
              onClick={() => setEvent(item)}
              className={cn(
                "focus-ring h-10 shrink-0 border-b-2 px-3 text-xs font-semibold",
                event === item
                  ? "border-[var(--brand-accent)] text-[var(--brand-primary)]"
                  : "border-transparent text-[#71808b] hover:text-[#354555]",
              )}
            >
              {copy.eventLabels[templateEventCopyKeys[item]] ??
                (item === "course.modules.released"
                  ? courseReleaseLabels[locale]
                  : item)}
            </button>
          ))}
        </div>
        <p className="pb-2 text-[11px] text-[#78848e]">
          {updatedAtByLocale[locale]
            ? `${copy.saved}: ${new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: PLATFORM_TIME_ZONE }).format(new Date(updatedAtByLocale[locale]!))}`
            : copy.defaultTemplate}
        </p>
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)]">
        <form
          action={saveAction}
          onSubmit={() => {
            const propertyTokens = memberPropertyVariables.map(
              (variable) => variable.token,
            );
            const parsed = emailTemplateSettingsSchema({
              "feedback.reply": propertyTokens,
              "lesson.available": propertyTokens,
            }).safeParse(settings);
            submittedSettings.current = parsed.success
              ? { locale, settings: cloneSettings(parsed.data) }
              : null;
          }}
          className="min-w-0 space-y-4 rounded-md border border-[#e1e5e8] bg-white p-4 sm:p-5"
        >
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="feedbackSubject" value={settings.templates["feedback.reply"].subject} />
          <input type="hidden" name="feedbackBody" value={settings.templates["feedback.reply"].body} />
          <input type="hidden" name="lessonSubject" value={settings.templates["lesson.available"].subject} />
          <input type="hidden" name="lessonBody" value={settings.templates["lesson.available"].body} />
          <input type="hidden" name="courseModulesReleasedSubject" value={settings.templates["course.modules.released"].subject} />
          <input type="hidden" name="courseModulesReleasedBody" value={settings.templates["course.modules.released"].body} />
          <input type="hidden" name="invitationSubject" value={settings.templates["invitation.created"].subject} />
          <input type="hidden" name="invitationBody" value={settings.templates["invitation.created"].body} />
          <input type="hidden" name="passwordResetSubject" value={settings.templates["password.reset"].subject} />
          <input type="hidden" name="passwordResetBody" value={settings.templates["password.reset"].body} />

          <label className="block text-xs font-semibold text-[#344454]">
            {copy.subject}
            <input
              ref={subjectRef}
              value={template.subject}
              onChange={(input) => updateField("subject", input.target.value)}
              onFocus={() => setActiveField("subject")}
              maxLength={500}
              disabled={savePending}
              className="focus-ring mt-1.5 h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm font-normal"
            />
          </label>
          <label className="block text-xs font-semibold text-[#344454]">
            {copy.message}
            <textarea
              ref={bodyRef}
              value={template.body}
              onChange={(input) => updateField("body", input.target.value)}
              onFocus={() => setActiveField("body")}
              maxLength={10_000}
              disabled={savePending}
              className="focus-ring mt-1.5 min-h-56 w-full resize-y rounded-md border border-[#dce1e5] p-3 text-sm font-normal leading-6"
            />
          </label>

          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-[#65727e]">
              <Braces className="size-3.5" /> {copy.variables}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                ...EMAIL_TEMPLATE_VARIABLES[event],
                ...eventPropertyVariables.map((variable) => variable.token),
              ].map((variable) => (
                <button
                  key={variable}
                  type="button"
                  onClick={() => insertVariable(variable)}
                  disabled={savePending}
                  className="focus-ring rounded border border-[#d9e1e5] bg-[#f7f9fa] px-2 py-1 font-mono text-[11px] text-[#425464] hover:bg-[#edf2f4] disabled:opacity-50"
                  title={
                    eventPropertyVariables.find(
                      (entry) => entry.token === variable,
                    )?.label
                  }
                >
                  {`{{${variable}}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f2] pt-4">
            <ActionMessage state={saveState} />
            <Button type="submit" disabled={savePending || !dirty} className="ml-auto">
              {savePending ? <LoaderCircle className="size-4 animate-spin" /> : dirty ? <Save className="size-4" /> : <Check className="size-4" />}
              {savePending ? `${copy.save}...` : dirty ? copy.save : copy.saved}
            </Button>
          </div>
        </form>

        <section className="min-w-0 overflow-hidden rounded-md border border-[#e1e5e8] bg-white">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8ecef] px-4 py-3">
            <h2 className="text-sm font-semibold text-[#243444]">
              {previewMode === "text" ? copy.previewText : copy.previewHtml}
            </h2>
            <div className="flex rounded-md border border-[#dfe4e8] bg-[#f5f7f8] p-0.5" aria-label={copy.tabs.templates}>
              <button
                type="button"
                onClick={() => setPreviewMode("text")}
                aria-pressed={previewMode === "text"}
                className={cn(
                  "focus-ring flex h-7 items-center gap-1.5 rounded px-2.5 text-[11px] font-semibold",
                  previewMode === "text" ? "bg-white text-[#243444] shadow-sm" : "text-[#71808b]",
                )}
              >
                <Type className="size-3.5" /> {copy.previewText}
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode("html")}
                aria-pressed={previewMode === "html"}
                className={cn(
                  "focus-ring flex h-7 items-center gap-1.5 rounded px-2.5 text-[11px] font-semibold",
                  previewMode === "html" ? "bg-white text-[#243444] shadow-sm" : "text-[#71808b]",
                )}
              >
                <CodeXml className="size-3.5" /> {copy.previewHtml}
              </button>
            </div>
          </header>
          <div className="min-h-80 p-4 sm:p-5">
            {preview.result ? (
              previewMode === "text" ? (
                <div>
                  <p className="border-b border-[#edf0f2] pb-3 text-sm font-semibold text-[#243444]">
                    {preview.result.subject}
                  </p>
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[#52606d]">
                    {preview.result.message}
                  </p>
                </div>
              ) : (
                <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded bg-[#f5f7f8] p-3 font-mono text-xs leading-5 text-[#425464]">
                  {preview.result.html}
                </pre>
              )
            ) : (
              <p className="text-sm text-[#b8493e]">
                {preview.error ?? copy.validationHint}
              </p>
            )}
          </div>
          <form action={testAction} className="border-t border-[#edf0f2] p-4">
            <input type="hidden" name="event" value={event} />
            <input type="hidden" name="requestId" value={testRequestId} />
            <input type="hidden" name="locale" value={locale} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase text-[#71808b]">
                  {copy.testRecipient}
                </p>
                <p className="truncate text-xs font-semibold text-[#344454]">{recipientEmail}</p>
                <ActionMessage state={testState} />
              </div>
              <Button
                type="submit"
                variant="secondary"
                disabled={testPending || dirty || !preview.result}
                title={dirty ? copy.dirtyHint : copy.sendTest}
              >
                {testPending ? <LoaderCircle className="size-4 animate-spin" /> : <MailCheck className="size-4" />}
                {testPending ? `${copy.sendTest}...` : copy.sendTest}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

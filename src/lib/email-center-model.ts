import { z } from "zod";
import {
  SUPPORTED_LOCALES,
  type AppLocale,
} from "@/lib/i18n/model";

export const EMAIL_AUTH_LINK_EVENTS = [
  "invitation.created",
  "password.reset",
] as const;
export type AuthenticationLinkEmailEvent =
  (typeof EMAIL_AUTH_LINK_EVENTS)[number];

export const EMAIL_TEMPLATE_EVENTS = [
  "feedback.reply",
  "lesson.available",
  "course.modules.released",
  ...EMAIL_AUTH_LINK_EVENTS,
] as const;
export type EmailTemplateEvent = (typeof EMAIL_TEMPLATE_EVENTS)[number];
export const PERSONALIZED_EMAIL_TEMPLATE_EVENTS = [
  "feedback.reply",
  "lesson.available",
] as const satisfies readonly EmailTemplateEvent[];

export const EVENT_LIFECYCLE_EMAIL_EVENTS = [
  "event.rescheduled",
  "event.cancelled",
] as const;
export type EventLifecycleEmailEvent =
  (typeof EVENT_LIFECYCLE_EMAIL_EVENTS)[number];

export const EMAIL_SAFE_RETRY_EVENTS = [
  "feedback.reply",
  "lesson.available",
  "course.modules.released",
  ...EVENT_LIFECYCLE_EMAIL_EVENTS,
  "email.template.test",
] as const;
export type EmailSafeRetryEvent = (typeof EMAIL_SAFE_RETRY_EVENTS)[number];

export const EMAIL_CENTER_EVENTS = [
  ...EMAIL_TEMPLATE_EVENTS,
  ...EVENT_LIFECYCLE_EMAIL_EVENTS,
  "email.template.test",
] as const;

export const EMAIL_DELIVERY_STATUSES = [
  "pending",
  "processing",
  "delivered",
  "failed",
  "retrying",
] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

export const emailDeliveryListQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    event: z.enum(EMAIL_CENTER_EVENTS).optional(),
    status: z.enum(EMAIL_DELIVERY_STATUSES).optional(),
    from: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional(),
    to: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && value.to < value.from) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Das Enddatum muss nach dem Startdatum liegen.",
      });
    }
  });

export const emailTemplateTestInputSchema = z
  .object({
    event: z.enum(EMAIL_TEMPLATE_EVENTS),
    requestId: z.string().uuid(),
    locale: z.enum(SUPPORTED_LOCALES).optional(),
  })
  .strict();

export const emailTemplateLocaleQuerySchema = z
  .object({
    locale: z.enum(SUPPORTED_LOCALES).optional(),
  })
  .strict();

export const emailDeliveryRetryInputSchema = z.object({}).strict();

export const EMAIL_EVENT_LABELS: Record<string, string> = {
  "feedback.reply": "Feedback-Antwort",
  "lesson.available": "Lektion verfuegbar",
  "course.modules.released": "Kursmodule freigegeben",
  "event.rescheduled": "Event neu geplant",
  "event.cancelled": "Event abgesagt",
  "email.template.test": "Vorlagen-Test",
  "invitation.created": "Einladung",
  "password.reset": "Passwort zuruecksetzen",
};

export const EMAIL_TEMPLATE_VARIABLES = {
  "feedback.reply": [
    "defaultSubject",
    "defaultMessage",
    "firstName",
    "platformName",
  ],
  "lesson.available": [
    "defaultSubject",
    "defaultMessage",
    "firstName",
    "platformName",
    "lessonTitle",
    "courseTitle",
    "lessonUrl",
  ],
  "course.modules.released": [
    "firstName",
    "platformName",
    "courseTitle",
    "moduleList",
    "courseUrl",
  ],
  "invitation.created": [
    "firstName",
    "platformName",
    "invitationUrl",
    "expiresIn",
  ],
  "password.reset": [
    "firstName",
    "platformName",
    "resetUrl",
    "expiresIn",
  ],
} as const satisfies Record<EmailTemplateEvent, readonly string[]>;

export type EmailTemplate = {
  subject: string;
  body: string;
};

export type EmailTemplateSettings = {
  version: 1;
  templates: Record<EmailTemplateEvent, EmailTemplate>;
};

export const EMAIL_TEMPLATE_SAMPLE_COPY: Record<
  AppLocale,
  {
    feedbackSubject: string;
    feedbackMessage: string;
    lessonSubject: string;
    lessonMessage: string;
    lessonTitle: string;
    courseTitle: string;
    moduleReleaseSubject: string;
    moduleReleaseMessage: string;
    moduleList: string;
  }
> = {
  de: {
    feedbackSubject: "Testantwort auf dein Feedback",
    feedbackMessage: "Dies ist eine sichere Testsendung deiner Feedback-Vorlage.",
    lessonSubject: "Beispiellektion ist jetzt verfuegbar",
    lessonMessage: "Die Beispiellektion im Beispielkurs kann jetzt geoeffnet werden.",
    lessonTitle: "Beispiellektion",
    courseTitle: "Beispielkurs",
    moduleReleaseSubject: "Neue Module im Beispielkurs",
    moduleReleaseMessage: "Im Beispielkurs wurden neue Module freigegeben.",
    moduleList: "- Grundlagen\n- Praxisuebung",
  },
  en: {
    feedbackSubject: "Test reply to your feedback",
    feedbackMessage: "This is a safe test delivery of your feedback template.",
    lessonSubject: "Sample lesson is now available",
    lessonMessage: "The sample lesson in the sample course can now be opened.",
    lessonTitle: "Sample lesson",
    courseTitle: "Sample course",
    moduleReleaseSubject: "New modules in the sample course",
    moduleReleaseMessage: "New modules have been released in the sample course.",
    moduleList: "- Foundations\n- Practical exercise",
  },
  it: {
    feedbackSubject: "Risposta di prova al tuo feedback",
    feedbackMessage: "Questo e un invio di prova sicuro del modello di feedback.",
    lessonSubject: "La lezione di esempio e ora disponibile",
    lessonMessage: "La lezione di esempio nel corso di esempio puo ora essere aperta.",
    lessonTitle: "Lezione di esempio",
    courseTitle: "Corso di esempio",
    moduleReleaseSubject: "Nuovi moduli nel corso di esempio",
    moduleReleaseMessage: "Sono stati pubblicati nuovi moduli nel corso di esempio.",
    moduleList: "- Fondamenti\n- Esercizio pratico",
  },
  es: {
    feedbackSubject: "Respuesta de prueba a tus comentarios",
    feedbackMessage: "Este es un envio de prueba seguro de tu plantilla de comentarios.",
    lessonSubject: "La leccion de ejemplo ya esta disponible",
    lessonMessage: "La leccion de ejemplo del curso de ejemplo ya se puede abrir.",
    lessonTitle: "Leccion de ejemplo",
    courseTitle: "Curso de ejemplo",
    moduleReleaseSubject: "Nuevos modulos en el curso de ejemplo",
    moduleReleaseMessage: "Se han publicado nuevos modulos en el curso de ejemplo.",
    moduleList: "- Fundamentos\n- Ejercicio practico",
  },
  fr: {
    feedbackSubject: "Reponse test a votre avis",
    feedbackMessage: "Ceci est un envoi de test securise de votre modele d'avis.",
    lessonSubject: "La lecon d'exemple est maintenant disponible",
    lessonMessage: "La lecon d'exemple du cours d'exemple peut maintenant etre ouverte.",
    lessonTitle: "Lecon d'exemple",
    courseTitle: "Cours d'exemple",
    moduleReleaseSubject: "Nouveaux modules dans le cours d'exemple",
    moduleReleaseMessage: "De nouveaux modules sont disponibles dans le cours d'exemple.",
    moduleList: "- Fondamentaux\n- Exercice pratique",
  },
};

export const DEFAULT_EMAIL_TEMPLATE_SETTINGS: EmailTemplateSettings = {
  version: 1,
  templates: {
    "feedback.reply": {
      subject: "{{defaultSubject}}",
      body: "{{defaultMessage}}",
    },
    "lesson.available": {
      subject: "{{defaultSubject}}",
      body: "{{defaultMessage}}",
    },
    "course.modules.released": {
      subject: "Neue Module in {{courseTitle}}",
      body: "Hallo {{firstName}},\n\nin {{courseTitle}} wurden neue Module freigegeben:\n{{moduleList}}\n\nKurs oeffnen: {{courseUrl}}",
    },
    "invitation.created": {
      subject: "Deine Einladung zu {{platformName}}",
      body: "Hallo {{firstName}},\n\ndu wurdest zu {{platformName}} eingeladen. Oeffne den folgenden Link, um deinen Zugang einzurichten:\n{{invitationUrl}}\n\nDer Link ist {{expiresIn}} gueltig.",
    },
    "password.reset": {
      subject: "Passwort fuer {{platformName}} zuruecksetzen",
      body: "Hallo {{firstName}},\n\nueber den folgenden Link kannst du dein Passwort fuer {{platformName}} zuruecksetzen:\n{{resetUrl}}\n\nDer Link ist {{expiresIn}} gueltig. Falls du die Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.",
    },
  },
};

function localizedEmailTemplateSettings(input: {
  moduleReleaseSubject: string;
  moduleReleaseBody: string;
  invitationSubject: string;
  invitationBody: string;
  passwordSubject: string;
  passwordBody: string;
}): EmailTemplateSettings {
  return {
    version: 1,
    templates: {
      "feedback.reply": {
        subject: "{{defaultSubject}}",
        body: "{{defaultMessage}}",
      },
      "lesson.available": {
        subject: "{{defaultSubject}}",
        body: "{{defaultMessage}}",
      },
      "course.modules.released": {
        subject: input.moduleReleaseSubject,
        body: input.moduleReleaseBody,
      },
      "invitation.created": {
        subject: input.invitationSubject,
        body: input.invitationBody,
      },
      "password.reset": {
        subject: input.passwordSubject,
        body: input.passwordBody,
      },
    },
  };
}

export const DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE: Record<
  AppLocale,
  EmailTemplateSettings
> = {
  de: DEFAULT_EMAIL_TEMPLATE_SETTINGS,
  en: localizedEmailTemplateSettings({
    moduleReleaseSubject: "New modules in {{courseTitle}}",
    moduleReleaseBody: "Hello {{firstName}},\n\nnew modules have been released in {{courseTitle}}:\n{{moduleList}}\n\nOpen course: {{courseUrl}}",
    invitationSubject: "Your invitation to {{platformName}}",
    invitationBody: "Hello {{firstName}},\n\nyou have been invited to {{platformName}}. Open the following link to set up your access:\n{{invitationUrl}}\n\nThe link is valid for {{expiresIn}}.",
    passwordSubject: "Reset your password for {{platformName}}",
    passwordBody: "Hello {{firstName}},\n\nuse the following link to reset your password for {{platformName}}:\n{{resetUrl}}\n\nThe link is valid for {{expiresIn}}. If you did not request this email, you can ignore it.",
  }),
  it: localizedEmailTemplateSettings({
    moduleReleaseSubject: "Nuovi moduli in {{courseTitle}}",
    moduleReleaseBody: "Ciao {{firstName}},\n\nsono stati pubblicati nuovi moduli in {{courseTitle}}:\n{{moduleList}}\n\nApri il corso: {{courseUrl}}",
    invitationSubject: "Il tuo invito a {{platformName}}",
    invitationBody: "Ciao {{firstName}},\n\nsei stato invitato su {{platformName}}. Apri il seguente link per configurare il tuo accesso:\n{{invitationUrl}}\n\nIl link è valido per {{expiresIn}}.",
    passwordSubject: "Reimposta la password per {{platformName}}",
    passwordBody: "Ciao {{firstName}},\n\nusa il seguente link per reimpostare la password per {{platformName}}:\n{{resetUrl}}\n\nIl link è valido per {{expiresIn}}. Se non hai richiesto questa email, puoi ignorarla.",
  }),
  es: localizedEmailTemplateSettings({
    moduleReleaseSubject: "Nuevos modulos en {{courseTitle}}",
    moduleReleaseBody: "Hola {{firstName}},\n\nse han publicado nuevos modulos en {{courseTitle}}:\n{{moduleList}}\n\nAbrir curso: {{courseUrl}}",
    invitationSubject: "Tu invitación a {{platformName}}",
    invitationBody: "Hola {{firstName}},\n\nhas recibido una invitación a {{platformName}}. Abre el siguiente enlace para configurar tu acceso:\n{{invitationUrl}}\n\nEl enlace es válido durante {{expiresIn}}.",
    passwordSubject: "Restablece tu contraseña de {{platformName}}",
    passwordBody: "Hola {{firstName}},\n\nusa el siguiente enlace para restablecer tu contraseña de {{platformName}}:\n{{resetUrl}}\n\nEl enlace es válido durante {{expiresIn}}. Si no solicitaste este correo, puedes ignorarlo.",
  }),
  fr: localizedEmailTemplateSettings({
    moduleReleaseSubject: "Nouveaux modules dans {{courseTitle}}",
    moduleReleaseBody: "Bonjour {{firstName}},\n\nde nouveaux modules sont disponibles dans {{courseTitle}} :\n{{moduleList}}\n\nOuvrir le cours : {{courseUrl}}",
    invitationSubject: "Votre invitation à {{platformName}}",
    invitationBody: "Bonjour {{firstName}},\n\nvous avez été invité sur {{platformName}}. Ouvrez le lien suivant pour configurer votre accès :\n{{invitationUrl}}\n\nLe lien est valable pendant {{expiresIn}}.",
    passwordSubject: "Réinitialisez votre mot de passe pour {{platformName}}",
    passwordBody: "Bonjour {{firstName}},\n\nutilisez le lien suivant pour réinitialiser votre mot de passe pour {{platformName}} :\n{{resetUrl}}\n\nLe lien est valable pendant {{expiresIn}}. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
  }),
};

const PLACEHOLDER_PATTERN = /{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g;
const MAX_TEMPLATE_PLACEHOLDERS = 30;

function templateVariables(value: string) {
  const variables: string[] = [];
  for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
    if (match[1]) variables.push(match[1]);
  }
  return variables;
}

function validateTemplateText(
  value: string,
  allowedVariables: readonly string[],
  context: z.RefinementCtx,
  path: Array<string | number>,
) {
  const variables = templateVariables(value);
  const remainder = value.replace(PLACEHOLDER_PATTERN, "");
  if (remainder.includes("{{") || remainder.includes("}}")) {
    context.addIssue({
      code: "custom",
      path,
      message: "Die Vorlage enthaelt eine ungueltige Variable.",
    });
  }
  if (variables.length > MAX_TEMPLATE_PLACEHOLDERS) {
    context.addIssue({
      code: "custom",
      path,
      message: `Eine Vorlage darf hoechstens ${MAX_TEMPLATE_PLACEHOLDERS} Variablen enthalten.`,
    });
  }
  const unknown = variables.find(
    (variable) => !allowedVariables.includes(variable),
  );
  if (unknown) {
    context.addIssue({
      code: "custom",
      path,
      message: `Die Variable {{${unknown}}} ist fuer dieses Ereignis nicht erlaubt.`,
    });
  }
}

const subjectTemplateSchema = z
  .string()
  .max(500)
  .refine((value) => !/[\r\n<>\u0000-\u001f\u007f]/.test(value), {
    message: "Betreffvorlagen duerfen weder HTML noch Steuerzeichen enthalten.",
  })
  .transform((value) => value.trim())
  .pipe(z.string().min(1));

const bodyTemplateSchema = z
  .string()
  .trim()
  .min(1)
  .max(10_000)
  .transform((value) => value.replace(/\r\n?/g, "\n"))
  .refine((value) => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), {
    message: "Vorlagen duerfen kein HTML oder ungueltige Steuerzeichen enthalten.",
  });

function templateSchema(
  event: EmailTemplateEvent,
  additionalVariables: readonly string[] = [],
) {
  return z
    .object({ subject: subjectTemplateSchema, body: bodyTemplateSchema })
    .strict()
    .superRefine((template, context) => {
      const allowed = [
        ...EMAIL_TEMPLATE_VARIABLES[event],
        ...additionalVariables,
      ];
      validateTemplateText(template.subject, allowed, context, ["subject"]);
      validateTemplateText(template.body, allowed, context, ["body"]);
    });
}

export function emailTemplateSettingsSchema(
  additionalVariables: Partial<
    Record<EmailTemplateEvent, readonly string[]>
  > = {},
) {
  return z.object({
    version: z.literal(1),
    templates: z
      .object({
        "feedback.reply": templateSchema(
          "feedback.reply",
          additionalVariables["feedback.reply"],
        ),
        "lesson.available": templateSchema(
          "lesson.available",
          additionalVariables["lesson.available"],
        ),
        "course.modules.released": templateSchema(
          "course.modules.released",
          additionalVariables["course.modules.released"],
        ),
        "invitation.created": templateSchema("invitation.created"),
        "password.reset": templateSchema("password.reset"),
      })
      .strict(),
  })
  .strict();
}

export const emailTemplateSettingsInputSchema = emailTemplateSettingsSchema();

export function emailTemplateSettingsUpdateSchema(
  additionalVariables: Partial<
    Record<EmailTemplateEvent, readonly string[]>
  > = {},
) {
  return emailTemplateSettingsSchema(additionalVariables).extend({
    locale: z.enum(SUPPORTED_LOCALES).optional(),
  });
}

export const emailTemplateSettingsUpdateInputSchema =
  emailTemplateSettingsUpdateSchema();

export function sanitizeEmailTemplateSettings(
  value: unknown,
  fallback: EmailTemplateSettings = DEFAULT_EMAIL_TEMPLATE_SETTINGS,
  additionalVariables: Partial<
    Record<EmailTemplateEvent, readonly string[]>
  > = {},
): EmailTemplateSettings {
  const parsed = emailTemplateSettingsSchema(additionalVariables).safeParse(value);
  if (parsed.success) return parsed.data;

  const defaults = structuredClone(fallback);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return defaults;
  }
  const storedSettings = value as Record<string, unknown>;
  if (
    storedSettings.version !== 1 ||
    !storedSettings.templates ||
    typeof storedSettings.templates !== "object" ||
    Array.isArray(storedSettings.templates)
  ) {
    return defaults;
  }
  const storedTemplates = storedSettings.templates as Record<string, unknown>;

  for (const event of EMAIL_TEMPLATE_EVENTS) {
    const stored = templateSchema(
      event,
      additionalVariables[event],
    ).safeParse(storedTemplates[event]);
    if (stored.success) defaults.templates[event] = stored.data;
  }
  return defaults;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&#39;";
  });
}

export function plainTextToSafeEmailHtml(value: string) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

function renderTemplateValue(
  template: string,
  variables: Record<string, string>,
) {
  return template.replace(
    PLACEHOLDER_PATTERN,
    (_placeholder, variable: string) => {
      if (!Object.hasOwn(variables, variable)) {
        throw new Error(`Die Vorlagenvariable ${variable} fehlt.`);
      }
      const value = variables[variable];
      if (typeof value !== "string") {
        throw new Error(`Die Vorlagenvariable ${variable} ist ungueltig.`);
      }
      return value;
    },
  );
}

export const renderedEmailSubjectSchema = z
  .string()
  .max(200)
  .refine((value) => !/[\r\n\u0000-\u001f\u007f]/.test(value))
  .transform((value) => value.trim())
  .pipe(z.string().min(1));
export const renderedEmailMessageSchema = z
  .string()
  .max(10_000)
  .refine(
    (value) =>
      !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value),
  )
  .transform((value) => value.trim())
  .pipe(z.string().min(3));

export type RenderedEmailContent = {
  subject: string;
  message: string;
  html: string;
};
export const MAX_RENDERED_EMAIL_HTML_LENGTH = 70_000;

export function renderEmailTemplate(input: {
  event: EmailTemplateEvent;
  settings: EmailTemplateSettings;
  variables: Record<string, string>;
  additionalAllowedVariables?: readonly string[];
}): RenderedEmailContent {
  const additionalVariables = PERSONALIZED_EMAIL_TEMPLATE_EVENTS.includes(
    input.event as (typeof PERSONALIZED_EMAIL_TEMPLATE_EVENTS)[number],
  )
    ? (input.additionalAllowedVariables ?? [])
    : [];
  const settings = emailTemplateSettingsSchema({
    [input.event]: additionalVariables,
  }).parse(input.settings);
  const allowedVariables: readonly string[] =
    [...EMAIL_TEMPLATE_VARIABLES[input.event], ...additionalVariables];
  for (const variable of Object.keys(input.variables)) {
    if (!allowedVariables.includes(variable)) {
      throw new Error(`Die Vorlagenvariable ${variable} ist nicht erlaubt.`);
    }
  }
  const template = settings.templates[input.event];
  const subject = renderedEmailSubjectSchema.parse(
    renderTemplateValue(template.subject, input.variables),
  );
  const message = renderedEmailMessageSchema.parse(
    renderTemplateValue(template.body, input.variables),
  );
  return { subject, message, html: plainTextToSafeEmailHtml(message) };
}

export function isSafeEmailRetryEvent(
  value: string,
): value is EmailSafeRetryEvent {
  return EMAIL_SAFE_RETRY_EVENTS.some((event) => event === value);
}

export function isAuthenticationLinkEmailEvent(
  value: string,
): value is AuthenticationLinkEmailEvent {
  return EMAIL_AUTH_LINK_EVENTS.some((event) => event === value);
}

export function authenticationLinkTemplateVariables(
  event: AuthenticationLinkEmailEvent,
  input: { firstName: string; link: string; locale?: AppLocale },
): Record<string, string> {
  const locale = input.locale ?? "de";
  const invitationExpiry: Record<AppLocale, string> = {
    de: "7 Tage",
    en: "7 days",
    it: "7 giorni",
    es: "7 días",
    fr: "7 jours",
  };
  const passwordExpiry: Record<AppLocale, string> = {
    de: "30 Minuten",
    en: "30 minutes",
    it: "30 minuti",
    es: "30 minutos",
    fr: "30 minutes",
  };
  return event === "invitation.created"
    ? {
        firstName: input.firstName,
        invitationUrl: input.link,
        expiresIn: invitationExpiry[locale],
      }
    : {
        firstName: input.firstName,
        resetUrl: input.link,
        expiresIn: passwordExpiry[locale],
      };
}

function maskNamePart(value: string) {
  const normalized = value.trim();
  return normalized ? `${normalized.slice(0, 1)}***` : "***";
}

export function maskEmailAddress(value: string) {
  const [local, domain] = value.split("@", 2);
  if (!local || !domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskRecipientName(firstName: string, lastName: string) {
  return `${maskNamePart(firstName)} ${maskNamePart(lastName)}`;
}

export function redactEmailContent(value: string) {
  return value
    .replace(/\bhttps?:\/\/[^\s<>()]+/gi, "[Link ausgeblendet]")
    .replace(/\b(?:invite|reset)_[A-Za-z0-9_-]+\b/g, "[Token ausgeblendet]")
    .replace(
      /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
      "Bearer [Token ausgeblendet]",
    )
    .replace(
      /\b((?:token|secret|code|key)\s*[:=]\s*)[^\s&,;]+/gi,
      "$1[Token ausgeblendet]",
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      "[Token ausgeblendet]",
    );
}

export const safeStoredEmailPayloadSchema = z
  .object({
    subject: renderedEmailSubjectSchema,
    message: renderedEmailMessageSchema,
    html: z.string().max(MAX_RENDERED_EMAIL_HTML_LENGTH).optional(),
    locale: z.enum(SUPPORTED_LOCALES).optional(),
  })
  .strict();
const deliveryLinkSchema = z
  .string()
  .url()
  .max(2_000)
  .refine((value) => /^https?:\/\//i.test(value));
export const authenticationLinkSourcePayloadSchema = z
  .object({
    link: deliveryLinkSchema,
    locale: z.enum(SUPPORTED_LOCALES).optional(),
  })
  .strict();
export const authenticationLinkRenderedPayloadSchema =
  safeStoredEmailPayloadSchema
    .extend({
      link: deliveryLinkSchema,
      locale: z.enum(SUPPORTED_LOCALES).optional(),
    })
    .strict();
function validateStoredDerivedHtml(
  payload: { message: string; html?: string },
  context: z.RefinementCtx,
) {
  if (
    payload.html !== undefined &&
    payload.html !== plainTextToSafeEmailHtml(payload.message)
  ) {
    context.addIssue({
      code: "custom",
      path: ["html"],
      message: "HTML muss exakt aus dem Plaintext abgeleitet sein.",
    });
  }
}
const safeStoredEmailDeliveryPayloadSchema =
  safeStoredEmailPayloadSchema.superRefine(validateStoredDerivedHtml);
const authenticationLinkStoredPayloadSchema = z.union([
  authenticationLinkSourcePayloadSchema,
  authenticationLinkRenderedPayloadSchema.superRefine(
    validateStoredDerivedHtml,
  ),
]);
const linkedStoredEmailPayloadSchema = safeStoredEmailPayloadSchema
  .extend({ link: deliveryLinkSchema })
  .strict();
const lessonStoredPayloadSchema = linkedStoredEmailPayloadSchema.superRefine(
  validateStoredDerivedHtml,
);
export const courseModulesReleasedStoredPayloadSchema =
  safeStoredEmailPayloadSchema
    .extend({
      html: z.string().max(MAX_RENDERED_EMAIL_HTML_LENGTH),
      locale: z.enum(SUPPORTED_LOCALES),
      link: deliveryLinkSchema,
      courseId: z.string().uuid(),
      courseVersionId: z.string().uuid(),
      moduleIds: z
        .array(z.string().uuid())
        .min(1)
        .max(1_000)
        .refine((value) => new Set(value).size === value.length, {
          message: "Modul-IDs muessen eindeutig sein.",
        }),
    })
    .strict()
    .superRefine((payload, context) => {
      if (payload.html !== plainTextToSafeEmailHtml(payload.message)) {
        context.addIssue({
          code: "custom",
          path: ["html"],
          message: "HTML muss exakt aus dem Plaintext abgeleitet sein.",
        });
      }
    });
const eventLifecycleStoredPayloadSchema = lessonStoredPayloadSchema;

function storedEmailDeliverySourceSchema(event: string): z.ZodType | null {
  if (isAuthenticationLinkEmailEvent(event)) {
    return authenticationLinkStoredPayloadSchema;
  }
  if (event === "lesson.available") return lessonStoredPayloadSchema;
  if (event === "course.modules.released") {
    return courseModulesReleasedStoredPayloadSchema;
  }
  if (EVENT_LIFECYCLE_EMAIL_EVENTS.some((item) => item === event)) {
    return eventLifecycleStoredPayloadSchema;
  }
  if (event === "feedback.reply" || event === "email.template.test") {
    return safeStoredEmailDeliveryPayloadSchema;
  }
  return null;
}

// Immutable snapshot source contract. Future source fields require a V2 parser.
export function parseStoredEmailDeliverySourcePayloadV1(
  event: string,
  payload: unknown,
): unknown {
  const schema = storedEmailDeliverySourceSchema(event);
  if (!schema) {
    throw new Error("Nicht unterstuetztes E-Mail-Ereignis.");
  }
  return schema.parse(payload);
}

export type EmailDeliveryContentView =
  | {
      available: true;
      subject: string;
      message: string;
      html: string;
      linksRedacted: boolean;
    }
  | {
      available: false;
      reason: "authentication_link" | "unsupported_event" | "invalid_payload";
    };

export function presentEmailDeliveryContent(
  event: string,
  decryptedPayload: unknown,
): EmailDeliveryContentView {
  if (isAuthenticationLinkEmailEvent(event)) {
    return { available: false, reason: "authentication_link" };
  }
  const schema =
    event === "lesson.available"
      ? linkedStoredEmailPayloadSchema
      : event === "course.modules.released"
        ? courseModulesReleasedStoredPayloadSchema
        : EVENT_LIFECYCLE_EMAIL_EVENTS.some((item) => item === event)
          ? linkedStoredEmailPayloadSchema
          : event === "feedback.reply" || event === "email.template.test"
            ? safeStoredEmailPayloadSchema
            : null;
  if (!schema) return { available: false, reason: "unsupported_event" };
  const parsed = schema.safeParse(decryptedPayload);
  if (!parsed.success) return { available: false, reason: "invalid_payload" };
  const subject = redactEmailContent(parsed.data.subject);
  const message = redactEmailContent(parsed.data.message);
  return {
    available: true,
    subject,
    message,
    html: plainTextToSafeEmailHtml(message),
    linksRedacted:
      subject !== parsed.data.subject ||
      message !== parsed.data.message ||
      event === "lesson.available" ||
      event === "course.modules.released" ||
      EVENT_LIFECYCLE_EMAIL_EVENTS.some((item) => item === event),
  };
}

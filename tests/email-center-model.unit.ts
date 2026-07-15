import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EMAIL_TEMPLATE_SETTINGS,
  EMAIL_SAFE_RETRY_EVENTS,
  emailTemplateSettingsInputSchema,
  maskEmailAddress,
  maskRecipientName,
  plainTextToSafeEmailHtml,
  presentEmailDeliveryContent,
  renderEmailTemplate,
  sanitizeEmailTemplateSettings,
} from "../src/lib/email-center-model";

test("email templates reject unknown, malformed and raw HTML variables", () => {
  for (const body of [
    "{{unknown}}",
    "{{firstName",
    "<strong>{{firstName}}</strong>",
  ]) {
    const candidate = structuredClone(DEFAULT_EMAIL_TEMPLATE_SETTINGS);
    candidate.templates["feedback.reply"].body = body;
    assert.equal(emailTemplateSettingsInputSchema.safeParse(candidate).success, false);
  }
});

test("email template rendering rejects missing variables and validates output length", () => {
  assert.throws(() =>
    renderEmailTemplate({
      event: "feedback.reply",
      settings: DEFAULT_EMAIL_TEMPLATE_SETTINGS,
      variables: { defaultSubject: "Antwort" },
    }),
  );

  const settings = structuredClone(DEFAULT_EMAIL_TEMPLATE_SETTINGS);
  settings.templates["feedback.reply"].subject = "{{firstName}}";
  assert.throws(() =>
    renderEmailTemplate({
      event: "feedback.reply",
      settings,
      variables: {
        defaultSubject: "Antwort",
        defaultMessage: "Nachricht",
        firstName: "A".repeat(201),
        platformName: "Academy",
      },
    }),
  );
});

test("email template HTML is generated only from escaped plaintext", () => {
  const settings = structuredClone(DEFAULT_EMAIL_TEMPLATE_SETTINGS);
  settings.templates["feedback.reply"] = {
    subject: "Antwort fuer {{firstName}}",
    body: "Hallo {{firstName}}\n\n{{defaultMessage}}",
  };
  const rendered = renderEmailTemplate({
    event: "feedback.reply",
    settings,
    variables: {
      defaultSubject: "Ignoriert",
      defaultMessage: "5 > 3 & sicher",
      firstName: "Ada <Admin>",
      platformName: "Academy",
    },
  });
  assert.equal(rendered.subject, "Antwort fuer Ada <Admin>");
  assert.equal(
    rendered.html,
    "<p>Hallo Ada &lt;Admin&gt;</p><p>5 &gt; 3 &amp; sicher</p>",
  );
  assert.equal(plainTextToSafeEmailHtml("<script>\nTest"), "<p>&lt;script&gt;<br>Test</p>");
});

test("authentication templates render only their allowed variables to escaped HTML", () => {
  const settings = structuredClone(DEFAULT_EMAIL_TEMPLATE_SETTINGS);
  settings.templates["invitation.created"] = {
    subject: "Einladung zu {{platformName}} fuer {{firstName}}",
    body: "Hallo {{firstName}}\n\n{{invitationUrl}}\n\nGueltig: {{expiresIn}}",
  };
  const rendered = renderEmailTemplate({
    event: "invitation.created",
    settings,
    variables: {
      firstName: "Ada <Admin>",
      platformName: "Sichere & Academy",
      invitationUrl: "https://academy.example/invitations/example?a=1&b=2",
      expiresIn: "7 Tage",
    },
  });
  assert.equal(
    rendered.subject,
    "Einladung zu Sichere & Academy fuer Ada <Admin>",
  );
  assert.match(rendered.html, /Ada &lt;Admin&gt;/);
  assert.match(rendered.html, /a=1&amp;b=2/);

  settings.templates["password.reset"].body = "{{invitationUrl}}";
  assert.equal(emailTemplateSettingsInputSchema.safeParse(settings).success, false);
});

test("stored legacy version-one settings preserve existing templates and gain auth defaults", () => {
  const legacy = {
    version: 1,
    templates: {
      "feedback.reply": {
        subject: "Individuelle Antwort",
        body: "Hallo {{firstName}}",
      },
      "lesson.available": {
        subject: "Neue Lektion",
        body: "{{lessonUrl}}",
      },
    },
  };
  const normalized = sanitizeEmailTemplateSettings(legacy);
  assert.equal(
    normalized.templates["feedback.reply"].subject,
    "Individuelle Antwort",
  );
  assert.deepEqual(
    normalized.templates["invitation.created"],
    DEFAULT_EMAIL_TEMPLATE_SETTINGS.templates["invitation.created"],
  );
  assert.deepEqual(
    normalized.templates["password.reset"],
    DEFAULT_EMAIL_TEMPLATE_SETTINGS.templates["password.reset"],
  );
  assert.deepEqual(EMAIL_SAFE_RETRY_EVENTS, [
    "feedback.reply",
    "lesson.available",
    "course.modules.released",
    "event.rescheduled",
    "event.cancelled",
    "email.template.test",
  ]);
});

test("mail list identities are masked while safe detail content redacts links", () => {
  assert.equal(maskEmailAddress("anna@example.test"), "a***@example.test");
  assert.equal(maskRecipientName("Anna", "Meier"), "A*** M***");
  assert.deepEqual(
    presentEmailDeliveryContent("lesson.available", {
      subject: "Neue Lektion",
      message:
        "Oeffne https://academy.example.test/academy/lesson und nutze reset_SECRET oder token=abc123 sicher.",
      html: "<img src=x onerror=alert(1)>",
      link: "https://academy.example.test/academy/lesson",
    }),
    {
      available: true,
      subject: "Neue Lektion",
      message:
        "Oeffne [Link ausgeblendet] und nutze [Token ausgeblendet] oder token=[Token ausgeblendet] sicher.",
      html: "<p>Oeffne [Link ausgeblendet] und nutze [Token ausgeblendet] oder token=[Token ausgeblendet] sicher.</p>",
      linksRedacted: true,
    },
  );
});

test("course module release details use the strict snapshot and redact internal links", () => {
  const message =
    "Neue Module sind unter https://academy.example.test/academy/courses/kurs verfuegbar.";
  const payload = {
    subject: "Neue Kursmodule",
    message,
    html: plainTextToSafeEmailHtml(message),
    locale: "de",
    link: "https://academy.example.test/academy/courses/kurs",
    courseId: "10000000-0000-4000-8000-000000000001",
    courseVersionId: "10000000-0000-4000-8000-000000000002",
    moduleIds: ["10000000-0000-4000-8000-000000000003"],
  };

  assert.deepEqual(
    presentEmailDeliveryContent("course.modules.released", payload),
    {
      available: true,
      subject: "Neue Kursmodule",
      message: "Neue Module sind unter [Link ausgeblendet] verfuegbar.",
      html: "<p>Neue Module sind unter [Link ausgeblendet] verfuegbar.</p>",
      linksRedacted: true,
    },
  );
  for (const invalidPayload of [
    { ...payload, html: "<script>alert(1)</script>" },
    { ...payload, internalAuditContext: "must-not-pass" },
  ]) {
    assert.deepEqual(
      presentEmailDeliveryContent(
        "course.modules.released",
        invalidPayload,
      ),
      { available: false, reason: "invalid_payload" },
    );
  }
});

test("authentication-link details never inspect or expose decrypted payloads", () => {
  const payload = new Proxy(
    {},
    { get: () => assert.fail("authentication payload was inspected") },
  );
  assert.deepEqual(presentEmailDeliveryContent("invitation.created", payload), {
    available: false,
    reason: "authentication_link",
  });
  assert.deepEqual(sanitizeEmailTemplateSettings({ invalid: true }), DEFAULT_EMAIL_TEMPLATE_SETTINGS);
});

test("stored detail content rejects subject and body control characters", () => {
  for (const payload of [
    { subject: "Zeile eins\nZeile zwei", message: "Sicherer Inhalt" },
    { subject: "Sicher\r\n", message: "Sicherer Inhalt" },
    { subject: "Sicher", message: "Inhalt\u0000mit Steuerzeichen" },
    { subject: "Sicher", message: "Inhalt\rmit Steuerzeichen" },
  ]) {
    assert.deepEqual(presentEmailDeliveryContent("feedback.reply", payload), {
      available: false,
      reason: "invalid_payload",
    });
  }
});

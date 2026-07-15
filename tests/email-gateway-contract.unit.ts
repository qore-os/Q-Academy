import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  buildEmailGatewayRequest,
  canDispatchEmailToRecipient,
  emailTenantBrandingFromTenantBranding,
} from "../src/lib/email-gateway-contract";
import { DEFAULT_TENANT_BRANDING } from "../src/lib/branding-model";

const tenantBranding = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  name: "Q Academy",
  platformName: "Q Academy",
  primaryColor: "#17324d",
  accentColor: "#2bb7a9",
  senderName: "Q Academy Team",
  logoUrl: null,
  logoLightUrl: null,
  logoDarkUrl: null,
  locale: "de" as const,
};

test("mail gateway receives absolute light and dark logos plus the configured sender", () => {
  const branding = emailTenantBrandingFromTenantBranding({
    organizationName: "Q Academy GmbH",
    assetOrigin: "https://academy.example.test",
    branding: {
      ...DEFAULT_TENANT_BRANDING,
      organizationId: "00000000-0000-4000-8000-000000000001",
      organizationSlug: "q-academy",
      platformName: "Q Academy",
      emailSenderName: "Q Academy Lernteam",
      logoLightUrl: "/images/branding/logo-light.svg",
      logoDarkUrl: "/images/branding/logo-dark.svg",
    },
  });

  assert.deepEqual(branding, {
    organizationId: "00000000-0000-4000-8000-000000000001",
    name: "Q Academy GmbH",
    platformName: "Q Academy",
    primaryColor: "#17324d",
    accentColor: "#2bb7a9",
    senderName: "Q Academy Lernteam",
    logoUrl: "https://academy.example.test/images/branding/logo-light.svg",
    logoLightUrl:
      "https://academy.example.test/images/branding/logo-light.svg",
    logoDarkUrl:
      "https://academy.example.test/images/branding/logo-dark.svg",
    locale: "de",
  });
});

test("auth-link deliveries retain the link gateway contract", () => {
  const request = buildEmailGatewayRequest({
    event: "invitation.created",
    email: "member@example.test",
    decryptedPayload: { link: "https://academy.example.test/invitation/token" },
    tenantBranding,
  });
  assert.equal(request.event, "invitation.created");
  assert.equal(request.email, "member@example.test");
  assert.equal("link" in request ? request.link : null, "https://academy.example.test/invitation/token");
  assert.equal("message" in request, false);
});

test("materialized authentication templates retain encrypted-link gateway semantics", () => {
  const message =
    "Hallo Mara, oeffne https://academy.example.test/invitations/token";
  const html =
    "<p>Hallo Mara, oeffne https://academy.example.test/invitations/token</p>";
  const request = buildEmailGatewayRequest({
    event: "invitation.created",
    email: "member@example.test",
    decryptedPayload: {
      link: "https://academy.example.test/invitations/token",
      subject: "Deine Einladung",
      message,
      html,
    },
    tenantBranding,
  });
  assert.deepEqual(request, {
    event: "invitation.created",
    email: "member@example.test",
    link: "https://academy.example.test/invitations/token",
    subject: "Deine Einladung",
    message,
    html,
    tenantBranding,
  });

  assert.throws(() =>
    buildEmailGatewayRequest({
      event: "password.reset",
      email: "member@example.test",
      decryptedPayload: {
        link: "https://academy.example.test/password/reset?token=secret",
        subject: "Passwort zuruecksetzen",
        message: "Sicherer Inhalt",
        html: "<img src=x onerror=alert(1)>",
      },
      tenantBranding,
    }),
  );
});

test("feedback replies expose only subject and message to the mail gateway", () => {
  const request = buildEmailGatewayRequest({
    event: "feedback.reply",
    email: "member@example.test",
    decryptedPayload: {
      subject: "Rueckmeldung zu deinem Feedback",
      message: "Danke fuer deinen Hinweis.",
    },
    tenantBranding,
  });
  assert.deepEqual(request, {
    event: "feedback.reply",
    email: "member@example.test",
    subject: "Rueckmeldung zu deinem Feedback",
    message: "Danke fuer deinen Hinweis.",
    tenantBranding,
  });
  assert.equal("link" in request, false);
});

test("feedback reply payloads fail closed when content is missing", () => {
  assert.throws(() =>
    buildEmailGatewayRequest({
      event: "feedback.reply",
      email: "member@example.test",
      decryptedPayload: { subject: "Rueckmeldung" },
      tenantBranding,
    }),
  );
});

test("unknown mail events and unsafe generated HTML fail closed", () => {
  assert.equal(
    canDispatchEmailToRecipient({
      event: "unknown.event",
      recipientStatus: "active",
      recipientRole: "member",
    }),
    false,
  );
  assert.throws(() =>
    buildEmailGatewayRequest({
      event: "unknown.event",
      email: "member@example.test",
      decryptedPayload: { link: "https://example.test/secret" },
      tenantBranding,
    }),
  );
  assert.throws(() =>
    buildEmailGatewayRequest({
      event: "feedback.reply",
      email: "member@example.test",
      decryptedPayload: {
        subject: "Rueckmeldung",
        message: "Sicherer Inhalt",
        html: "<script>alert(1)</script>",
      },
      tenantBranding,
    }),
  );
  for (const decryptedPayload of [
    { subject: "Kopf\r\nBcc: hidden@example.test", message: "Sicher" },
    { subject: "Sicher", message: "Inhalt\u0000mit Steuerzeichen" },
  ]) {
    assert.throws(() =>
      buildEmailGatewayRequest({
        event: "feedback.reply",
        email: "member@example.test",
        decryptedPayload,
        tenantBranding,
      }),
    );
  }
});

test("mail events enforce recipient lifecycle and role", () => {
  assert.equal(
    canDispatchEmailToRecipient({
      event: "invitation.created",
      recipientStatus: "invited",
      recipientRole: "owner",
    }),
    true,
  );
  assert.equal(
    canDispatchEmailToRecipient({
      event: "password.reset",
      recipientStatus: "invited",
      recipientRole: "member",
    }),
    false,
  );
  assert.equal(
    canDispatchEmailToRecipient({
      event: "email.template.test",
      recipientStatus: "active",
      recipientRole: "admin",
    }),
    true,
  );
  assert.equal(
    canDispatchEmailToRecipient({
      event: "email.template.test",
      recipientStatus: "active",
      recipientRole: "member",
    }),
    false,
  );
});

test("lesson availability deliveries expose message and absolute lesson link", () => {
  const request = buildEmailGatewayRequest({
    event: "lesson.available",
    email: "member@example.test",
    decryptedPayload: {
      subject: "Neue Lektion verfuegbar",
      message: "Die vorgemerkte Lektion kann jetzt geoeffnet werden.",
      link: "https://academy.example.test/academy/courses/kurs/learn/lektion",
    },
    tenantBranding,
  });
  assert.deepEqual(request, {
    event: "lesson.available",
    email: "member@example.test",
    subject: "Neue Lektion verfuegbar",
    message: "Die vorgemerkte Lektion kann jetzt geoeffnet werden.",
    link: "https://academy.example.test/academy/courses/kurs/learn/lektion",
    tenantBranding,
  });
});

test("lesson availability payloads fail closed without an absolute link", () => {
  assert.throws(() =>
    buildEmailGatewayRequest({
      event: "lesson.available",
      email: "member@example.test",
      decryptedPayload: {
        subject: "Neue Lektion verfuegbar",
        message: "Die Lektion kann jetzt geoeffnet werden.",
        link: "/academy/courses/kurs",
      },
      tenantBranding,
    }),
  );
  assert.throws(
    () =>
      buildEmailGatewayRequest({
        event: "lesson.available",
        email: "member@example.test",
        decryptedPayload: {
          subject: "Neue Lektion",
          message: "Deine Lektion ist jetzt offen.",
          link: "javascript:alert(1)",
        },
        tenantBranding,
      }),
    z.ZodError,
  );
});

test("feedback replies dispatch only to active member identities", () => {
  assert.equal(
    canDispatchEmailToRecipient({
      event: "feedback.reply",
      recipientStatus: "active",
      recipientRole: "member",
    }),
    true,
  );
  assert.equal(
    canDispatchEmailToRecipient({
      event: "feedback.reply",
      recipientStatus: "suspended",
      recipientRole: "member",
    }),
    false,
  );
  assert.equal(
    canDispatchEmailToRecipient({
      event: "feedback.reply",
      recipientStatus: "active",
      recipientRole: "trainer",
    }),
    false,
  );
  assert.equal(
    canDispatchEmailToRecipient({
      event: "invitation.created",
      recipientStatus: "invited",
      recipientRole: "member",
    }),
    true,
  );
});

test("event lifecycle mail uses a safe absolute event link for active members", () => {
  assert.equal(
    canDispatchEmailToRecipient({
      event: "event.cancelled",
      recipientStatus: "active",
      recipientRole: "member",
    }),
    true,
  );
  assert.equal(
    canDispatchEmailToRecipient({
      event: "event.rescheduled",
      recipientStatus: "disabled",
      recipientRole: "member",
    }),
    false,
  );
  const request = buildEmailGatewayRequest({
    event: "event.rescheduled",
    email: "member@example.test",
    decryptedPayload: {
      subject: "Workshop wurde neu geplant",
      message: "Der Workshop findet zu einem neuen Zeitpunkt statt.",
      link: "https://academy.example.test/academy/events#event-123",
    },
    tenantBranding,
  });
  assert.equal(request.event, "event.rescheduled");
  assert.equal(
    request.link,
    "https://academy.example.test/academy/events#event-123",
  );
  assert.throws(() =>
    buildEmailGatewayRequest({
      event: "event.cancelled",
      email: "member@example.test",
      decryptedPayload: {
        subject: "Workshop wurde abgesagt",
        message: "Der Workshop findet nicht statt.",
        link: "javascript:alert(1)",
      },
      tenantBranding,
    }),
  );
});

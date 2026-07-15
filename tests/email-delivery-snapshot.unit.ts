import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmailDeliveryPayloadEnvelope,
  emailDeliveryPayloadSource,
  parseEmailDeliveryPayload,
} from "../src/lib/email-delivery-snapshot";
import { emailGatewayRequestSchema } from "../src/lib/email-gateway-contract";
import { plainTextToSafeEmailHtml } from "../src/lib/email-center-model";

const organizationId = "00000000-0000-4000-8000-000000000001";
const email = "member@example.test";
const source = {
  subject: "Rueckmeldung",
  message: "Danke fuer deinen Hinweis.",
  locale: "de" as const,
};
const tenantBranding = {
  organizationId,
  name: "Q Academy GmbH",
  platformName: "Q Academy",
  primaryColor: "#17324d",
  accentColor: "#2bb7a9",
  senderName: "Q Academy Team",
  logoUrl: "https://academy.example.test/images/logo-light.svg",
  logoLightUrl: "https://academy.example.test/images/logo-light.svg",
  logoDarkUrl: "https://academy.example.test/images/logo-dark.svg",
  locale: "de" as const,
};
const gatewayRequest = {
  event: "feedback.reply" as const,
  email,
  subject: source.subject,
  message: source.message,
  tenantBranding,
};
const binding = {
  event: gatewayRequest.event,
  email,
  organizationId,
};

test("legacy delivery payloads remain valid and expose their source", () => {
  assert.deepEqual(
    parseEmailDeliveryPayload({ ...binding, payload: source }),
    { kind: "legacy", source },
  );
  assert.deepEqual(
    emailDeliveryPayloadSource({ ...binding, payload: source }),
    source,
  );
});

test("version-one envelopes freeze and expose a complete bound gateway request", () => {
  const envelope = createEmailDeliveryPayloadEnvelope({
    ...binding,
    source,
    gatewayRequest,
  });
  assert.deepEqual(envelope, {
    schemaVersion: 1,
    source,
    gatewayRequest,
  });
  assert.deepEqual(parseEmailDeliveryPayload({ ...binding, payload: envelope }), {
    kind: "snapshot",
    source,
    gatewayRequest,
    envelope,
  });
  assert.deepEqual(
    emailDeliveryPayloadSource({ ...binding, payload: envelope }),
    source,
  );
});

test("authentication source links can be frozen only with materialized content", () => {
  const message = "Oeffne den sicheren Einladungslink.";
  const authBinding = { ...binding, event: "invitation.created" };
  const authSource = {
    link: "https://academy.example.test/invitations/secret-token",
    locale: "de" as const,
  };
  const authGatewayRequest = {
    event: "invitation.created" as const,
    email,
    subject: "Deine Einladung",
    message,
    html: plainTextToSafeEmailHtml(message),
    link: authSource.link,
    tenantBranding,
  };
  assert.deepEqual(
    createEmailDeliveryPayloadEnvelope({
      ...authBinding,
      source: authSource,
      gatewayRequest: authGatewayRequest,
    }).gatewayRequest,
    authGatewayRequest,
  );
  assert.throws(() =>
    createEmailDeliveryPayloadEnvelope({
      ...authBinding,
      source: authSource,
      gatewayRequest: {
        event: "invitation.created",
        email,
        link: authSource.link,
        tenantBranding,
      },
    }),
  );
});

test("envelope markers, versions and unknown fields fail closed", () => {
  const envelope = createEmailDeliveryPayloadEnvelope({
    ...binding,
    source,
    gatewayRequest,
  });
  for (const payload of [
    { schemaVersion: 1 },
    { source },
    { gatewayRequest },
    { ...envelope, schemaVersion: 2 },
    { ...envelope, internalProvider: "must-not-pass" },
  ]) {
    assert.throws(() =>
      parseEmailDeliveryPayload({ ...binding, payload }),
    );
  }
});

test("snapshots are strictly bound to delivery event, email and tenant", () => {
  const envelope = createEmailDeliveryPayloadEnvelope({
    ...binding,
    source,
    gatewayRequest,
  });
  for (const payload of [
    {
      ...envelope,
      gatewayRequest: {
        ...gatewayRequest,
        event: "email.template.test",
      },
    },
    {
      ...envelope,
      gatewayRequest: {
        ...gatewayRequest,
        email: "other@example.test",
      },
    },
    {
      ...envelope,
      gatewayRequest: {
        ...gatewayRequest,
        tenantBranding: {
          ...tenantBranding,
          organizationId: "00000000-0000-4000-8000-000000000002",
        },
      },
    },
  ]) {
    assert.throws(() =>
      parseEmailDeliveryPayload({ ...binding, payload }),
    );
  }
});

test("source, request and tenant branding schemas reject unsafe extra data", () => {
  const envelope = createEmailDeliveryPayloadEnvelope({
    ...binding,
    source,
    gatewayRequest,
  });
  assert.throws(() =>
    parseEmailDeliveryPayload({
      ...binding,
      payload: {
        ...envelope,
        source: { ...source, internalContext: "must-not-pass" },
      },
    }),
  );
  assert.throws(() =>
    emailGatewayRequestSchema.parse({
      ...gatewayRequest,
      provider: "must-not-pass",
    }),
  );
  assert.throws(() =>
    emailGatewayRequestSchema.parse({
      ...gatewayRequest,
      tenantBranding: {
        ...tenantBranding,
        logoUrl: "https://user:secret@academy.example.test/logo.svg",
        logoLightUrl: "https://user:secret@academy.example.test/logo.svg",
      },
    }),
  );
});

test("snapshot source fields exactly match the content sent by retries", () => {
  const validEnvelope = createEmailDeliveryPayloadEnvelope({
    ...binding,
    source,
    gatewayRequest,
  });
  assert.throws(() =>
    createEmailDeliveryPayloadEnvelope({
      ...binding,
      source,
      gatewayRequest: {
        ...gatewayRequest,
        message: "Different hidden retry content",
      },
    }),
  );
  assert.throws(() =>
    parseEmailDeliveryPayload({
      ...binding,
      payload: {
        ...validEnvelope,
        gatewayRequest: {
          ...gatewayRequest,
          message: "Different hidden stored retry content",
        },
      },
    }),
  );

  const lessonSource = {
    subject: "Neue Lektion",
    message: "Die Lektion ist verfuegbar.",
    link: "https://academy.example.test/academy/lessons/one",
    locale: "de" as const,
  };
  assert.throws(() =>
    createEmailDeliveryPayloadEnvelope({
      ...binding,
      event: "lesson.available",
      source: lessonSource,
      gatewayRequest: {
        event: "lesson.available",
        email,
        subject: lessonSource.subject,
        message: lessonSource.message,
        link: "https://academy.example.test/academy/lessons/other",
        tenantBranding,
      },
    }),
  );

  const authSource = {
    link: "https://academy.example.test/invitations/source-token",
    locale: "de" as const,
  };
  assert.throws(() =>
    createEmailDeliveryPayloadEnvelope({
      ...binding,
      event: "invitation.created",
      source: authSource,
      gatewayRequest: {
        event: "invitation.created",
        email,
        subject: "Deine Einladung",
        message: "Oeffne den Einladungslink.",
        link: "https://academy.example.test/invitations/other-token",
        tenantBranding,
      },
    }),
  );

  const renderedAuthSource = {
    ...authSource,
    subject: "Deine Einladung",
    message: "Oeffne den Einladungslink.",
  };
  assert.throws(() =>
    createEmailDeliveryPayloadEnvelope({
      ...binding,
      event: "invitation.created",
      source: renderedAuthSource,
      gatewayRequest: {
        event: "invitation.created",
        email,
        subject: renderedAuthSource.subject,
        message: "Different hidden authentication content",
        link: renderedAuthSource.link,
        tenantBranding,
      },
    }),
  );
});

test("snapshot sources cannot be wrapped a second time", () => {
  const envelope = createEmailDeliveryPayloadEnvelope({
    ...binding,
    source,
    gatewayRequest,
  });
  assert.throws(() =>
    createEmailDeliveryPayloadEnvelope({
      ...binding,
      source: envelope,
      gatewayRequest,
    }),
  );
  assert.throws(() =>
    parseEmailDeliveryPayload({
      ...binding,
      payload: { ...envelope, source: envelope },
    }),
  );
});

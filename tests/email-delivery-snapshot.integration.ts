import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

test(
  "mail delivery freezes a claim-bound request before fetch and reuses it exactly",
  { timeout: 30_000 },
  async () => {
    const sql = postgres(databaseUrl, { max: 2, prepare: false });
    const originalFetch = globalThis.fetch;
    const originalDeliveryUrl = process.env.EMAIL_DELIVERY_WEBHOOK_URL;
    const organizationId = randomUUID();
    const memberId = randomUUID();
    const ownerId = randomUUID();
    const invitationDeliveryId = randomUUID();
    const memberEmail = `${memberId}@example.test`;
    let applicationClient:
      | { end: (options?: { timeout?: number }) => Promise<void> }
      | undefined;
    try {
      process.env.EMAIL_DELIVERY_WEBHOOK_URL =
        "https://mail-provider.example.test/deliver";
      const [
        { deliverQueuedEmail },
        { encryptPayload, decryptPayload },
        {
          createEmailDeliveryPayloadEnvelope,
          parseEmailDeliveryPayload,
        },
        { getEmailDeliveryDetail, retryFailedEmailDelivery },
        { db, postgresClient },
        { DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE },
        { privacyEmailRecipientReference },
      ] = await Promise.all([
        import("../src/lib/email-delivery"),
        import("../src/lib/api/crypto"),
        import("../src/lib/email-delivery-snapshot"),
        import("../src/lib/email-center"),
        import("../src/db/index"),
        import("../src/lib/email-center-model"),
        import("../src/lib/privacy/subject-reference"),
      ]);
      applicationClient = postgresClient;

      await sql`
        insert into organizations (id, name, slug)
        values (
          ${organizationId}, 'Frozen Organization',
          ${`snapshot-${organizationId.slice(0, 8)}`}
        )
      `;
      await sql`
        insert into users (
          id, organization_id, email, password_hash, first_name, last_name,
          role, status
        ) values
          (
            ${memberId}, ${organizationId}, ${memberEmail}, 'unused',
            'Mara', 'Member', 'member', 'invited'
          ),
          (
            ${ownerId}, ${organizationId}, ${`${ownerId}@example.test`},
            'unused', 'Olivia', 'Owner', 'owner', 'active'
          )
      `;
      await sql`
        insert into platform_settings (organization_id, key, value)
        values (
          ${organizationId}, 'design',
          ${sql.json({
            platformName: "Frozen Academy",
            primaryColor: "#112233",
            accentColor: "#445566",
            emailSenderName: "Frozen Sender",
          })}
        )
      `;
      const invitationSource = {
        link: "https://academy.example.test/invitations/secret-token",
        locale: "de",
      };
      const initialClaimedAt = new Date();
      await sql`
        insert into email_deliveries (
          id, organization_id, user_id, event, category, recipient_email,
          payload, status, claimed_at
        ) values (
          ${invitationDeliveryId}, ${organizationId}, ${memberId},
          'invitation.created', 'system', ${memberEmail},
          ${sql.json(
            encryptPayload(
              JSON.stringify(invitationSource),
              `email-delivery:${invitationDeliveryId}`,
            ),
          )},
          'processing', ${initialClaimedAt.toISOString()}::timestamptz
        )
      `;

      type Ciphertext = ReturnType<typeof encryptPayload>;
      let firstCiphertext: Ciphertext | null = null;
      let firstPlaintext: unknown = null;
      let inspectionError: unknown = null;
      const requestBodies: string[] = [];
      globalThis.fetch = (async (_input, init) => {
        if (typeof init?.body !== "string") {
          throw new Error("Mail request body was not a string.");
        }
        requestBodies.push(init.body);
        if (requestBodies.length === 1) {
          try {
            const [storedAtFetch] = await sql<Array<{ payload: Ciphertext }>>`
              select payload from email_deliveries
              where id = ${invitationDeliveryId}
            `;
            assert.ok(storedAtFetch);
            firstCiphertext = structuredClone(storedAtFetch.payload);
            firstPlaintext = JSON.parse(
              decryptPayload(
                storedAtFetch.payload,
                `email-delivery:${invitationDeliveryId}`,
              ),
            );
          } catch (error) {
            inspectionError = error;
          }
          throw new Error("Simulated provider timeout after request handoff.");
        }
        return new Response(null, { status: 202 });
      }) as typeof fetch;

      const firstResult = await deliverQueuedEmail({
        id: invitationDeliveryId,
        claimedAt: initialClaimedAt,
      });
      if (inspectionError) throw inspectionError;
      assert.equal(firstResult?.status, "retrying");
      assert.equal(firstResult?.attempt, 1);
      assert.equal(
        firstResult?.responseBody,
        "Die E-Mail-Zustellung ist fehlgeschlagen.",
      );
      assert.equal(requestBodies.length, 1);
      assert.ok(firstCiphertext);
      const firstSnapshot = parseEmailDeliveryPayload({
        event: "invitation.created",
        email: memberEmail,
        organizationId,
        payload: firstPlaintext,
      });
      assert.equal(firstSnapshot.kind, "snapshot");
      if (firstSnapshot.kind !== "snapshot") assert.fail("Snapshot missing.");
      assert.deepEqual(firstSnapshot.source, invitationSource);
      assert.equal(
        requestBodies[0],
        JSON.stringify(firstSnapshot.gatewayRequest),
      );
      assert.equal(
        firstSnapshot.gatewayRequest.tenantBranding.name,
        "Frozen Organization",
      );
      assert.equal(
        firstSnapshot.gatewayRequest.tenantBranding.platformName,
        "Frozen Academy",
      );
      assert.match(firstSnapshot.gatewayRequest.subject, /Frozen Academy/);

      const changedTemplates = structuredClone(
        DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE.de,
      );
      changedTemplates.templates["invitation.created"] = {
        subject: "CHANGED TEMPLATE {{platformName}}",
        body: "CHANGED TEMPLATE {{invitationUrl}}",
      };
      await sql`
        update organizations set name = 'Changed Organization'
        where id = ${organizationId}
      `;
      await sql`
        update platform_settings
        set value = ${sql.json({
          platformName: "Changed Academy",
          primaryColor: "#abcdef",
          accentColor: "#fedcba",
          emailSenderName: "Changed Sender",
        })}
        where organization_id = ${organizationId} and key = 'design'
      `;
      await sql`
        insert into platform_settings (organization_id, key, value)
        values (
          ${organizationId}, 'email_templates.de',
          ${sql.json(changedTemplates)}
        )
      `;
      const retryClaimedAt = new Date(Date.now() + 1_000);
      await sql`
        update email_deliveries
        set status = 'processing', claimed_at = ${retryClaimedAt.toISOString()}::timestamptz,
            next_retry_at = null
        where id = ${invitationDeliveryId}
      `;
      const retryResult = await deliverQueuedEmail({
        id: invitationDeliveryId,
        claimedAt: retryClaimedAt,
      });
      assert.equal(retryResult?.status, "delivered");
      assert.equal(retryResult?.attempt, 2);
      assert.equal(requestBodies.length, 2);
      assert.equal(requestBodies[1], requestBodies[0]);
      assert.doesNotMatch(requestBodies[1]!, /CHANGED TEMPLATE|Changed Academy/);
      const [afterRetry] = await sql<Array<{ payload: Ciphertext }>>`
        select payload from email_deliveries
        where id = ${invitationDeliveryId}
      `;
      assert.ok(afterRetry);
      assert.deepEqual(afterRetry.payload, firstCiphertext);

      await sql`
        update users set status = 'active'
        where id = ${memberId} and organization_id = ${organizationId}
      `;
      const orderedDeliveryId = randomUUID();
      const orderedClaimedAt = new Date(Date.now() + 1_100);
      const orderedSource = {
        message: "Stored request order must survive every retry.",
        subject: "Stored request order",
        locale: "de",
      };
      const frozenBranding = firstSnapshot.gatewayRequest.tenantBranding;
      const intentionallyOrderedBranding = {
        locale: frozenBranding.locale,
        logoDarkUrl: frozenBranding.logoDarkUrl,
        logoLightUrl: frozenBranding.logoLightUrl,
        logoUrl: frozenBranding.logoUrl,
        senderName: frozenBranding.senderName,
        accentColor: frozenBranding.accentColor,
        primaryColor: frozenBranding.primaryColor,
        platformName: frozenBranding.platformName,
        name: frozenBranding.name,
        organizationId: frozenBranding.organizationId,
      };
      const intentionallyOrderedRequest = {
        tenantBranding: intentionallyOrderedBranding,
        message: orderedSource.message,
        subject: orderedSource.subject,
        email: memberEmail,
        event: "feedback.reply" as const,
      };
      const intentionallyOrderedEnvelope = {
        gatewayRequest: intentionallyOrderedRequest,
        source: orderedSource,
        schemaVersion: 1,
      };
      const orderedRequestBody = JSON.stringify(intentionallyOrderedRequest);
      const orderedCiphertext = encryptPayload(
        JSON.stringify(intentionallyOrderedEnvelope),
        `email-delivery:${orderedDeliveryId}`,
      );
      const orderedRoundTrip = parseEmailDeliveryPayload({
        event: "feedback.reply",
        email: memberEmail,
        organizationId,
        payload: JSON.parse(
          decryptPayload(
            orderedCiphertext,
            `email-delivery:${orderedDeliveryId}`,
          ),
        ),
      });
      assert.equal(orderedRoundTrip.kind, "snapshot");
      if (orderedRoundTrip.kind !== "snapshot") {
        assert.fail("Ordered snapshot missing.");
      }
      assert.equal(
        JSON.stringify(orderedRoundTrip.gatewayRequest),
        orderedRequestBody,
      );
      await sql`
        insert into email_deliveries (
          id, organization_id, user_id, event, category, recipient_email,
          payload, status, claimed_at
        ) values (
          ${orderedDeliveryId}, ${organizationId}, ${memberId},
          'feedback.reply', 'feedback', ${memberEmail},
          ${sql.json(orderedCiphertext)},
          'processing', ${orderedClaimedAt.toISOString()}::timestamptz
        )
      `;
      const orderedResult = await deliverQueuedEmail({
        id: orderedDeliveryId,
        claimedAt: orderedClaimedAt,
      });
      assert.equal(orderedResult?.status, "delivered");
      assert.equal(requestBodies.at(-1), orderedRequestBody);
      const [storedOrdered] = await sql<Array<{ payload: Ciphertext }>>`
        select payload from email_deliveries where id = ${orderedDeliveryId}
      `;
      assert.deepEqual(storedOrdered?.payload, orderedCiphertext);

      const detailDeliveryId = randomUUID();
      const detailSource = {
        subject: "Source-only subject",
        message: "SOURCE_ONLY_MARKER",
        locale: "de" as const,
      };
      const detailGatewayRequest = {
        event: "feedback.reply" as const,
        email: memberEmail,
        subject: detailSource.subject,
        message: detailSource.message,
        tenantBranding: {
          ...firstSnapshot.gatewayRequest.tenantBranding,
          platformName: "GATEWAY_BRANDING_ONLY_MARKER",
        },
      };
      const detailEnvelope = createEmailDeliveryPayloadEnvelope({
        event: "feedback.reply",
        email: memberEmail,
        organizationId,
        source: detailSource,
        gatewayRequest: detailGatewayRequest,
      });
      const detailCiphertext = encryptPayload(
        JSON.stringify(detailEnvelope),
        `email-delivery:${detailDeliveryId}`,
      );
      await sql`
        insert into email_deliveries (
          id, organization_id, user_id, event, category, recipient_email,
          payload, status, attempt, response_body
        ) values (
          ${detailDeliveryId}, ${organizationId}, ${memberId},
          'feedback.reply', 'feedback', ${memberEmail},
          ${sql.json(detailCiphertext)}, 'failed', 2,
          'Die E-Mail-Zustellung ist fehlgeschlagen.'
        )
      `;
      const detail = await getEmailDeliveryDetail(
        organizationId,
        detailDeliveryId,
      );
      assert.equal(detail.content.available, true);
      if (!detail.content.available) assert.fail("Detail content missing.");
      assert.equal(detail.content.subject, detailSource.subject);
      assert.equal(detail.content.message, detailSource.message);
      assert.doesNotMatch(
        JSON.stringify(detail),
        /GATEWAY_BRANDING_ONLY_MARKER/,
      );
      assert.equal("gatewayRequest" in detail, false);

      const manualRetry = await db.transaction((tx) =>
        retryFailedEmailDelivery(tx, {
          organizationId,
          actorUserId: ownerId,
          deliveryId: detailDeliveryId,
          source: "api",
        }),
      );
      assert.equal(manualRetry.delivery.status, "pending");
      const [afterManualRetry] = await sql<Array<{ payload: Ciphertext }>>`
        select payload from email_deliveries where id = ${detailDeliveryId}
      `;
      assert.deepEqual(afterManualRetry?.payload, detailCiphertext);
      const retriedDetail = await getEmailDeliveryDetail(
        organizationId,
        detailDeliveryId,
      );
      assert.equal(retriedDetail.content.available, true);
      if (!retriedDetail.content.available) {
        assert.fail("Retried detail content missing.");
      }
      assert.equal(retriedDetail.content.message, detailSource.message);

      const postFreezeRaceDeliveryId = randomUUID();
      const postFreezeRaceClaimedAt = new Date(Date.now() + 1_250);
      const postFreezeRaceSource = {
        subject: "Post-freeze preference race",
        message: "This frozen request must not reach the provider.",
        locale: "de",
      };
      const postFreezeLegacyCiphertext = encryptPayload(
        JSON.stringify(postFreezeRaceSource),
        `email-delivery:${postFreezeRaceDeliveryId}`,
      );
      await sql`
        insert into email_deliveries (
          id, organization_id, user_id, event, category, recipient_email,
          payload, status, claimed_at
        ) values (
          ${postFreezeRaceDeliveryId}, ${organizationId}, ${memberId},
          'feedback.reply', 'feedback', ${memberEmail},
          ${sql.json(postFreezeLegacyCiphertext)},
          'processing', ${postFreezeRaceClaimedAt.toISOString()}::timestamptz
        )
      `;
      let postFreezeHookCalls = 0;
      const callsBeforePostFreezeRace = requestBodies.length;
      const postFreezeRaceResult = await deliverQueuedEmail(
        {
          id: postFreezeRaceDeliveryId,
          claimedAt: postFreezeRaceClaimedAt,
        },
        {
          afterSnapshotFreezeBeforeFinalRevalidation: async () => {
            postFreezeHookCalls += 1;
            await sql`
              insert into user_notification_preferences (
                organization_id, user_id, category, email_enabled, push_enabled
              ) values (
                ${organizationId}, ${memberId}, 'feedback', false, true
              )
              on conflict (organization_id, user_id, category)
              do update set email_enabled = false
            `;
          },
        },
      );
      assert.equal(postFreezeHookCalls, 1);
      assert.equal(postFreezeRaceResult?.status, "failed");
      assert.equal(
        postFreezeRaceResult?.responseBody,
        "Durch Benachrichtigungseinstellungen unterdrueckt.",
      );
      assert.equal(requestBodies.length, callsBeforePostFreezeRace);
      const [afterPostFreezeRace] = await sql<
        Array<{ payload: Ciphertext }>
      >`
        select payload from email_deliveries
        where id = ${postFreezeRaceDeliveryId}
      `;
      assert.notDeepEqual(
        afterPostFreezeRace?.payload,
        postFreezeLegacyCiphertext,
      );
      assert.equal(
        parseEmailDeliveryPayload({
          event: "feedback.reply",
          email: memberEmail,
          organizationId,
          payload: JSON.parse(
            decryptPayload(
              afterPostFreezeRace!.payload,
              `email-delivery:${postFreezeRaceDeliveryId}`,
            ),
          ),
        }).kind,
        "snapshot",
      );
      await sql`
        update user_notification_preferences set email_enabled = true
        where organization_id = ${organizationId}
          and user_id = ${memberId} and category = 'feedback'
      `;

      const reEncryptionDeliveryId = randomUUID();
      const reEncryptionClaimedAt = new Date(Date.now() + 1_500);
      const reEncryptionSource = {
        link: "https://academy.example.test/password/reset?token=rotation-race",
        locale: "de",
      };
      const initialReEncryptionCiphertext = encryptPayload(
        JSON.stringify(reEncryptionSource),
        `email-delivery:${reEncryptionDeliveryId}`,
      );
      await sql`
        insert into email_deliveries (
          id, organization_id, user_id, event, category, recipient_email,
          payload, status, claimed_at
        ) values (
          ${reEncryptionDeliveryId}, ${organizationId}, ${memberId},
          'password.reset', 'system', ${memberEmail},
          ${sql.json(initialReEncryptionCiphertext)},
          'processing', ${reEncryptionClaimedAt.toISOString()}::timestamptz
        )
      `;
      let rotatedCiphertext: Ciphertext | null = null;
      const callsBeforeReEncryption = requestBodies.length;
      const reEncryptionResult = await deliverQueuedEmail(
        {
          id: reEncryptionDeliveryId,
          claimedAt: reEncryptionClaimedAt,
        },
        {
          beforeProviderRevalidation: async () => {
            rotatedCiphertext = encryptPayload(
              JSON.stringify(reEncryptionSource),
              `email-delivery:${reEncryptionDeliveryId}`,
            );
            await sql`
              update email_deliveries set payload = ${sql.json(rotatedCiphertext)}
              where id = ${reEncryptionDeliveryId}
                and status = 'processing'
                and claimed_at = ${reEncryptionClaimedAt.toISOString()}::timestamptz
            `;
          },
        },
      );
      assert.equal(reEncryptionResult, null);
      assert.ok(rotatedCiphertext);
      assert.notDeepEqual(rotatedCiphertext, initialReEncryptionCiphertext);
      assert.equal(requestBodies.length, callsBeforeReEncryption);
      const [afterReEncryption] = await sql<
        Array<{ payload: Ciphertext; status: string }>
      >`
        select payload, status from email_deliveries
        where id = ${reEncryptionDeliveryId}
      `;
      assert.equal(afterReEncryption?.status, "processing");
      assert.deepEqual(afterReEncryption?.payload, rotatedCiphertext);
      assert.deepEqual(
        parseEmailDeliveryPayload({
          event: "password.reset",
          email: memberEmail,
          organizationId,
          payload: JSON.parse(
            decryptPayload(
              afterReEncryption!.payload,
              `email-delivery:${reEncryptionDeliveryId}`,
            ),
          ),
        }),
        { kind: "legacy", source: reEncryptionSource },
      );

      const mismatchDeliveryId = randomUUID();
      const mismatchClaimedAt = new Date(Date.now() + 2_000);
      const mismatchEnvelope = {
        ...detailEnvelope,
        gatewayRequest: {
          ...detailGatewayRequest,
          email: "other@example.test",
        },
      };
      await sql`
        insert into email_deliveries (
          id, organization_id, user_id, event, category, recipient_email,
          payload, status, claimed_at
        ) values (
          ${mismatchDeliveryId}, ${organizationId}, ${memberId},
          'feedback.reply', 'feedback', ${memberEmail},
          ${sql.json(
            encryptPayload(
              JSON.stringify(mismatchEnvelope),
              `email-delivery:${mismatchDeliveryId}`,
            ),
          )},
          'processing', ${mismatchClaimedAt.toISOString()}::timestamptz
        )
      `;
      const callsBeforeMismatch = requestBodies.length;
      const mismatchResult = await deliverQueuedEmail({
        id: mismatchDeliveryId,
        claimedAt: mismatchClaimedAt,
      });
      assert.equal(mismatchResult?.status, "retrying");
      assert.equal(requestBodies.length, callsBeforeMismatch);

      const suppressionRaceDeliveryId = randomUUID();
      const suppressionRaceClaimedAt = new Date(Date.now() + 3_000);
      const suppressionRaceSource = {
        subject: "Suppression race",
        message: "This request must never be frozen or sent.",
        locale: "de",
      };
      const suppressionRaceCiphertext = encryptPayload(
        JSON.stringify(suppressionRaceSource),
        `email-delivery:${suppressionRaceDeliveryId}`,
      );
      await sql`
        insert into email_deliveries (
          id, organization_id, user_id, event, category, recipient_email,
          payload, status, claimed_at
        ) values (
          ${suppressionRaceDeliveryId}, ${organizationId}, ${memberId},
          'feedback.reply', 'feedback', ${memberEmail},
          ${sql.json(suppressionRaceCiphertext)},
          'processing', ${suppressionRaceClaimedAt.toISOString()}::timestamptz
        )
      `;
      let suppressionHookCalls = 0;
      const callsBeforeSuppression = requestBodies.length;
      const suppressionResult = await deliverQueuedEmail(
        {
          id: suppressionRaceDeliveryId,
          claimedAt: suppressionRaceClaimedAt,
        },
        {
          beforeProviderRevalidation: async () => {
            suppressionHookCalls += 1;
            const now = new Date();
            await sql`
              insert into email_suppressions (
                organization_id, user_id, recipient_hash, reason,
                first_occurred_at, last_occurred_at, source_delivery_id
              ) values (
                ${organizationId}, ${memberId},
                ${privacyEmailRecipientReference(organizationId, memberEmail)},
                'hard_bounce', ${now.toISOString()}::timestamptz,
                ${now.toISOString()}::timestamptz, ${suppressionRaceDeliveryId}
              )
            `;
          },
        },
      );
      assert.equal(suppressionHookCalls, 1);
      assert.equal(suppressionResult?.status, "failed");
      assert.equal(
        suppressionResult?.responseBody,
        "Die E-Mail wurde wegen einer aktiven Empfaengersperre nicht zugestellt.",
      );
      assert.equal(requestBodies.length, callsBeforeSuppression);
      const [afterSuppressionRace] = await sql<
        Array<{ payload: Ciphertext }>
      >`
        select payload from email_deliveries
        where id = ${suppressionRaceDeliveryId}
      `;
      assert.deepEqual(afterSuppressionRace?.payload, suppressionRaceCiphertext);
      assert.deepEqual(
        parseEmailDeliveryPayload({
          event: "feedback.reply",
          email: memberEmail,
          organizationId,
          payload: JSON.parse(
            decryptPayload(
              afterSuppressionRace!.payload,
              `email-delivery:${suppressionRaceDeliveryId}`,
            ),
          ),
        }),
        { kind: "legacy", source: suppressionRaceSource },
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalDeliveryUrl === undefined) {
        delete process.env.EMAIL_DELIVERY_WEBHOOK_URL;
      } else {
        process.env.EMAIL_DELIVERY_WEBHOOK_URL = originalDeliveryUrl;
      }
      await sql`delete from organizations where id = ${organizationId}`;
      await applicationClient?.end();
      await sql.end();
    }
  },
);

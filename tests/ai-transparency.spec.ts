import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { getSettingsAdminCopy } from "@/lib/i18n/settings-admin";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

test("tenant legal links and first external AI use are enforced end to end", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Lifecycle runs once.");
  test.setTimeout(90_000);
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const settingsCopy = getSettingsAdminCopy("de");
  const suffix = randomUUID();
  const privacyPolicyUrl = `https://privacy.customer.test/${suffix}`;
  const transparencyPolicyUrl = `https://privacy.customer.test/ai/${suffix}`;
  const question = `Welche Kurse sind fuer mich verfuegbar? ${suffix}`;
  let organizationId = "";
  let memberId = "";
  let originalDesign: Record<string, unknown> | null = null;
  let originalConversationCount = 0;

  try {
    const [fixture] = await sql<
      Array<{
        organizationId: string;
        memberId: string;
        design: Record<string, unknown> | null;
        conversations: number;
      }>
    >`
      select organization.id as "organizationId",
             member.id as "memberId",
             setting.value as design,
             (
               select count(*)::int from ai_conversations conversation
               where conversation.organization_id = organization.id
                 and conversation.user_id = member.id
             ) as conversations
      from organizations organization
      join users member
        on member.organization_id = organization.id
       and member.email = 'lea@q-academy.de'
       and member.status = 'active'
      left join platform_settings setting
        on setting.organization_id = organization.id
       and setting.key = 'design'
      where organization.slug = 'q-academy'
      limit 1
    `;
    if (!fixture) throw new Error("Demo tenant is missing.");
    organizationId = fixture.organizationId;
    memberId = fixture.memberId;
    originalDesign = fixture.design;
    originalConversationCount = fixture.conversations;

    await page.goto("/login");
    await page
      .getByRole("button", { name: /Admin-Demo|Als Admin testen/i })
      .click();
    await page.waitForURL("**/admin");
    await page.goto("/admin/settings#datenschutz");

    await page
      .getByLabel("Datenschutzhinweis-URL")
      .fill("http://privacy.customer.test/insecure");
    await page.getByRole("button", { name: "Design speichern" }).click();
    await expect(
      page.getByText(settingsCopy.messages.designLegalUrlInvalid, { exact: true }),
    ).toBeVisible();

    await page.getByLabel("Datenschutzhinweis-URL").fill(privacyPolicyUrl);
    await page
      .getByLabel("KI-Transparenzseite-URL")
      .fill(transparencyPolicyUrl);
    await page.getByRole("button", { name: "Design speichern" }).click();
    await expect(page.getByText("Design gespeichert.", { exact: true })).toBeVisible();

    const [storedDesign] = await sql<
      Array<{ value: Record<string, unknown>; metadata: Record<string, unknown> }>
    >`
      select setting.value,
             event.metadata
      from platform_settings setting
      join activity_events event
        on event.organization_id = setting.organization_id
       and event.type = 'platform.design.updated'
       and event.metadata ->> 'privacyPolicyUrl' = ${privacyPolicyUrl}
      where setting.organization_id = ${organizationId}
        and setting.key = 'design'
      order by event.created_at desc
      limit 1
    `;
    expect(storedDesign.value).toMatchObject({
      privacyPolicyUrl,
      aiTransparencyUrl: transparencyPolicyUrl,
    });
    expect(storedDesign.metadata).toMatchObject({
      privacyPolicyUrl,
      aiTransparencyUrl: transparencyPolicyUrl,
    });

    await page.context().clearCookies();
    await page.goto("/login");
    await expect(page.getByRole("link", { name: "Datenschutz" })).toHaveAttribute(
      "href",
      privacyPolicyUrl,
    );
    await page
      .getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/i })
      .click();
    await page.waitForURL("**/academy");
    await completeMemberWelcomeIfVisible(page);

    const initial = await page.evaluate(async () => {
      const response = await fetch("/api/ai/transparency", {
        cache: "no-store",
      });
      return { status: response.status, body: await response.json() };
    });
    expect(initial.status).toBe(200);
    const initialData = initial.body.data as {
      required: boolean;
      notice: { digest: string; version: number };
    };
    expect(initialData.required).toBe(true);

    const spoofed = await page.evaluate(async ({ digest }) => {
      const response = await fetch("/api/ai/transparency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noticeDigest: digest,
          organizationId: "00000000-0000-0000-0000-000000000000",
        }),
      });
      return { status: response.status, body: await response.json() };
    }, { digest: initialData.notice.digest });
    expect(spoofed.status).toBe(422);
    expect(spoofed.body.code).toBe("validation_error");

    const blocked = await page.evaluate(async () => {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Diese Nachricht darf nicht zum Provider." }),
      });
      return { status: response.status, body: await response.json() };
    });
    expect(blocked).toMatchObject({
      status: 428,
      body: { code: "precondition_required" },
    });
    const [afterBlocked] = await sql<Array<{ conversations: number }>>`
      select count(*)::int as conversations
      from ai_conversations
      where organization_id = ${organizationId}
        and user_id = ${memberId}
    `;
    expect(afterBlocked.conversations).toBe(originalConversationCount);

    await page.goto("/academy/ai");
    await expect(
      page.getByRole("heading", { name: "Hinweis zur externen KI-Verarbeitung" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Datenschutzhinweis/ })).toHaveAttribute(
      "href",
      privacyPolicyUrl,
    );
    await expect(page.getByRole("link", { name: /KI-Transparenzseite/ })).toHaveAttribute(
      "href",
      transparencyPolicyUrl,
    );
    const input = page.getByRole("textbox", { name: "Nachricht an den Q-Coach" });
    await expect(input).toBeDisabled();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("ai-transparency-mobile.png"),
      fullPage: true,
    });

    await page
      .getByRole("button", { name: "Verstanden, Q-Coach starten" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Hinweis zur externen KI-Verarbeitung" }),
    ).toHaveCount(0);
    await expect(input).toBeEnabled();
    await page.getByRole("button", { name: "Neuer Chat" }).click();
    await input.fill(question);
    await page.getByRole("button", { name: "Nachricht senden" }).click();
    await expect(
      page.getByRole("log", { name: "Konversationsverlauf" }).getByText(
        "Dir sind aktuell diese Kurse freigeschaltet:",
      ),
    ).toBeVisible();

    const acknowledgements = await sql<
      Array<{
        id: string;
        noticeVersion: number;
        noticeDigest: string;
        privacyPolicyUrl: string;
        transparencyPolicyUrl: string;
        auditCount: number;
      }>
    >`
      select acknowledgement.id,
             acknowledgement.notice_version as "noticeVersion",
             acknowledgement.notice_digest as "noticeDigest",
             acknowledgement.privacy_policy_url as "privacyPolicyUrl",
             acknowledgement.transparency_policy_url as "transparencyPolicyUrl",
             count(event.id)::int as "auditCount"
      from ai_external_use_acknowledgements acknowledgement
      left join activity_events event
        on event.organization_id = acknowledgement.organization_id
       and event.entity_id = acknowledgement.id
       and event.type = 'ai.external_use.acknowledged'
      where acknowledgement.organization_id = ${organizationId}
        and acknowledgement.user_id = ${memberId}
        and acknowledgement.notice_digest = ${initialData.notice.digest}
      group by acknowledgement.id
    `;
    expect(acknowledgements).toHaveLength(1);
    expect(acknowledgements[0]).toMatchObject({
      noticeVersion: initialData.notice.version,
      noticeDigest: initialData.notice.digest,
      privacyPolicyUrl,
      transparencyPolicyUrl,
      auditCount: 1,
    });

    const repeated = await page.evaluate(async ({ digest }) => {
      const response = await fetch("/api/ai/transparency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noticeDigest: digest }),
      });
      return response.status;
    }, { digest: initialData.notice.digest });
    expect(repeated).toBe(200);
    await page.reload();
    await expect(input).toBeEnabled();
    await expect(
      page.getByRole("heading", { name: "Hinweis zur externen KI-Verarbeitung" }),
    ).toHaveCount(0);
  } finally {
    if (organizationId && memberId) {
      await sql`
        delete from activity_events
        where organization_id = ${organizationId}
          and (
            (type = 'platform.design.updated'
              and metadata ->> 'privacyPolicyUrl' = ${privacyPolicyUrl})
            or
            (type = 'ai.external_use.acknowledged'
              and metadata ->> 'privacyPolicyUrl' = ${privacyPolicyUrl})
          )
      `;
      await sql`
        delete from ai_external_use_acknowledgements
        where organization_id = ${organizationId}
          and user_id = ${memberId}
          and privacy_policy_url = ${privacyPolicyUrl}
      `;
      await sql`
        delete from ai_conversations
        where organization_id = ${organizationId}
          and user_id = ${memberId}
          and id in (
            select conversation_id
            from ai_messages
            where organization_id = ${organizationId}
              and content = ${question}
          )
      `;
      if (originalDesign) {
        await sql`
          update platform_settings
          set value = ${sql.json(originalDesign as never)}, updated_at = now()
          where organization_id = ${organizationId}
            and key = 'design'
        `;
      } else {
        await sql`
          delete from platform_settings
          where organization_id = ${organizationId}
            and key = 'design'
        `;
      }
    }
    await sql.end();
  }
});

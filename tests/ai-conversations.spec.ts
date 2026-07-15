import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { getAiMemberCopy } from "../src/lib/i18n/ai-member";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";
import { acknowledgeAiTransparency } from "./helpers/ai-transparency";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const memberCopy = getAiMemberCopy("de");

async function resetMemberConversations() {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await client`
      delete from ai_conversations
      where user_id = (select id from users where email = 'lea@q-academy.de' limit 1)
    `;
  } finally {
    await client.end();
  }
}

async function storedConversationSummary() {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    return await client`
      select
        c.title,
        c.message_count,
        count(m.id)::int as stored_message_count,
        count(m.id) filter (where m.role = 'assistant' and m.provider is not null)::int as assistant_count,
        min(m.input_tokens) filter (where m.role = 'assistant')::int as min_input_tokens,
        min(m.latency_ms) filter (where m.role = 'assistant')::int as min_latency_ms
      from ai_conversations c
      join users u on u.id = c.user_id
      left join ai_messages m on m.conversation_id = c.id
      where u.email = 'lea@q-academy.de'
      group by c.id
      order by c.created_at asc
    `;
  } finally {
    await client.end();
  }
}

test("Q-Coach persists conversations and restores selectable history", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "targeted desktop AI conversation flow",
  );
  await resetMemberConversations();

  await page.goto("/login");
  await page
    .getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ })
    .click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
  await acknowledgeAiTransparency(page);
  const bootstrapResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/ai",
  );
  await page.goto("/academy/ai");
  const bootstrapResponse = await bootstrapResponsePromise;
  expect(bootstrapResponse.status()).toBe(200);

  const input = page.getByRole("textbox", { name: "Nachricht an den Q-Coach" });
  const transcript = page.getByRole("log", { name: "Konversationsverlauf" });
  const sendButton = page.getByRole("button", { name: "Nachricht senden" });
  const coursePrompt = "Welche Kurse sind fuer mich verfuegbar?";
  await expect(transcript).toHaveAttribute("aria-busy", "false");
  await expect(input).toBeEnabled();
  await input.fill(coursePrompt);
  await expect(input).toHaveValue(coursePrompt);
  await expect(sendButton).toBeEnabled();
  await sendButton.click();
  await expect(
    transcript.getByText("Dir sind aktuell diese Kurse freigeschaltet:"),
  ).toBeVisible();
  await expect(transcript.getByText(/KI-Grundlagen \(155 Min\./)).toBeVisible();

  await page.reload();
  await expect(
    transcript.getByText(coursePrompt, { exact: true }),
  ).toBeVisible();
  await expect(
    transcript.getByText("Dir sind aktuell diese Kurse freigeschaltet:"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Neuer Chat" }).click();
  const planPrompt = "Erstelle mir einen Lernplan";
  await input.fill(planPrompt);
  await expect(input).toHaveValue(planPrompt);
  await expect(sendButton).toBeEnabled();
  await sendButton.click();
  await expect(
    transcript.getByText(
      /Ein praktikabler Lernplan nutzt drei kurze Einheiten/,
    ),
  ).toBeVisible();

  const history = page.getByRole("navigation", { name: "KI-Konversationen" });
  await history
    .getByRole("button", { name: /Welche Kurse sind fuer mich verfuegbar/ })
    .click();
  await expect(
    transcript.getByText(coursePrompt, { exact: true }),
  ).toBeVisible();
  await expect(
    transcript.getByText("Dir sind aktuell diese Kurse freigeschaltet:"),
  ).toBeVisible();

  await page.goto("/academy");
  await page.getByRole("button", { name: memberCopy.concierge.open }).click();
  const compactHistory = page.getByRole("combobox", {
    name: memberCopy.concierge.selectConversation,
  });
  await expect(compactHistory).toBeVisible();
  await compactHistory.selectOption({
    label: "Welche Kurse sind fuer mich verfuegbar?",
  });
  const compactTranscript = page.getByRole("log", {
    name: memberCopy.concierge.compactLog,
  });
  await expect(
    compactTranscript.getByText(coursePrompt, { exact: true }),
  ).toBeVisible();
  await expect(
    compactTranscript.getByText("Dir sind aktuell diese Kurse freigeschaltet:"),
  ).toBeVisible();

  const stored = await storedConversationSummary();
  expect(stored).toHaveLength(2);
  expect(stored.map((row) => row.message_count)).toEqual([2, 2]);
  expect(stored.map((row) => row.stored_message_count)).toEqual([2, 2]);
  expect(stored.map((row) => row.assistant_count)).toEqual([1, 1]);
  expect(stored.every((row) => row.min_input_tokens >= 1)).toBe(true);
  expect(stored.every((row) => row.min_latency_ms >= 0)).toBe(true);
});

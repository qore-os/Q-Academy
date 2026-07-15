import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  formatSubmissionReviewScore,
  formatSubmissionReviewTime,
  getSubmissionReviewCopy,
  resolveSubmissionReviewMessage,
} from "../src/lib/i18n/submission-review";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

function flatten(value: unknown, prefix = "", result = new Map<string, string>()) {
  if (typeof value === "string") result.set(prefix, value);
  else if (typeof value === "function") result.set(prefix, String(value(2, 5)));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

test("submission review copy has complete DE/EN/IT/ES/FR parity", () => {
  const german = flatten(getSubmissionReviewCopy("de"));
  assert.ok(german.size >= 55, `expected at least 55 leaves, got ${german.size}`);
  for (const locale of SUPPORTED_LOCALES) {
    const localized = flatten(getSubmissionReviewCopy(locale));
    assert.deepEqual([...localized.keys()], [...german.keys()]);
    assert.ok([...localized.values()].every((value) => value.trim().length > 0));
    if (locale !== "de") {
      const changed = [...localized].filter(
        ([key, value]) => value !== german.get(key),
      ).length;
      assert.ok(changed >= 50, `${locale} changes only ${changed}/${german.size}`);
    }
  }
});

test("submission review formatting and message codes follow locale", () => {
  const date = new Date("2026-07-13T10:05:00.000Z");
  assert.equal(formatSubmissionReviewTime("de", date), "12:05");
  assert.equal(formatSubmissionReviewTime("en", date), "12:05");
  assert.match(formatSubmissionReviewScore("de", 85), /85\s?%/);
  assert.equal(formatSubmissionReviewScore("en", 85), "85%");
  assert.equal(resolveSubmissionReviewMessage("de", "approved"), "Abgabe freigegeben.");
  assert.equal(resolveSubmissionReviewMessage("it", "approved"), "Consegna approvata.");
  assert.equal(
    getSubmissionReviewCopy("en").notification.approvedBody(
      "Security Basics",
      2,
      "85%",
    ),
    "Security Basics: Attempt 2 was approved with a score of 85%.",
  );
  assert.equal(
    getSubmissionReviewCopy("fr").notification.revisionTitle,
    "Revision demandee",
  );
});

test("submission center and annotation composer propagate locale", () => {
  const center = readFileSync("src/components/admin/submission-center.tsx", "utf8");
  const composer = readFileSync(
    "src/components/admin/submission-annotation-composer.tsx",
    "utf8",
  );
  const page = readFileSync("src/app/(admin)/admin/tasks/page.tsx", "utf8");

  assert.match(page, /SubmissionCenter submissions=\{visibleSubmissions\} locale=\{locale\}/);
  assert.match(center, /<SubmissionAnnotationComposer[\s\S]{0,500}?locale=\{locale\}/);
  assert.match(center, /<SubmissionReviewAnnotations[\s\S]{0,180}?locale=\{locale\}/);
  assert.match(composer, /SubmissionAttachmentLinks attachments=\{attachments\} locale=\{locale\}/);
  assert.doesNotMatch(center, /locale="de"/);
  assert.doesNotMatch(center, /submissionStatusLabels/);
  assert.doesNotMatch(center, />\{state\.error\}</);
  assert.doesNotMatch(center, />\{state\.success\}</);
  assert.doesNotMatch(composer, /setMessage\("/);
});

test("admin dashboard uses localized submission status labels", () => {
  const dashboard = readFileSync("src/app/(admin)/admin/page.tsx", "utf8");

  assert.match(
    dashboard,
    /getSubmissionReviewCopy\(locale\)\.center\.statuses/,
  );
  assert.match(dashboard, /submissionStatusCopy\[submission\.status\]/);
  assert.doesNotMatch(dashboard, /submissionStatusLabels/);
});

test("submission review action returns stable message codes", () => {
  const actions = readFileSync("src/lib/actions.ts", "utf8");
  const block = actions.slice(
    actions.indexOf("export async function reviewSubmissionAction"),
    actions.indexOf("export async function createMemberAction"),
  );
  for (const code of [
    "invalid_annotations",
    "invalid_input",
    "forbidden",
    "approved",
    "revision_requested",
    "save_failed",
  ]) {
    assert.ok(block.includes(`"${code}"`), `missing submission code ${code}`);
  }
  assert.doesNotMatch(block, /return \{ error: error\.message \}/);
});

test("submission review notifications resolve the recipient locale", () => {
  const service = readFileSync("src/lib/submissions.ts", "utf8");

  assert.match(service, /resolveRecipientLocale\(transaction,/);
  assert.match(
    service,
    /getSubmissionReviewCopy\(recipientLocale\)\.notification/,
  );
  assert.match(service, /formatSubmissionReviewScore\(recipientLocale, input\.score\)/);
  assert.doesNotMatch(service, /title:\s*"Abgabe freigegeben"/);
  assert.doesNotMatch(service, /title:\s*"Ueberarbeitung angefordert"/);
});

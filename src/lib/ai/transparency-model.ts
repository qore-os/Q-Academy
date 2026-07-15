import { createHash } from "node:crypto";

export const AI_EXTERNAL_USE_NOTICE_VERSION = 2;

export const AI_EXTERNAL_USE_NOTICE = Object.freeze({
  title: "Hinweis zur externen KI-Verarbeitung",
  description:
    "Fuer KI-Antworten koennen deine Eingabe, der bisherige Chatverlauf, passende freigegebene Lerninhalte und vom Academy-Admin ausdruecklich ausgewaehlte, fuer dich sichtbare Profilfelder an einen extern betriebenen KI-Dienst uebermittelt werden.",
  warning:
    "Gib keine besonderen Kategorien personenbezogener Daten, Geheimnisse oder vertraulichen Kundendaten ein. KI-Antworten koennen fehlerhaft sein und muessen fachlich geprueft werden.",
});

export type AiTransparencyNoticeInput = {
  privacyPolicyUrl: string | null;
  transparencyPolicyUrl: string | null;
};

export function aiTransparencyNoticeDigest(
  input: AiTransparencyNoticeInput,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 1,
        noticeVersion: AI_EXTERNAL_USE_NOTICE_VERSION,
        ...AI_EXTERNAL_USE_NOTICE,
        privacyPolicyUrl: input.privacyPolicyUrl,
        transparencyPolicyUrl: input.transparencyPolicyUrl,
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildAiTransparencyNotice(
  input: AiTransparencyNoticeInput,
) {
  return {
    version: AI_EXTERNAL_USE_NOTICE_VERSION,
    digest: aiTransparencyNoticeDigest(input),
    ...AI_EXTERNAL_USE_NOTICE,
    ...input,
  };
}

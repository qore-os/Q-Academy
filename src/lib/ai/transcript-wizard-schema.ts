import { z } from "zod";

import {
  generatedCourseBlockSchema,
  type GeneratedCourseBlock,
} from "@/lib/ai/course-draft-schema";
import {
  sanitizeVideoTranscriptDocument,
  type VideoTranscriptDocument,
} from "@/lib/content-blocks/video-transcript";
import { getCourseParityCopy } from "@/lib/i18n/course-parity";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";

export const transcriptWizardOperationSchema = z.enum([
  "summary",
  "multiple_choice",
  "true_false",
  "multi_select",
  "fill_blank",
  "ordering",
  "mixed",
]);

export type TranscriptWizardOperation = z.infer<
  typeof transcriptWizardOperationSchema
>;

export const MAX_TRANSCRIPT_WIZARD_INSTRUCTION_LENGTH = 500;

const INSTRUCTION_CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export const transcriptWizardInstructionSchema = z
  .string()
  .max(MAX_TRANSCRIPT_WIZARD_INSTRUCTION_LENGTH)
  .transform((value) =>
    value
      .normalize("NFKC")
      .replace(/\r\n?/g, "\n")
      .replace(INSTRUCTION_CONTROL_CHARACTERS, "")
      .trim(),
  )
  .pipe(
    z
      .string()
      .max(MAX_TRANSCRIPT_WIZARD_INSTRUCTION_LENGTH)
      .refine(
        (value) => value.length === 0 || Array.from(value).length >= 3,
        "Die eigene Anweisung muss leer sein oder mindestens drei Zeichen enthalten.",
      ),
  );

export const transcriptWizardGenerationRequestSchema = z
  .object({
    operation: transcriptWizardOperationSchema,
    instruction: transcriptWizardInstructionSchema.default(""),
  })
  .strict();

export const transcriptWizardResultSchema = z
  .object({
    blocks: z.array(generatedCourseBlockSchema).min(1).max(6),
  })
  .strict()
  .superRefine((result, context) => {
    for (const [index, block] of result.blocks.entries()) {
      if (
        ![
          "text",
          "multiple_choice",
          "true_false",
          "multi_select",
          "fill_blank",
          "ordering",
        ].includes(block.type)
      ) {
        context.addIssue({
          code: "custom",
          path: ["blocks", index, "type"],
          message: "Der Transkript-Wizard unterstuetzt diesen Blocktyp nicht.",
        });
      }
    }
  });

const stopWords: Record<AppLocale, ReadonlySet<string>> = {
  de: new Set(["aber", "auch", "dann", "dass", "deine", "dieser", "dieses", "einen", "einer", "eines", "haben", "immer", "keine", "kannst", "nicht", "oder", "sowie", "unter", "werden", "wurde", "zuerst"]),
  en: new Set(["about", "after", "again", "also", "because", "before", "could", "first", "from", "have", "into", "other", "should", "their", "there", "these", "they", "this", "those", "with", "would"]),
  it: new Set(["anche", "avere", "come", "dalla", "delle", "dopo", "essere", "prima", "questa", "questo", "senza", "sono", "sotto", "tutte", "tutto", "viene"]),
  es: new Set(["ademas", "antes", "aunque", "como", "despues", "desde", "donde", "estar", "haber", "hasta", "para", "porque", "puede", "sobre", "tambien", "tiene"]),
  fr: new Set(["ainsi", "alors", "apres", "aussi", "avant", "avec", "avoir", "comme", "dans", "depuis", "etre", "mais", "parce", "peut", "pour", "sans", "sous", "cette"]),
};

const questionCopy: Record<
  AppLocale,
  {
    multipleChoiceTitle: string;
    multipleChoicePrompt: (anchor: string) => string;
    multipleChoiceFeedback: (answer: string) => string;
    trueFalseTitle: string;
    trueFalsePrompt: (anchor: string, statement: string) => string;
    trueFalseFeedback: (isTrue: boolean, answer: string) => string;
    multiSelectTitle: string;
    multiSelectPrompt: (anchor: string) => string;
    multiSelectFeedback: (first: string, second: string) => string;
  }
> = {
  de: {
    multipleChoiceTitle: "Reihenfolge im Video",
    multipleChoicePrompt: (anchor) =>
      `Welche Aussage folgt im Video direkt auf: ${anchor}`,
    multipleChoiceFeedback: (answer) =>
      `Direkt danach behandelt das Video: ${answer}`,
    trueFalseTitle: "Aussage zum Videoablauf",
    trueFalsePrompt: (anchor, statement) =>
      `Wahr oder falsch: Direkt nach \"${anchor}\" folgt im Video \"${statement}\".`,
    trueFalseFeedback: (isTrue, answer) =>
      `${isTrue ? "Die Aussage ist wahr." : "Die Aussage ist falsch."} Der tatsaechlich naechste Abschnitt lautet: ${answer}`,
    multiSelectTitle: "Naechste Videoinhalte",
    multiSelectPrompt: (anchor) =>
      `Welche zwei Aussagen bilden die beiden naechsten Abschnitte nach: ${anchor}`,
    multiSelectFeedback: (first, second) =>
      `Die beiden naechsten Abschnitte lauten: ${first} / ${second}`,
  },
  en: {
    multipleChoiceTitle: "Sequence in the video",
    multipleChoicePrompt: (anchor) =>
      `Which statement follows directly after this part of the video: ${anchor}`,
    multipleChoiceFeedback: (answer) =>
      `The video continues directly with: ${answer}`,
    trueFalseTitle: "Video sequence statement",
    trueFalsePrompt: (anchor, statement) =>
      `True or false: In the video, \"${statement}\" follows directly after \"${anchor}\".`,
    trueFalseFeedback: (isTrue, answer) =>
      `${isTrue ? "The statement is true." : "The statement is false."} The actual next section is: ${answer}`,
    multiSelectTitle: "Next video sections",
    multiSelectPrompt: (anchor) =>
      `Which two statements are the next two sections after: ${anchor}`,
    multiSelectFeedback: (first, second) =>
      `The next two sections are: ${first} / ${second}`,
  },
  it: {
    multipleChoiceTitle: "Sequenza nel video",
    multipleChoicePrompt: (anchor) =>
      `Quale affermazione segue direttamente questa parte del video: ${anchor}`,
    multipleChoiceFeedback: (answer) =>
      `Il video prosegue direttamente con: ${answer}`,
    trueFalseTitle: "Affermazione sulla sequenza",
    trueFalsePrompt: (anchor, statement) =>
      `Vero o falso: Nel video, \"${statement}\" segue direttamente \"${anchor}\".`,
    trueFalseFeedback: (isTrue, answer) =>
      `${isTrue ? "L'affermazione e vera." : "L'affermazione e falsa."} La sezione effettivamente successiva e: ${answer}`,
    multiSelectTitle: "Sezioni successive del video",
    multiSelectPrompt: (anchor) =>
      `Quali due affermazioni sono le due sezioni successive dopo: ${anchor}`,
    multiSelectFeedback: (first, second) =>
      `Le due sezioni successive sono: ${first} / ${second}`,
  },
  es: {
    multipleChoiceTitle: "Secuencia del video",
    multipleChoicePrompt: (anchor) =>
      `Que afirmacion sigue directamente a esta parte del video: ${anchor}`,
    multipleChoiceFeedback: (answer) =>
      `El video continua directamente con: ${answer}`,
    trueFalseTitle: "Afirmacion sobre la secuencia",
    trueFalsePrompt: (anchor, statement) =>
      `Verdadero o falso: En el video, \"${statement}\" sigue directamente a \"${anchor}\".`,
    trueFalseFeedback: (isTrue, answer) =>
      `${isTrue ? "La afirmacion es verdadera." : "La afirmacion es falsa."} La seccion que sigue realmente es: ${answer}`,
    multiSelectTitle: "Siguientes secciones del video",
    multiSelectPrompt: (anchor) =>
      `Que dos afirmaciones son las dos secciones siguientes despues de: ${anchor}`,
    multiSelectFeedback: (first, second) =>
      `Las dos secciones siguientes son: ${first} / ${second}`,
  },
  fr: {
    multipleChoiceTitle: "Sequence de la video",
    multipleChoicePrompt: (anchor) =>
      `Quelle affirmation suit directement cette partie de la video : ${anchor}`,
    multipleChoiceFeedback: (answer) =>
      `La video continue directement avec : ${answer}`,
    trueFalseTitle: "Affirmation sur la sequence",
    trueFalsePrompt: (anchor, statement) =>
      `Vrai ou faux : Dans la video, \"${statement}\" suit directement \"${anchor}\".`,
    trueFalseFeedback: (isTrue, answer) =>
      `${isTrue ? "L'affirmation est vraie." : "L'affirmation est fausse."} La section reellement suivante est : ${answer}`,
    multiSelectTitle: "Sections suivantes de la video",
    multiSelectPrompt: (anchor) =>
      `Quelles affirmations sont les deux sections suivant directement : ${anchor}`,
    multiSelectFeedback: (first, second) =>
      `Les deux sections suivantes sont : ${first} / ${second}`,
  },
};

function clip(value: string, maximum: number) {
  const characters = Array.from(value.trim());
  if (characters.length <= maximum) return characters.join("");
  return `${characters.slice(0, maximum - 3).join("").trimEnd()}...`;
}

function comparable(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function evenlySpacedSegments(
  transcript: VideoTranscriptDocument,
  maximum: number,
) {
  const source = transcript.segments;
  if (source.length <= maximum) return source;
  const indexes = Array.from({ length: maximum }, (_, index) =>
    Math.round((index * (source.length - 1)) / (maximum - 1)),
  );
  return indexes.map((index) => source[index]!).filter(Boolean);
}

function uniqueTranscriptSegments(transcript: VideoTranscriptDocument) {
  return transcript.segments.filter(
    (segment, index, segments) =>
      segments.findIndex(
        (candidate) => comparable(candidate.text) === comparable(segment.text),
      ) === index,
  );
}

function instructionTerms(instruction: string, locale: AppLocale) {
  const words = instruction.match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? [];
  return words
    .map((word) => word.toLocaleLowerCase(intlLocale(locale)))
    .filter((word, index, values) =>
      word.length >= 3 &&
      !stopWords[locale].has(word) &&
      values.indexOf(word) === index,
    )
    .slice(0, 12);
}

function focusedTranscript(
  transcript: VideoTranscriptDocument,
  operation: TranscriptWizardOperation,
  locale: AppLocale,
  instruction: string,
) {
  const terms = instructionTerms(instruction, locale);
  if (!terms.length) return transcript;

  const scored = transcript.segments.map((segment, index) => {
    const text = segment.text.toLocaleLowerCase(intlLocale(locale));
    const words = new Set(
      (text.match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? []).map((word) =>
        word.toLocaleLowerCase(intlLocale(locale)),
      ),
    );
    const score = terms.reduce(
      (total, term) => total + (words.has(term) ? 3 : text.includes(term) ? 1 : 0),
      0,
    );
    return { index, score };
  });
  const best = scored.sort(
    (left, right) => right.score - left.score || left.index - right.index,
  )[0];
  if (!best?.score) return transcript;

  const requestedWindow = {
    summary: 6,
    multiple_choice: 4,
    true_false: 3,
    multi_select: 4,
    fill_blank: 3,
    ordering: 5,
    mixed: 6,
  }[operation];
  const windowLength = Math.min(requestedWindow, transcript.segments.length);
  const start = Math.max(
    0,
    Math.min(
      best.index - Math.floor(windowLength / 2),
      transcript.segments.length - windowLength,
    ),
  );
  return {
    ...transcript,
    segments: transcript.segments.slice(start, start + windowLength),
  };
}

function transcriptFingerprint(transcript: VideoTranscriptDocument) {
  return transcript.segments
    .map((segment) =>
      `${segment.startMs}:${segment.endMs}:${comparable(segment.text)}`,
    )
    .join("|");
}

function transcriptFingerprintHash(
  transcript: VideoTranscriptDocument,
  purpose = "",
) {
  const fingerprint = transcriptFingerprint(transcript);
  const material = purpose ? `${purpose}\0${fingerprint}` : fingerprint;
  let hash = 2_166_136_261;
  for (const character of material) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function transcriptFingerprintIsTrue(transcript: VideoTranscriptDocument) {
  return transcriptFingerprintHash(transcript) % 2 === 0;
}

function shuffledTranscriptOptions<T>(
  transcript: VideoTranscriptDocument,
  purpose: string,
  options: readonly T[],
) {
  const shuffled = [...options];
  let state = transcriptFingerprintHash(transcript, purpose) || 0x9e3779b9;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = next() % (index + 1);
    [shuffled[index], shuffled[target]] = [
      shuffled[target]!,
      shuffled[index]!,
    ];
  }
  return shuffled;
}

function multipleChoiceBlock(
  transcript: VideoTranscriptDocument,
  locale: AppLocale,
) {
  const segments = uniqueTranscriptSegments(transcript);
  if (segments.length < 3) return null;
  const copy = questionCopy[locale];
  const anchor = clip(segments[0]!.text, 220);
  const answer = clip(segments[1]!.text, 300);
  const alternatives = segments
    .slice(2)
    .map((segment) => clip(segment.text, 300))
    .filter((candidate) => comparable(candidate) !== comparable(answer))
    .slice(0, 2);
  const candidates = [
    alternatives[0],
    answer,
    alternatives[1] ?? anchor,
  ].filter(
    (candidate, index, values): candidate is string =>
      Boolean(candidate) &&
      values.findIndex(
        (value) => value && comparable(value) === comparable(candidate!),
      ) === index,
  );
  if (candidates.length < 2) return null;
  const shuffled = shuffledTranscriptOptions(
    transcript,
    "multiple_choice",
    candidates.map((value) => ({ value, correct: value === answer })),
  );
  const correctOption = shuffled.findIndex((option) => option.correct);
  if (correctOption < 0) return null;
  return {
    type: "multiple_choice" as const,
    title: copy.multipleChoiceTitle,
    prompt: clip(copy.multipleChoicePrompt(anchor), 800),
    options: shuffled.map((option) => option.value),
    correctOption,
    feedback: clip(copy.multipleChoiceFeedback(answer), 800),
  };
}

function trueFalseBlock(
  transcript: VideoTranscriptDocument,
  locale: AppLocale,
) {
  const segments = uniqueTranscriptSegments(transcript);
  if (segments.length < 2) return null;
  const copy = questionCopy[locale];
  const anchor = clip(segments[0]!.text, 220);
  const answer = clip(segments[1]!.text, 260);
  const isTrue = transcriptFingerprintIsTrue({ ...transcript, segments });
  const statement = isTrue
    ? answer
    : clip(segments[2]?.text ?? segments[0]!.text, 260);
  return {
    type: "true_false" as const,
    title: copy.trueFalseTitle,
    prompt: clip(copy.trueFalsePrompt(anchor, statement), 800),
    correctOption: isTrue ? 0 : 1,
    feedback: clip(copy.trueFalseFeedback(isTrue, answer), 800),
  };
}

function multiSelectBlock(
  transcript: VideoTranscriptDocument,
  locale: AppLocale,
) {
  const segments = uniqueTranscriptSegments(transcript);
  if (segments.length < 4) return null;
  const copy = questionCopy[locale];
  const anchor = clip(segments[0]!.text, 220);
  const first = clip(segments[1]!.text, 300);
  const second = clip(segments[2]!.text, 300);
  const later = clip(segments[3]!.text, 300);
  const candidates = [
    { value: first, correct: true },
    { value: later, correct: false },
    { value: second, correct: true },
    { value: anchor, correct: false },
  ];
  if (
    new Set(candidates.map((option) => comparable(option.value))).size !==
    candidates.length
  ) {
    return null;
  }
  const shuffled = shuffledTranscriptOptions(
    transcript,
    "multi_select",
    candidates,
  );
  return {
    type: "multi_select" as const,
    title: copy.multiSelectTitle,
    prompt: clip(copy.multiSelectPrompt(anchor), 800),
    options: shuffled.map((option) => option.value),
    correctOptions: shuffled.flatMap((option, index) =>
      option.correct ? [index] : [],
    ),
    feedback: clip(copy.multiSelectFeedback(first, second), 800),
  };
}

function summaryBlock(
  transcript: VideoTranscriptDocument,
  copy: ReturnType<typeof getCourseParityCopy>["transcript"]["generated"],
) {
  const sentences = evenlySpacedSegments(transcript, 6).map(
    (segment) => segment.text,
  );
  const unique = sentences.filter(
    (sentence, index) =>
      sentences.findIndex((candidate) => comparable(candidate) === comparable(sentence)) ===
      index,
  );
  const text = clip(
    `${copy.summaryPrefix} ${unique.join(" ")}`,
    3_500,
  );
  return {
    type: "text" as const,
    text:
      text.length >= 30
        ? text
        : `${text} ${copy.summaryFallback}`,
  };
}

function fillBlankBlock(
  transcript: VideoTranscriptDocument,
  locale: AppLocale,
  copy: ReturnType<typeof getCourseParityCopy>["transcript"]["generated"],
) {
  const candidates = transcript.segments
    .map((segment) => {
      const words = segment.text.match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? [];
      const answer = words
        .filter(
          (word) =>
            word.length >= 6 &&
            !stopWords[locale].has(word.toLocaleLowerCase(intlLocale(locale))),
        )
        .sort((left, right) => right.length - left.length)[0];
      return answer ? { segment, answer } : null;
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort(
      (left, right) =>
        right.answer.length - left.answer.length ||
        left.segment.startMs - right.segment.startMs,
    );
  const selected = candidates[0];
  if (!selected) return null;
  const answerIndex = selected.segment.text.indexOf(selected.answer);
  if (answerIndex < 0) return null;
  const excerptStart = Math.max(0, answerIndex - 260);
  const excerptEnd = Math.min(
    selected.segment.text.length,
    answerIndex + selected.answer.length + 360,
  );
  const prompt = `${excerptStart ? "..." : ""}${selected.segment.text.slice(excerptStart, answerIndex)}____${selected.segment.text.slice(answerIndex + selected.answer.length, excerptEnd)}${excerptEnd < selected.segment.text.length ? "..." : ""}`;
  return {
    type: "fill_blank" as const,
    title: copy.fillTitle,
    prompt: clip(copy.fillPrompt(prompt), 800),
    acceptedAnswers: [selected.answer],
    caseSensitive: false,
    feedback: clip(copy.fillFeedback(selected.segment.text), 800),
  };
}

function orderingBlock(
  transcript: VideoTranscriptDocument,
  copy: ReturnType<typeof getCourseParityCopy>["transcript"]["generated"],
) {
  const unique = uniqueTranscriptSegments(transcript);
  if (unique.length < 3) return null;
  const candidates = evenlySpacedSegments(
    { ...transcript, segments: unique },
    5,
  ).map((segment) => clip(segment.text, 300));
  const options = candidates.filter(
    (option, index) =>
      candidates.findIndex(
        (candidate) => comparable(candidate) === comparable(option),
      ) === index,
  );
  if (options.length < 3) return null;
  return {
    type: "ordering" as const,
    title: copy.orderingTitle,
    prompt: copy.orderingPrompt,
    options,
    feedback: copy.orderingFeedback,
  };
}

export function deterministicTranscriptWizardResult(
  input: unknown,
  operation: TranscriptWizardOperation,
  locale: AppLocale = "de",
  instruction = "",
) {
  const transcript = sanitizeVideoTranscriptDocument(input);
  const parsedInstruction = transcriptWizardInstructionSchema.safeParse(instruction);
  if (!transcript || !parsedInstruction.success) return null;
  const source = focusedTranscript(
    transcript,
    operation,
    locale,
    parsedInstruction.data,
  );
  const copy = getCourseParityCopy(locale).transcript.generated;

  const blocks: GeneratedCourseBlock[] = [];
  if (operation === "summary" || operation === "mixed") {
    blocks.push(summaryBlock(source, copy));
  }
  if (operation === "multiple_choice" || operation === "mixed") {
    const multipleChoice = multipleChoiceBlock(source, locale);
    if (multipleChoice) blocks.push(multipleChoice);
  }
  if (operation === "true_false" || operation === "mixed") {
    const trueFalse = trueFalseBlock(source, locale);
    if (trueFalse) blocks.push(trueFalse);
  }
  if (operation === "multi_select" || operation === "mixed") {
    const multiSelect = multiSelectBlock(source, locale);
    if (multiSelect) blocks.push(multiSelect);
  }
  if (operation === "fill_blank" || operation === "mixed") {
    const fillBlank = fillBlankBlock(source, locale, copy);
    if (fillBlank) blocks.push(fillBlank);
  }
  if (operation === "ordering" || operation === "mixed") {
    const ordering = orderingBlock(source, copy);
    if (ordering) blocks.push(ordering);
  }
  if (!blocks.length) blocks.push(summaryBlock(source, copy));

  const parsed = transcriptWizardResultSchema.safeParse({ blocks });
  return parsed.success ? parsed.data : null;
}

export function transcriptWizardCopyResponse(input: unknown) {
  const parsed = transcriptWizardResultSchema.safeParse(input);
  if (!parsed.success) return null;
  const response = parsed.data.blocks.flatMap((block) => {
    if (block.type === "text") return block.text;
    if (block.type === "multiple_choice" || block.type === "multi_select") {
      return [
        [
          block.title,
          block.prompt,
          block.options
            .map((option, index) => `${index + 1}. ${option}`)
            .join("\n"),
        ].join("\n"),
      ];
    }
    if (
      block.type === "true_false" ||
      block.type === "fill_blank" ||
      block.type === "ordering"
    ) {
      return [[block.title, block.prompt].join("\n")];
    }
    return [];
  });
  return clip(response.join("\n\n"), 12_000);
}

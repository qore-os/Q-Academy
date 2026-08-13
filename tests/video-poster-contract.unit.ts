import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("exact frame downloads filter processing options and reject ambiguous selectors", () => {
  const route = source(
    "src/app/api/media-assets/[id]/derivatives/[kind]/route.ts",
  );
  assert.match(route, /searchParams\.get\("atMilliseconds"\)/);
  assert.match(route, /options}\s*->>\s*'atMilliseconds'/);
  assert.match(route, /requestedJobId !== null && requestedAtMilliseconds !== null/);
});

test("automatic poster lookup preserves legacy and timestamp-zero thumbnail jobs", () => {
  const route = source(
    "src/app/api/media-assets/[id]/derivatives/[kind]/route.ts",
  );
  const selectorBranch = route.slice(
    route.indexOf("...(jobId?.success"),
    route.indexOf(".orderBy(desc(mediaAssetDerivatives.createdAt))"),
  );

  assert.match(
    selectorBranch,
    /\(not \(\$\{mediaProcessingJobs\.options} \? 'atMilliseconds'\)/,
  );
  assert.match(
    selectorBranch,
    /options} -> 'atMilliseconds' = '0'::jsonb\)/,
  );
  assert.match(route, /\.orderBy\(desc\(mediaAssetDerivatives\.createdAt\)\)/);
});

test("manual frame processing rejects timestamps outside the source duration", () => {
  const route = source(
    "src/app/api/media-assets/[id]/processing/route.ts",
  );
  assert.match(
    route,
    /parsed\.data\.atMilliseconds >= asset\.durationMilliseconds/,
  );
  assert.match(route, /assertSharedVideoProcessingSources/);
  assert.match(route, /blockId: z\.string\(\)\.uuid\(\)/);
  assert.match(route, /requireSharedModuleContentPermission/);
  assert.match(
    route,
    /job\.type === "thumbnail" &&\s*Number\.isSafeInteger\(job\.options\.atMilliseconds\)/,
  );
});

test("editor persists a frame only after exact successful job confirmation", () => {
  const editor = source("src/components/admin/video-transcript-editor.tsx");

  assert.match(editor, /exactVideoThumbnailJobStatus/);
  assert.match(editor, /job\.id === queued\.id/);
  assert.match(
    editor,
    /posterMode === "frame" &&\s*currentPosterFrameStatus === "succeeded"/,
  );
  assert.match(editor, /currentPosterFrameStatus === "pending"/);
  assert.match(editor, /currentPosterFrameStatus === "processing"/);
  assert.match(editor, /currentPosterFrameStatus === "failed"/);
  assert.match(editor, /currentPosterFrameStatus === "succeeded"/);
  assert.match(
    editor,
    /const posterPending = posterMode !== "auto" && !posterDocument/,
  );
  assert.match(editor, /onPosterPendingChange\?\.\(posterPending\)/);
  assert.match(editor, /onPosterPendingChange\?\.\(false\)/);
});

test("description generation uses only a server-fetched immutable transcript", () => {
  const route = source(
    "src/app/api/media-assets/[id]/video-description/route.ts",
  );
  assert.match(route, /from\(mediaAssetTranscripts\)/);
  assert.match(
    route,
    /processedTranscript\?\.sourceContentSha256 !== asset\.contentSha256/,
  );
  assert.match(
    route,
    /transcript\.segments\.some\([\s\S]*segment\.endMs > asset\.durationMilliseconds! \+ 2_000/,
  );
  assert.doesNotMatch(route, /parsed\.data\.transcript\b/);
  assert.match(route, /requireSharedModuleContentPermission/);
  assert.match(route, /assertManageableSharedCourseMedia/);
  assert.match(route, /if \(request\.signal\.aborted\)/);
  assert.match(route, /recordProviderCircuitFailure/);
});

test("transcript routes require current succeeded processing provenance", () => {
  for (const path of [
    "src/app/api/media-assets/[id]/video-description/route.ts",
    "src/app/api/media-assets/[id]/processing/route.ts",
  ]) {
    const route = source(path);
    const lookupStart = route.indexOf(".from(mediaAssetTranscripts)");
    const lookupEnd = route.indexOf(
      ".orderBy(desc(mediaAssetTranscripts.createdAt))",
      lookupStart,
    );
    const lookup = route.slice(lookupStart, lookupEnd);
    assert.ok(lookupStart >= 0 && lookupEnd > lookupStart);
    assert.match(lookup, /\.innerJoin\(\s*mediaProcessingJobs,/);
    assert.match(
      lookup,
      /eq\(mediaProcessingJobs\.id, mediaAssetTranscripts\.processingJobId\)/,
    );
    assert.match(
      lookup,
      /eq\(\s*mediaProcessingJobs\.organizationId,\s*mediaAssetTranscripts\.organizationId,/,
    );
    assert.match(
      lookup,
      /eq\(\s*mediaProcessingJobs\.sourceAssetId,\s*mediaAssetTranscripts\.sourceAssetId,/,
    );
    assert.match(
      lookup,
      /eq\(\s*mediaProcessingJobs\.sourceContentSha256,\s*mediaAssetTranscripts\.sourceContentSha256,/,
    );
    assert.match(lookup, /eq\(mediaProcessingJobs\.type, "transcript"\)/);
    assert.match(lookup, /eq\(mediaProcessingJobs\.status, "succeeded"\)/);
    assert.match(
      lookup,
      /eq\(mediaProcessingJobs\.provider, TRANSCRIPT_PROCESSING_PROVIDER\)/,
    );
    assert.doesNotMatch(lookup, /mediaAssetTranscripts\.provider/);
  }
});

test("automatic transcription sends only canonical two-letter languages", () => {
  const processingRoute = source(
    "src/app/api/media-assets/[id]/processing/route.ts",
  );
  const descriptionRoute = source(
    "src/app/api/media-assets/[id]/video-description/route.ts",
  );
  const editor = source("src/components/admin/video-transcript-editor.tsx");
  const worker = source("src/lib/media/processing-worker.ts");
  assert.match(
    processingRoute,
    /\.regex\(AUTOMATIC_TRANSCRIPTION_LANGUAGE_PATTERN\)/,
  );
  assert.doesNotMatch(
    processingRoute.slice(
      processingRoute.indexOf("const requestSchema"),
      processingRoute.indexOf("async function assertSharedVideoProcessingSources"),
    ),
    /\.toLowerCase\(\)/,
  );
  assert.match(
    descriptionRoute.slice(
      descriptionRoute.indexOf("const requestSchema"),
      descriptionRoute.indexOf("function response"),
    ),
    /\.regex\(AUTOMATIC_TRANSCRIPTION_LANGUAGE_PATTERN\)/,
  );
  assert.match(
    descriptionRoute,
    /automaticTranscriptionDurationSupported\(asset\.durationMilliseconds\)/,
  );
  assert.match(
    editor,
    /const requestedLanguage = automaticTranscriptLanguage;[\s\S]*language: requestedLanguage/,
  );
  assert.match(editor, /disabled=\{[\s\S]*!automaticTranscriptLanguage/);
  assert.match(
    worker,
    /const language = normalizeAutomaticTranscriptionLanguage\(input\.language\)/,
  );
  assert.match(
    worker,
    /const language = normalizeAutomaticTranscriptionLanguage\(\s*job\.options\.language/,
  );
});

test("editor keeps manual AI output separate and durable jobs own automatic descriptions", () => {
  const editor = source("src/components/admin/video-transcript-editor.tsx");
  assert.match(editor, /name="caption"/);
  assert.match(editor, /asyncAssetScopeRef\.current === scope/);
  assert.match(editor, /scope\.controller\.abort\(\)/);
  assert.match(editor, /signal: scope\.controller\.signal/);
  assert.match(editor, /TRANSCRIPT_POLLING_MAXIMUM_MS/);
  assert.match(
    editor,
    /const automaticTranscriptionAvailable =\s*automaticTranscriptionDurationSupported\(sourceDurationMilliseconds\)/,
  );
  assert.match(
    editor,
    /disabled=\{[\s\S]*?!automaticTranscriptionAvailable[\s\S]*?!automaticTranscriptLanguage/,
  );
  assert.match(editor, /transcriptEditVersionRef/);
  assert.doesNotMatch(
    editor,
    /generateDescription\(\{ automatic: true/,
  );
  const generateTranscript = editor.slice(
    editor.indexOf("  const generateTranscript = async"),
    editor.indexOf("  generateTranscriptRef.current = generateTranscript;"),
  );
  assert.match(
    generateTranscript,
    /!serverProcessingEnabled \|\| !automaticTranscriptionAvailable/,
  );
  assert.doesNotMatch(
    generateTranscript,
    /generateDescription/,
  );
  assert.doesNotMatch(
    editor,
    /automaticDescriptionRequestedRef|AUTOMATIC_DESCRIPTION_RETRY_DELAYS_MS/,
  );
  const importTranscript = editor.slice(
    editor.indexOf("  const importTranscriptFile = async"),
    editor.indexOf("  const exportTranscriptFile ="),
  );
  assert.match(
    importTranscript,
    /transcriptEditVersionRef\.current \+= 1;\s*setLanguage\(/,
  );
  assert.match(
    editor,
    /name="transcriptLanguage"[\s\S]*?transcriptEditVersionRef\.current \+= 1;[\s\S]*?setLanguage\(/,
  );
  assert.match(
    editor,
    /name="transcriptVtt"[\s\S]*?transcriptEditVersionRef\.current \+= 1;[\s\S]*?setWebVtt\(/,
  );
  assert.match(
    editor,
    /editVersion !== transcriptEditVersionRef\.current/,
  );
  assert.match(editor, /setDescriptionSuggestion\(payload\.description\)/);
  assert.match(editor, /onClick=\{\(\) => void generateDescription\(\)\}/);
  assert.match(
    editor,
    /transcriptLanguage: automaticTranscriptLanguage/,
  );
  assert.doesNotMatch(editor, /setDescriptionTouched\(true\);[\s\S]*?fetch\(/);
  assert.match(editor, /onDescriptionPendingChange\?\.\(true\)/);
  assert.match(editor, /onDescriptionPendingChange\?\.\(false\)/);
  assert.doesNotMatch(editor, /transcript:\s*parsed/);
  assert.match(editor, /\[overflow-wrap:anywhere\]/);
});

test("course builder blocks every submit while description or poster work is incomplete", () => {
  const builder = source("src/components/admin/course-builder.tsx");

  assert.match(
    builder,
    /const \[descriptionPending, setDescriptionPending\] = useState\(false\)/,
  );
  assert.match(builder, /submitDisabled=\{\s*descriptionPending \|\|/);
  assert.match(
    builder,
    /const \[posterPending, setPosterPending\] = useState\(false\)/,
  );
  assert.match(
    builder,
    /submitDisabled=\{\s*descriptionPending \|\|\s*posterPending \|\|/,
  );
  assert.match(
    builder,
    /onDescriptionPendingChange=\{setDescriptionPending\}/,
  );
  assert.match(builder, /onPosterPendingChange=\{setPosterPending\}/);
  assert.match(builder, /if \(pending \|\| submitDisabled\) return/);
  assert.doesNotMatch(builder, /name="[^"]*Pending"[^>]*required/);
});

test("publication requires the exact successful frame derivative", () => {
  const versioning = source("src/lib/api/course-versioning.ts");
  assert.match(versioning, /eq\(mediaProcessingJobs\.status, "succeeded"\)/);
  assert.match(versioning, /eq\(mediaAssetDerivatives\.kind, "thumbnail"\)/);
  assert.match(
    versioning,
    /availableFrames\.has\(`\$\{mediaAssetId\}:\$\{atMilliseconds\}`\)/,
  );
});

test("admin and builder video previews render the persisted poster selection", () => {
  const adminPreview = source(
    "src/app/(admin)/admin/courses/[id]/preview/page.tsx",
  );
  const builder = source("src/components/admin/course-builder.tsx");

  assert.match(adminPreview, /poster=\{data\.videoPoster\}/);
  assert.match(
    builder,
    /poster=\{videoPosterUrl\(data\.mediaAssetId, data\.videoPoster\)\}/,
  );
});

test("a newly selected primary video drives and resets the unsaved editor", () => {
  const builder = source("src/components/admin/course-builder.tsx");
  const editor = source("src/components/admin/video-transcript-editor.tsx");

  assert.match(builder, /onSourceChange=\{\s*block\.type === "video"/);
  assert.match(
    builder,
    /`\/api\/media-assets\/\$\{encodeURIComponent\(videoSourceSelection\.selection\.id\)\}\/download`/,
  );
  assert.match(builder, /key=\{videoEditorKey\}/);
  assert.match(builder, /videoSourceChanged \? undefined : data\.transcript/);
  assert.match(
    builder,
    /transcriptLanguage=\{\s*videoSourceChanged \? locale : data\.transcriptLanguage\s*\}/,
  );
  assert.match(
    editor,
    /persistedLanguage[\s\S]*embeddedLanguage[\s\S]*const initialLanguage/,
  );
  assert.match(
    editor,
    /normalizeLegacyAutomaticTranscriptionLanguage\(initialLanguageCandidate\)/,
  );
  assert.match(
    editor,
    /!automaticTranscriptLanguage[\s\S]*automaticTranscriptRequestedRef\.current = true/,
  );
  const loadExistingTranscript = editor.slice(
    editor.indexOf("  const loadExistingTranscript = async"),
    editor.indexOf(
      "  loadExistingTranscriptRef.current = loadExistingTranscript;",
    ),
  );
  assert.doesNotMatch(
    loadExistingTranscript,
    /automaticTranscriptionDurationSupported|automaticTranscriptionAvailable/,
  );
  assert.match(
    loadExistingTranscript,
    /editVersion !== transcriptEditVersionRef\.current\) return "unavailable";\s*if \(!result\.transcript\?\.webVtt\) return "missing";/,
  );
  assert.match(builder, /sourceAssetId=\{activeVideoAssetId\}/);
  assert.match(
    builder,
    /sourceDurationMilliseconds=\{activeVideoDurationMilliseconds\}/,
  );
  assert.match(editor, /return sourceAssetId\?\.trim\(\) \?\? ""/);
  assert.match(
    editor,
    /automaticTranscriptRequestedRef\.current = true;[\s\S]*await loadExistingTranscriptRef\.current\?\.\(\);[\s\S]*!automaticTranscriptionAvailable[\s\S]*await generateTranscriptRef\.current\?\.\(\)/,
  );
  assert.match(
    editor,
    /descriptionPending \|\|[\s\S]*!parsed \|\|[\s\S]*!sourceAssetId \|\|[\s\S]*!serverProcessingEnabled/,
  );
  assert.match(editor, /mode === "frame" && !serverProcessingEnabled/);
  assert.match(builder, /serverProcessingEnabled=\{!videoSourceChanged\}/);
  assert.match(
    builder,
    /automaticallyLoadTranscript=\{\s*!videoSourceChanged &&\s*Boolean\(activeVideoAssetId\)\s*\}/,
  );
  assert.match(
    builder,
    /\{!videoSourceChanged \? \(\s*<TranscriptWizardControls/,
  );
  assert.doesNotMatch(
    builder,
    /!videoSourceChanged && activeVideoAssetId \? \(\s*<TranscriptWizardControls/,
  );
  assert.doesNotMatch(editor, /querySelector<HTMLInputElement>/);
});

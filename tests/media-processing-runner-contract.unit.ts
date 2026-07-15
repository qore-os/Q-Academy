import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("S3 processing runner binds exact source versions and verifies output uploads", () => {
  const worker = source("src/lib/media/processing-worker.ts");
  const storage = source("src/lib/media/s3-storage.ts");
  assert.match(worker, /getStoredMediaObjectForScanning/);
  assert.match(worker, /storageVersionId/);
  assert.match(worker, /digest !== source\.contentSha256/);
  assert.match(
    worker,
    /finally \{\s*await rm\([^)]*workDirectory, \{\s*recursive: true,\s*force: true,/,
  );
  assert.match(storage, /putS3ProcessedObject/);
  assert.match(storage, /verifyS3ObjectIntegrity\(head/);
  assert.match(storage, /"processing-job-id"/);
  assert.match(storage, /VersionId: uploadedVersionId/);
});

test("production runner uses FFmpeg and a bounded disk-backed work root", () => {
  const dockerfile = source("Dockerfile");
  const compose = source("compose.production.yml");
  assert.match(dockerfile, /FROM runner AS media-runner/);
  assert.match(
    dockerfile,
    /install --yes --no-install-recommends "ffmpeg=\$\{FFMPEG_VERSION\}"/,
  );
  assert.match(dockerfile, /snapshot\.debian\.org\/archive\/debian/);
  assert.match(compose, /target: media-runner/);
  assert.match(
    compose,
    /MEDIA_PROCESSING_WORK_ROOT: \/var\/lib\/q-academy-media-processing\/work/,
  );
  assert.match(compose, /source: \$\{MEDIA_PROCESSING_WORK_DIR:\?/);
  assert.match(compose, /create_host_path: false/);
  assert.doesNotMatch(compose, /q-academy-media-processing:size=/);
  assert.match(dockerfile, /q-academy-media-runner/);
  const entrypoint = source("scripts/ops/media-runner-entrypoint.sh");
  assert.match(entrypoint, /expected_root="\$mount_root\/work"/);
  assert.match(entrypoint, /\.q-academy-media-work-root/);
  assert.match(entrypoint, /q-academy-media-processing-v1/);
  assert.match(entrypoint, /0:0:755/);
  assert.match(entrypoint, /0:0:444/);
  assert.match(entrypoint, /1001:1001:700/);
  assert.match(
    entrypoint,
    /find "\$work_root" -xdev -depth -mindepth 1 -delete/,
  );
  assert.doesNotMatch(entrypoint, /-exec rm -rf/);
  assert.doesNotMatch(entrypoint, /find "\$mount_root"/);
});

test("standalone processing preflight loads server-only modules under the server condition", () => {
  const packageJson = JSON.parse(source("package.json")) as {
    scripts?: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts?.["media:processing:preflight"],
    "node --conditions=react-server --import tsx scripts/media-processing-preflight.ts",
  );
});

test("media provider keeps its deployment-controlled process boundary shell-free", () => {
  const provider = source("src/lib/media/processing-provider.ts");
  assert.match(
    provider,
    /input\.executable, \/\/ nosemgrep: javascript\.lang\.security\.detect-child-process\.detect-child-process/,
  );
  assert.match(provider, /shell: false/);
  assert.match(provider, /stdio: \["ignore"/);
  assert.doesNotMatch(provider, /shell: true|\bexec(?:Sync)?\(/);
});

test("video edits are validated, rendered deterministically and addressed by job", () => {
  const worker = source("src/lib/media/processing-worker.ts");
  const processingRoute = source(
    "src/app/api/media-assets/[id]/processing/route.ts",
  );
  const derivativeRoute = source(
    "src/app/api/media-assets/[id]/derivatives/[kind]/route.ts",
  );

  assert.match(
    worker,
    /sanitizeVideoEditPlan\(options\.videoEdit, asset\.durationMilliseconds\)/,
  );
  assert.match(worker, /buildVideoEditFfmpegFilters/);
  assert.match(worker, /editFilters\.video/);
  assert.match(worker, /editFilters\.audio/);
  assert.match(worker, /Math\.max\(1_500, expectedDurationMs \* 0\.03\)/);
  assert.match(worker, /"ffmpeg-v2"/);
  assert.match(processingRoute, /videoEdit/);
  assert.match(processingRoute, /input\.type !== "transcode"/);
  assert.match(processingRoute, /asset\.durationMilliseconds/);
  assert.match(derivativeRoute, /searchParams\.get\("job"\)/);
  assert.match(derivativeRoute, /mediaProcessingJobs\.id, jobId\.data/);
  assert.match(derivativeRoute, /not \([^)]*options[^)]*\? 'videoEdit'\)/);
  assert.match(
    derivativeRoute,
    /not \([^)]*options[^)]*\? 'videoComposition'\)/,
  );
});

test("audio multitrack jobs freeze tenant sources and use an explicit derivative", () => {
  const worker = source("src/lib/media/processing-worker.ts");
  const processingRoute = source(
    "src/app/api/media-assets/[id]/processing/route.ts",
  );
  const derivativeRoute = source(
    "src/app/api/media-assets/[id]/derivatives/[kind]/route.ts",
  );
  const editor = source("src/components/admin/video-transcript-editor.tsx");
  const player = source("src/components/academy/video-transcript-player.tsx");
  const actions = source("src/lib/course-builder-actions.ts");
  const versioning = source("src/lib/api/course-versioning.ts");

  assert.match(worker, /bindVideoCompositionSources/);
  assert.match(worker, /sanitizeBoundVideoComposition/);
  assert.match(worker, /storageVersionId !== identity\.storageVersionId/);
  assert.match(worker, /digest !== identity\.contentSha256/);
  assert.match(worker, /"ffmpeg-multitrack-v1"/);
  assert.match(worker, /"-filter_complex",\s*compositionGraph\.filterComplex/);
  assert.match(processingRoute, /coursePermissionAllows\(permission, "edit"\)/);
  assert.match(processingRoute, /canUseVideoCompositionSource/);
  assert.match(processingRoute, /boundAnywhere/);
  assert.match(actions, /boundVideoCompositionMatchesDocument/);
  assert.match(actions, /renderJob\.options\.videoEdit !== undefined/);
  assert.match(versioning, /renderJob\.options\.videoEdit !== undefined/);
  assert.match(editor, /name="videoComposition"/);
  assert.match(editor, /MAX_VIDEO_COMPOSITION_AUDIO_TRACKS/);
  assert.match(editor, /videoComposition: compositionDocument/);
  assert.match(player, /transcodeJobId/);
  assert.match(player, /\?job=\$\{encodeURIComponent\(transcodeJobId\)\}/);
  assert.match(worker, /videoCompositionCourseId/);
  assert.match(derivativeRoute, /getCourseLearningAccess/);
  assert.match(derivativeRoute, /publishedSnapshotReferencesVideoComposition/);
  assert.match(derivativeRoute, /coursePermissionForUser/);
  assert.match(derivativeRoute, /canDownloadVideoCompositionDerivative/);
});

test("processing request rejects simultaneous physical edits and composition", () => {
  const processingRoute = source(
    "src/app/api/media-assets/[id]/processing/route.ts",
  );
  assert.match(
    processingRoute,
    /if \(videoProcessingOptionsConflict\(input\)\)[\s\S]*path: \["videoComposition"\]/,
  );
});

test("worker keeps composition renders on the full source timeline", () => {
  const worker = source("src/lib/media/processing-worker.ts");
  assert.match(worker, /videoProcessingOptionsConflict\(options\)/);
  assert.match(worker, /videoProcessingOptionsConflict\(job\.options\)/);
  assert.match(
    worker,
    /const compositionDurationMs = sourceDurationMilliseconds;/,
  );
  assert.doesNotMatch(worker, /primaryVideoFilter: editFilters\.video/);
  assert.doesNotMatch(worker, /primaryAudioFilter: editFilters\.audio/);
});

test("composition UI payload excludes the virtual playback edit plan", () => {
  const editor = source("src/components/admin/video-transcript-editor.tsx");
  assert.match(
    editor,
    /!compositionDocument &&\s*videoPlaybackPolicyHasEdits\(draftPlaybackPolicy\)/,
  );
  assert.doesNotMatch(editor, /renderEditFingerprint/);
  assert.match(editor, /videoComposition: compositionDocument/);
});

test("save and publish reject composition jobs containing a physical edit", () => {
  const actions = source("src/lib/course-builder-actions.ts");
  const versioning = source("src/lib/api/course-versioning.ts");
  for (const implementation of [actions, versioning]) {
    assert.match(implementation, /renderJob\.options\.videoEdit !== undefined/);
    assert.doesNotMatch(implementation, /expectedVideoEdit/);
  }
});

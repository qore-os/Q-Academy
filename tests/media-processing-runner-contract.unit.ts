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

test("derivative cleanup is exact for versioned S3 and claim-fenced for unversioned storage", () => {
  const worker = source("src/lib/media/processing-worker.ts");
  const storage = source("src/lib/media/s3-storage.ts");
  const cleanupStart = worker.indexOf(
    "async function deleteFailedDerivativeWhileClaimOwned",
  );
  const cleanupEnd = worker.indexOf(
    "async function completeDerivative",
    cleanupStart,
  );
  const cleanup = worker.slice(cleanupStart, cleanupEnd);
  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart);
  assert.match(cleanup, /eq\(mediaProcessingJobs\.status, "processing"\)/);
  assert.match(
    cleanup,
    /eq\(mediaProcessingJobs\.claimToken, job\.claimToken!\)/,
  );
  assert.match(cleanup, /\.for\("update"\)/);
  assert.match(
    cleanup,
    /eq\(mediaAssetDerivatives\.processingJobId, job\.id\)/,
  );
  const claimLock = cleanup.indexOf('.for("update")');
  const derivativeAbsenceCheck = cleanup.indexOf(
    "mediaAssetDerivatives.processingJobId",
  );
  const deleteObject = cleanup.indexOf("await deleteStoredMediaObject(identity)");
  assert.ok(claimLock >= 0 && claimLock < derivativeAbsenceCheck);
  assert.ok(
    derivativeAbsenceCheck < deleteObject,
    "The unversioned delete must remain inside the claim-locked transaction and after the derivative check.",
  );

  const completeEnd = worker.indexOf("async function readFilePrefix", cleanupEnd);
  const complete = worker.slice(cleanupEnd, completeEnd);
  assert.match(
    complete,
    /compatibilityMode === "strato-hidrive"[\s\S]*deleteFailedDerivativeWhileClaimOwned\(job, identity\)/,
  );
  assert.match(
    complete,
    /STRATO derivative cleanup could not be verified/,
  );
  assert.doesNotMatch(
    complete,
    /deleteFailedDerivativeWhileClaimOwned\(job, identity\)\.catch/,
  );
  assert.match(
    complete,
    /compatibilityMode === "versioned"[\s\S]*stored\?\.versionId[\s\S]*deleteStoredMediaObjectRevision\(identity, stored\.versionId\)/,
  );
  assert.match(complete, /\.for\("update"\)/);
  assert.ok(
    complete.indexOf('.for("update")') <
      complete.indexOf("mediaTenantQuotaLockQuery"),
    "A stale claim must fail before quota accounting or derivative insertion.",
  );
  assert.doesNotMatch(
    complete,
    /catch \(error\) \{\s*await deleteStoredMediaObject\(identity\)/,
  );

  const uploadWrapper = storage.slice(
    storage.indexOf("export async function putS3ProcessedObject"),
    storage.indexOf("export async function deleteS3Object"),
  );
  assert.match(
    uploadWrapper,
    /try \{[\s\S]*await putS3ProcessedObjectOnce\(configuration, input\)[\s\S]*finally \{[\s\S]*input\.body\.destroy\(\)/,
  );
  assert.match(storage, /VersionId: stableVersionId/);
});

test("processing jobs renew their owned lease and abort work after claim loss", () => {
  const worker = source("src/lib/media/processing-worker.ts");
  const leaseStart = worker.indexOf("async function withMediaProcessingLease");
  const leaseEnd = worker.indexOf("async function hashFile", leaseStart);
  const lease = worker.slice(leaseStart, leaseEnd);
  assert.ok(leaseStart >= 0 && leaseEnd > leaseStart);
  assert.match(lease, /PROCESSING_LEASE_HEARTBEAT_MS/);
  assert.match(lease, /eq\(mediaProcessingJobs\.status, "processing"\)/);
  assert.match(lease, /eq\(mediaProcessingJobs\.claimToken, job\.claimToken!\)/);
  assert.match(lease, /leaseExpiresAt: new Date\(now\.getTime\(\) \+ PROCESSING_LEASE_MS\)/);
  assert.match(lease, /leaseController\.abort/);
  assert.match(worker, /withMediaProcessingLease\(job, \(signal\) =>/);
  assert.match(worker, /processClaimedJob\(job, signal\)/);
  const dispatchRoute = source(
    "src/app/api/internal/jobs/media/dispatch/route.ts",
  );
  assert.match(dispatchRoute, /export const maxDuration = 14_400/);
});

test("production runner uses FFmpeg and a bounded disk-backed work root", () => {
  const dockerfile = source("Dockerfile");
  const compose = source("compose.production.yml");
  assert.match(dockerfile, /FROM runner AS media-runner/);
  assert.match(
    dockerfile,
    /install --yes --no-install-recommends[\s\S]*"ffmpeg=\$\{FFMPEG_VERSION\}"/,
  );
  assert.match(dockerfile, /ARG MESA_VERSION=22\.3\.6-1\+deb12u2/);
  for (const packageName of [
    "libgbm1",
    "libgl1-mesa-dri",
    "libglapi-mesa",
    "libglx-mesa0",
  ]) {
    assert.match(
      dockerfile,
      new RegExp(`"${packageName}=\\$\\{MESA_VERSION\\}"`),
    );
  }
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
  const mediaRunnerStage = dockerfile.slice(
    dockerfile.indexOf("FROM runner AS media-runner"),
  );
  assert.match(
    mediaRunnerStage,
    /ENTRYPOINT \["\/usr\/local\/bin\/q-academy-media-runner"\]\s+CMD \["\.\/node_modules\/\.bin\/next", "start", "-H", "0\.0\.0\.0", "-p", "3000"\]/,
  );
  const entrypoint = source("scripts/ops/media-runner-entrypoint.sh");
  assert.match(entrypoint, /if \[ "\$#" -eq 0 \]/);
  assert.match(entrypoint, /Media runner command is missing/);
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
  assert.match(provider, /detached: process\.platform !== "win32"/);
  assert.match(provider, /process\.kill\(-pid, "SIGKILL"\)/);
  assert.match(provider, /MAX_COMMAND_TIMEOUT_MS = 13_800_000/);
  assert.match(provider, /stdio: \["ignore"/);
  assert.match(
    provider,
    /resolveMediaProcessorTimeouts\(process\.env\)\.transcriptTimeoutMs/,
  );
  const worker = source("src/lib/media/processing-worker.ts");
  assert.match(
    worker,
    /resolveMediaProcessorTimeouts\(process\.env\)\.ffmpegTimeoutMs/,
  );
  assert.doesNotMatch(provider, /shell: true|\bexec(?:Sync)?\(/);
  assert.match(provider, /class DisabledTranscriptProvider/);
  assert.match(
    provider,
    /MEDIA_TRANSCRIPTION_ENABLED\?\.trim\(\) === "false"[\s\S]*new DisabledTranscriptProvider\(\)/,
  );
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
  assert.match(processingRoute, /requireSharedModuleContentPermission/);
  assert.match(processingRoute, /assertManageableSharedCourseMedia/);
  assert.match(processingRoute, /blockId: z\.string\(\)\.uuid\(\)/);
  assert.match(actions, /boundVideoCompositionMatchesDocument/);
  assert.match(actions, /renderJob\.options\.videoEdit !== undefined/);
  assert.match(versioning, /renderJob\.options\.videoEdit !== undefined/);
  assert.match(editor, /name="videoComposition"/);
  assert.match(editor, /MAX_VIDEO_COMPOSITION_AUDIO_TRACKS/);
  assert.match(editor, /videoComposition: compositionDocument/);
  assert.match(player, /transcodeJobId/);
  assert.match(player, /\?job=\$\{encodeURIComponent\(transcodeJobId\)\}/);
  assert.match(worker, /videoCompositionCourseId/);
  assert.match(worker, /videoCompositionBlockId/);
  assert.match(versioning, /videoCompositionBlockId !== block\.id/);
  assert.match(derivativeRoute, /getCourseLearningAccess/);
  assert.match(
    derivativeRoute,
    /accessibleLessonsReferenceVideoComposition/,
  );
  assert.match(derivativeRoute, /access\.lessons\.values\(\)/);
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

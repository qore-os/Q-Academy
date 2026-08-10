import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("STRATO downloads are ETag-bound application streams while versioned S3 keeps signed redirects", () => {
  const s3Storage = source("src/lib/media/s3-storage.ts");
  const storage = source("src/lib/media/storage.ts");
  const download = source("src/lib/media/download-response.ts");
  const v1Download = source(
    "src/app/api/v1/media-assets/[id]/download/route.ts",
  );
  const derivatives = source(
    "src/app/api/media-assets/[id]/derivatives/[kind]/route.ts",
  );

  assert.match(
    s3Storage,
    /STRATO downloads must use the ETag-bound application proxy/,
  );
  assert.match(
    s3Storage,
    /new GetObjectCommand\(\{[\s\S]*IfMatch: quotedEtag\(identity\.expectedEtag\)/,
  );
  assert.match(
    s3Storage,
    /Range: `bytes=\$\{identity\.range\.start\}-\$\{identity\.range\.end\}`/,
  );
  assert.match(s3Storage, /result\.ContentRange !== expectedContentRange/);
  assert.match(storage, /mediaS3DownloadsRequireProxy/);
  assert.match(download, /if \(mediaS3DownloadsRequireProxy\(\)\)/);
  assert.match(download, /getS3MediaObjectForDownload/);
  assert.match(download, /status: range \? 206 : 200/);
  assert.match(download, /createMediaDownloadAuthorization/);
  assert.match(download, /status: 307/);
  assert.match(v1Download, /mediaDownloadResponse\(\{/);
  assert.match(derivatives, /!mediaS3DownloadsRequireProxy\(\)/);
  assert.match(derivatives, /getS3MediaObjectForDownload/);
});

test("STRATO startup contract executes browser POST and positive, negative, and ranged conditional reads", () => {
  const preflight = source(
    "src/lib/media/s3-strato-compatibility-preflight.ts",
  );
  assert.match(preflight, /createStratoPresignedPost/);
  assert.match(preflight, /new FormData\(\)/);
  assert.match(preflight, /headers: \{ Origin: input\.expectedOrigin \}/);
  assert.match(preflight, /browserPostResponse\.status !== 201/);
  assert.match(preflight, /access-control-allow-origin/);
  assert.match(preflight, /normalizeS3BrowserUploadOrigins/);
  assert.match(
    preflight,
    /for \(const \[index, origin\] of expectedOrigins\.entries\(\)\)/,
  );
  assert.match(preflight, /response\.allowedOrigin !== origin/);
  assert.match(preflight, /browserUploadOriginCount: expectedOrigins\.length/);
  assert.match(
    preflight,
    /Key: browserPostKey,[\s\S]*IfMatch: quotedEtag\(browserPostIdentity\.etag\)/,
  );
  assert.match(
    preflight,
    /verifyS3ObjectIntegrity\(browserPostDownloaded,[\s\S]*metadata: browserPostMetadata/,
  );
  assert.match(
    preflight,
    /Buffer\.compare\(body, Buffer\.from\(browserPostBytes\)\) !== 0/,
  );
  assert.match(preflight, /q-academy-intentionally-wrong-etag/);
  assert.match(preflight, /statusOf\(error\) !== 412/);
  assert.match(preflight, /Range: `bytes=\$\{rangeStart\}-\$\{rangeEnd\}`/);
  assert.match(preflight, /conditionalRangeReadVerified: true/);
  assert.match(preflight, /StartAfter: `\$\{canaryPrefix\}\/start-after-a\/`/);
  assert.match(preflight, /StartAfter: startAfterBFirstKey/);
  assert.match(preflight, /startAfterPaginationVerified: true/);
});

test("STRATO startup contract rejects manipulated POST fields and conditional copies", () => {
  const preflight = source(
    "src/lib/media/s3-strato-compatibility-preflight.ts",
  );

  assert.match(
    preflight,
    /fieldOverrides: \{ key: browserPostWrongKeyTargetKey \}/,
  );
  assert.match(preflight, /const oversizedBody = Buffer\.concat/);
  assert.match(
    preflight,
    /"x-amz-meta-object-role": "manipulated-browser-post"/,
  );
  assert.match(preflight, /response\.status < 400 \|\| response\.status > 499/);
  assert.match(
    preflight,
    /expectMissing\([\s\S]*browserPostWrongKeySignedKey[\s\S]*expectMissing\([\s\S]*browserPostWrongKeyTargetKey/,
  );
  assert.match(
    preflight,
    /expectMissing\(client, configuration\.bucket, browserPostWrongSizeKey\)/,
  );
  assert.match(
    preflight,
    /configuration\.bucket,[\s\S]*browserPostWrongMetadataKey/,
  );
  assert.match(preflight, /q-academy-intentionally-wrong-copy-etag/);
  assert.match(
    preflight,
    /statusOf\(error\) !== 412[\s\S]*copyConditionMismatchKey/,
  );
  assert.match(
    preflight,
    /browserPostExactKeyPolicyVerified: true[\s\S]*browserPostExactSizePolicyVerified: true[\s\S]*browserPostRequiredMetadataPolicyVerified: true/,
  );
  assert.match(preflight, /mismatchedCopySourceConditionRejected: true/);
});

test("STRATO startup contract denies anonymous object and bucket operations", () => {
  const preflight = source(
    "src/lib/media/s3-strato-compatibility-preflight.ts",
  );

  assert.match(
    preflight,
    /response\.status !== 401 && response\.status !== 403/,
  );
  assert.match(
    preflight,
    /objectUrl\(configuration, sourceKey\),[\s\S]*method: "HEAD"/,
  );
  assert.match(
    preflight,
    /objectUrl\(configuration, sourceKey\),[\s\S]*method: "GET"/,
  );
  assert.match(
    preflight,
    /listObjectsUrl\(configuration, `\$\{canaryPrefix\}\/`\)/,
  );
  assert.match(
    preflight,
    /objectUrl\(configuration, anonymousPutKey\),[\s\S]*method: "PUT"/,
  );
  assert.match(
    preflight,
    /objectUrl\(configuration, anonymousDeleteKey\),[\s\S]*method: "DELETE"/,
  );
  assert.match(
    preflight,
    /verifyS3ObjectIntegrity\(sourceAfterAnonymousRequests,[\s\S]*metadata: sourceMetadata/,
  );
  assert.match(
    preflight,
    /verifyS3ObjectIntegrity\(anonymousDeleteGuard,[\s\S]*metadata: anonymousDeleteMetadata/,
  );
  assert.match(
    preflight,
    /anonymousKnownObjectHeadRejected: true[\s\S]*anonymousKnownObjectGetRejected: true[\s\S]*anonymousListObjectsRejected: true[\s\S]*anonymousObjectPutRejected: true[\s\S]*anonymousObjectDeleteRejected: true/,
  );
  assert.doesNotMatch(preflight, /console\.(?:log|error)\(/);
});

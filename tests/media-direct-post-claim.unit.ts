import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function actionSource(source: string, name: string) {
  const start = source.indexOf(`export async function ${name}`);
  const end = source.indexOf("\nexport async function ", start + 1);
  assert.ok(start >= 0 && end > start, `${name} is missing`);
  return source.slice(start, end);
}

function latestMigrationSource() {
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  ) as { entries: Array<{ idx: number; tag: string }> };
  const latest = journal.entries.at(-1);
  assert.equal(latest?.idx, 81);
  return readFileSync(`drizzle/${latest.tag}.sql`, "utf8");
}

test("direct POST claims are persisted immediately before the one permitted send", () => {
  const service = readFileSync("src/lib/media/session-service.ts", "utf8");
  const browser = readFileSync(
    "src/lib/media/browser-session-upload.ts",
    "utf8",
  );
  const route = readFileSync(
    "src/app/api/media-assets/[id]/direct-upload-claim/route.ts",
    "utf8",
  );
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = latestMigrationSource();
  const claim = actionSource(service, "claimSessionDirectPostUpload");

  assert.match(schema, /directUploadClaimToken: uuid\("direct_upload_claim_token"/);
  assert.match(migration, /ADD COLUMN "direct_upload_claimed_at" timestamp with time zone/);
  assert.match(migration, /ADD COLUMN "direct_upload_claim_token" uuid/);
  assert.match(migration, /"status" = 'pending'/);
  assert.match(claim, /compatibilityMode !== "strato-hidrive"/);
  assert.match(claim, /\.for\("update"\)/);
  assert.match(claim, /asset\.directUploadClaimToken === claimToken/);
  assert.match(claim, /isNull\(mediaAssets\.directUploadClaimToken\)/);
  assert.match(claim, /state: "completion_pending"/);
  assert.match(claim, /state: "send_authorized"/);
  assert.match(claim, /createMediaUploadAuthorization/);
  assert.match(route, /claimToken: z\.string\(\)\.uuid\(\)/);
  assert.match(route, /\.strict\(\)/);
  assert.match(route, /parseSessionMediaJson\(request\)/);
  assert.match(route, /claimSessionDirectPostUpload\(user, id, input\.claimToken\)/);
  const completion = actionSource(service, "completeSessionMediaAsset");
  const deletion = actionSource(service, "deleteSessionMediaAsset");
  assert.match(completion, /directUploadClaimToken: null/);
  assert.match(completion, /directUploadClaimedAt: null/);
  assert.match(deletion, /directUploadClaimToken: null/);

  const claimRequest = browser.indexOf("intent.directPostClaimUrl");
  const fileSend = browser.indexOf("uploadFile(", claimRequest);
  assert.ok(claimRequest >= 0 && fileSend > claimRequest);
  assert.match(
    browser.slice(claimRequest, fileSend),
    /claim\.state === "completion_pending"/,
  );
});

test("the initial STRATO intent never exposes signed POST authorization", () => {
  const service = readFileSync("src/lib/media/session-service.ts", "utf8");
  const start = service.indexOf("async function sessionUploadIntentResponse");
  const end = service.indexOf("\nexport async function ", start);
  assert.ok(start >= 0 && end > start);
  const intent = service.slice(start, end);
  const claimed = intent.indexOf("directPostClaimState:");
  const authorization = intent.indexOf("createMediaUploadAuthorization");

  assert.ok(claimed >= 0 && authorization > claimed);
  const beforeAuthorization = intent.slice(0, authorization);
  assert.match(
    beforeAuthorization,
    /directPostClaimUrl:[\s\S]*directPostClaimState:/,
  );
  assert.match(beforeAuthorization, /upload: null/);
});

test("every upload surface persists the direct POST cursor before offering retry", () => {
  const surfaces = [
    "src/components/admin/course-media-source-field.tsx",
    "src/components/media/profile-media-asset-field.tsx",
    "src/components/media/image-asset-upload-field.tsx",
    "src/components/academy/submission-attachment-uploader.tsx",
    "src/components/academy/community-attachments.tsx",
  ];
  for (const path of surfaces) {
    const component = readFileSync(path, "utf8");
    assert.match(component, /directPostResume/);
    assert.match(component, /onDirectPostResumeChange/);
  }
  const image = readFileSync(
    "src/components/media/image-asset-upload-field.tsx",
    "utf8",
  );
  assert.match(image, /retryUploadRef/);
  assert.match(image, /onClick=\{retryUpload\}/);
});

test("direct POST control state stays out of public media and privacy exports", () => {
  const inventory = readFileSync("src/lib/privacy/data-inventory.ts", "utf8");
  const assetService = readFileSync("src/lib/media/asset-service.ts", "utf8");
  const mediaInventory = inventory.slice(
    inventory.indexOf("media_assets: table("),
    inventory.indexOf("media_upload_sessions: table("),
  );
  assert.match(mediaInventory, /"direct_upload_claim_token"/);
  assert.match(mediaInventory, /"direct_upload_claimed_at"/);
  const publicAsset = assetService.slice(
    assetService.indexOf("export function publicMediaAsset"),
    assetService.indexOf("export async function", assetService.indexOf("export function publicMediaAsset")),
  );
  assert.doesNotMatch(publicAsset, /directUploadClaim/);
});

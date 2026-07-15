import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const globalStyles = readFileSync("src/app/globals.css", "utf8");
const rootLayout = readFileSync("src/app/layout.tsx", "utf8");
const adminCreateDialog = readFileSync(
  "src/components/admin/admin-create-dialog.tsx",
  "utf8",
);
const loginForm = readFileSync("src/components/auth/login-form.tsx", "utf8");
const mfaLoginForm = readFileSync(
  "src/components/auth/mfa-login-form.tsx",
  "utf8",
);
const aiAgentActionReview = readFileSync(
  "src/components/admin/ai-agent-action-review.tsx",
  "utf8",
);
const settingsForm = readFileSync(
  "src/components/admin/settings-form.tsx",
  "utf8",
);
const groupDetailManager = readFileSync(
  "src/components/admin/group-detail-manager.tsx",
  "utf8",
);
const bundleDetailManager = readFileSync(
  "src/components/admin/bundle-detail-manager.tsx",
  "utf8",
);
const hubEditor = readFileSync(
  "src/components/admin/hub-editor.tsx",
  "utf8",
);
const hydrationHook = readFileSync("src/lib/use-hydrated.ts", "utf8");
const announcementManager = readFileSync(
  "src/components/admin/announcement-manager.tsx",
  "utf8",
);
const announcementLayer = readFileSync(
  "src/components/academy/announcement-layer.tsx",
  "utf8",
);
const communityFeed = readFileSync(
  "src/components/academy/community-feed.tsx",
  "utf8",
);
const courseBuilder = readFileSync(
  "src/components/admin/course-builder.tsx",
  "utf8",
);
const courseExplorer = readFileSync(
  "src/components/admin/course-explorer.tsx",
  "utf8",
);
const courseChangeOverview = readFileSync(
  "src/components/admin/course-change-overview.tsx",
  "utf8",
);
const apiConsole = readFileSync(
  "src/components/admin/api-console.tsx",
  "utf8",
);
const privacyRequestDetail = readFileSync(
  "src/components/admin/privacy-request-detail.tsx",
  "utf8",
);
const customFieldManager = readFileSync(
  "src/components/admin/custom-field-manager.tsx",
  "utf8",
);
const notificationCenter = readFileSync(
  "src/components/layout/notification-center.tsx",
  "utf8",
);
const nativeStartSettings = readFileSync(
  "src/components/admin/native-start-settings.tsx",
  "utf8",
);

test("global styles do not block progressive button interaction before hydration", () => {
  assert.doesNotMatch(globalStyles, /not\(\[data-app-hydrated[^\n]*button/);
  assert.doesNotMatch(rootLayout, /AppHydrationStatus/);
});

test("client-only admin create controls stay semantically disabled during SSR", () => {
  assert.match(adminCreateDialog, /useHydrated\(\)/);
  assert.match(adminCreateDialog, /disabled=\{!hydrated\}/);
});

test("client-only AI action decisions stay semantically disabled during SSR", () => {
  assert.match(aiAgentActionReview, /useHydrated\(\)/);
  assert.equal(
    (aiAgentActionReview.match(/disabled=\{!hydrated\}/g) ?? []).length,
    2,
  );
});

test("client-managed design submission waits for hydration", () => {
  assert.match(settingsForm, /useHydrated\(\)/);
  assert.match(
    settingsForm,
    /disabled=\{!hydrated \|\| pending \|\| currentSignature === savedSignature\}/,
  );
});

test("admin access detail mutations wait for their local client hydration", () => {
  assert.match(groupDetailManager, /const hydrated = useHydrated\(\)/);
  assert.ok(
    (groupDetailManager.match(/disabled=\{pending \|\| !hydrated\}/g) ?? [])
      .length >= 5,
    "group save, add, and removal controls must wait for hydration",
  );

  assert.match(bundleDetailManager, /const hydrated = useHydrated\(\)/);
  assert.ok(
    (bundleDetailManager.match(/disabled=\{pending \|\| !hydrated\}/g) ?? [])
      .length >= 6,
    "bundle save, course, policy, and removal controls must wait for hydration",
  );
});

test("hub entry actions use a local semantic hydration gate", () => {
  assert.match(hubEditor, /const hydrated = useHydrated\(\)/);
  assert.match(
    hubEditor,
    /const clientActionsDisabled = pending \|\| !hydrated/,
  );
  assert.ok(
    (hubEditor.match(/disabled=\{clientActionsDisabled\}/g) ?? []).length >= 8,
    "directly rendered hub actions must share the local hydration gate",
  );
  assert.match(hubEditor, /value=\{subjectType\}\s+disabled=\{!hydrated\}/);
});

test("client-managed login submissions wait for hydration", () => {
  assert.match(loginForm, /useHydrated\(\)/);
  assert.ok(
    (loginForm.match(/disabled=\{!hydrated\}/g) ?? []).length >= 5,
    "all controlled login inputs and actions must wait for hydration",
  );
  assert.match(loginForm, /disabled=\{pending \|\| !hydrated\}/);
});

test("shared hydration detector has a stable false server snapshot", () => {
  assert.match(hydrationHook, /useSyncExternalStore\(/);
  assert.match(hydrationHook, /hydratedServerSnapshot\s*=\s*\(\)\s*=>\s*false/);
  assert.match(mfaLoginForm, /useHydrated\(\)/);
});

test("client-managed announcement controls wait for local hydration", () => {
  assert.match(announcementManager, /const hydrated = useHydrated\(\)/);
  assert.ok(
    (announcementManager.match(/disabled=\{!hydrated\}/g) ?? []).length >= 5,
    "announcement search, create, edit, and delete controls must wait for hydration",
  );
  assert.match(announcementLayer, /const hydrated = useHydrated\(\)/);
  assert.equal(
    (announcementLayer.match(/disabled=\{pending \|\| !hydrated\}/g) ?? [])
      .length,
    2,
  );
});

test("community composer entry and submission wait for local hydration", () => {
  assert.match(communityFeed, /const hydrated = useHydrated\(\)/);
  assert.match(
    communityFeed,
    /disabled=\{!hydrated \|\| !availableSpaces\.length \|\| !profileAllowsPosting\}/,
  );
  assert.match(
    communityFeed,
    /disabled=\{\s*!hydrated \|\|\s*pending \|\|\s*!attachmentsReady \|\|\s*!profileAllowsPosting\s*\}/,
  );
});

test("course navigation and creation controls wait for local hydration", () => {
  assert.match(courseBuilder, /const hydrated = useHydrated\(\)/);
  assert.match(
    courseBuilder,
    /aria-selected=\{activeTab === tab\}\s+disabled=\{!hydrated\}/,
  );
  assert.match(courseExplorer, /const hydrated = useHydrated\(\)/);
  assert.match(
    courseExplorer,
    /<Button disabled=\{!hydrated\} onClick=\{\(\) => setDialogOpen\(true\)\}>/,
  );
});

test("course change dialog triggers wait for local hydration", () => {
  assert.match(courseChangeOverview, /const hydrated = useHydrated\(\)/);
  assert.equal(
    (courseChangeOverview.match(/disabled=\{!hydrated\}/g) ?? []).length,
    2,
  );
});

test("API key dialog trigger waits for local hydration", () => {
  assert.match(apiConsole, /const hydrated = useHydrated\(\)/);
  assert.match(
    apiConsole,
    /role="tab"[\s\S]*?onClick=\{\(\) => setActiveTab\(id\)\}[\s\S]*?disabled=\{!hydrated\}/,
  );
  assert.match(
    apiConsole,
    /onClick=\{\(\) => setCreateKeyOpen\(true\)\}\s+disabled=\{!hydrated\}/,
  );
});

test("privacy request mutation dialogs wait for local hydration", () => {
  assert.match(privacyRequestDetail, /const hydrated = useHydrated\(\)/);
  assert.match(
    privacyRequestDetail,
    /onClick=\{\(\) => setWorkflowAction\(kind\)\}\s+disabled=\{!hydrated\}/,
  );
  assert.match(
    privacyRequestDetail,
    /onClick=\{\(\) => setHoldOpen\(true\)\}\s+disabled=\{!hydrated\}/,
  );
  assert.match(
    privacyRequestDetail,
    /onClick=\{\(\) => setReleaseHold\(hold\)\} disabled=\{!hydrated\}/,
  );
  assert.match(
    privacyRequestDetail,
    /onClick=\{\(\) => setDownloadArtifact\(artifact\)\} disabled=\{!hydrated\}/,
  );
});

test("custom field delete dialogs wait for local hydration", () => {
  assert.match(customFieldManager, /const hydrated = useHydrated\(\)/);
  assert.equal(
    (customFieldManager.match(
      /onClick=\{\(\) => setDeleteTarget\(field\)\}\s+disabled=\{!hydrated\}/g,
    ) ?? []).length,
    2,
  );
});

test("notification center trigger waits for local hydration", () => {
  assert.match(notificationCenter, /const hydrated = useHydrated\(\)/);
  assert.match(notificationCenter, /aria-controls=\{panelId\}[\s\S]*disabled=\{!hydrated\}/);
});

test("native app-start controls wait for local hydration", () => {
  assert.match(nativeStartSettings, /const hydrated = useHydrated\(\)/);
  assert.match(nativeStartSettings, /disabled=\{!hydrated \|\| pending\}/);
  assert.match(
    nativeStartSettings,
    /disabled=\{!hydrated \|\| pending \|\| selected === saved\}/,
  );
});

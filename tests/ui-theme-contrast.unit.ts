import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { colorContrast } from "../src/lib/branding-model";

const globalStyles = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

function cssBlock(selector: string) {
  const selectorIndex = globalStyles.indexOf(selector);
  assert.notEqual(selectorIndex, -1, `Missing CSS selector: ${selector}`);
  const openingBrace = globalStyles.indexOf("{", selectorIndex);
  const closingBrace = globalStyles.indexOf("}", openingBrace);
  assert.notEqual(openingBrace, -1, `Missing opening brace for ${selector}`);
  assert.notEqual(closingBrace, -1, `Missing closing brace for ${selector}`);
  return globalStyles.slice(openingBrace + 1, closingBrace);
}

function colorToken(block: string, token: string) {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(
    new RegExp(`${escapedToken}:\\s*(#[0-9a-f]{6})`, "i"),
  );
  assert.ok(match, `Missing hex value for ${token}`);
  return match[1];
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && target.endsWith(".tsx") ? [target] : [];
  });
}

test("theme text tokens meet WCAG AA on theme surfaces", () => {
  const themes = [
    { name: "light", block: cssBlock(":root") },
    { name: "dark", block: cssBlock('html[data-color-mode="dark"]') },
  ];
  const textTokens = [
    "--theme-strong-text",
    "--theme-muted-text",
    "--theme-teal-text",
    "--theme-blue-text",
    "--theme-coral-text",
    "--theme-amber-text",
  ];
  const backgroundTokens = [
    "--theme-layer-background",
    "--theme-input-background",
  ];

  for (const theme of themes) {
    for (const textToken of textTokens) {
      for (const backgroundToken of backgroundTokens) {
        const foreground = colorToken(theme.block, textToken);
        const background = colorToken(theme.block, backgroundToken);
        assert.ok(
          colorContrast(foreground, background) >= 4.5,
          `${theme.name} ${textToken} on ${backgroundToken} must meet 4.5:1`,
        );
      }
    }
  }
});

test("visible placeholders use only the adaptive muted text token", () => {
  for (const file of sourceFiles("src")) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/placeholder:text-\[[^\]]+\]/g)) {
      assert.equal(
        match[0],
        "placeholder:text-[var(--theme-muted-text)]",
        `${file} contains a non-adaptive placeholder color`,
      );
    }
  }
});

test("audited UI contrast fixes remain tokenized", () => {
  const contracts: Array<{
    file: string;
    required: RegExp[];
    forbidden: RegExp[];
  }> = [
    {
      file: "src/components/academy/ai-concierge.tsx",
      required: [
        /text-xs text-\[var\(--theme-muted-text\)\]/,
        /placeholder:text-\[var\(--theme-muted-text\)\]/,
      ],
      forbidden: [/text-\[#6f7e88\]/, /placeholder:text-\[#86959e\]/],
    },
    {
      file: "src/components/academy/ai-workspace.tsx",
      required: [
        /text-xs text-\[var\(--theme-muted-text\)\]/,
        /placeholder:text-\[var\(--theme-muted-text\)\]/,
      ],
      forbidden: [/text-\[#72808a\]/, /placeholder:text-\[#87959e\]/],
    },
    {
      file: "src/components/academy/embedded-ai-agent.tsx",
      required: [/placeholder:text-\[var\(--theme-muted-text\)\]/],
      forbidden: [/placeholder:text-\[#87959e\]/],
    },
    {
      file: "src/components/academy/community-feed.tsx",
      required: [
        /bg-\[var\(--theme-layer-background\)\]/,
        /text-\[var\(--theme-teal-text\)\]/,
      ],
      forbidden: [/text-\[#4b817b\]/, /hover:bg-\[#f0f8f7\]/],
    },
    {
      file: "src/components/admin/custom-domain-panel.tsx",
      required: [
        /bg-\[var\(--theme-layer-background\)\]/,
        /text-\[var\(--theme-muted-text\)\]/,
      ],
      forbidden: [
        /text-\[#6c7c7a\]/,
        /text-\[#667773\]/,
        /text-\[#75828c\]/,
        /bg-\[#f4f9f8\]/,
      ],
    },
    {
      file: "src/components/academy/lesson-content.tsx",
      required: [
        /text-center text-\[10px\] text-\[var\(--theme-muted-text\)\]/,
        /border-\[#f1c7c1\] bg-\[var\(--theme-layer-background\)\]/,
      ],
      forbidden: [/text-\[#7a8791\]/, /bg-\[#fffafa\]/],
    },
    {
      file: "src/components/academy/submission-recorder.tsx",
      required: [/text-\[var\(--theme-coral-text\)\]/],
      forbidden: [/text-\[#9a746e\]/, /hover:bg-\[#fff5f3\]/],
    },
    {
      file: "src/components/academy/submission-attachment-uploader.tsx",
      required: [
        /text-\[var\(--theme-coral-text\)\]/,
        /bg-\[var\(--theme-layer-background\)\]/,
      ],
      forbidden: [/text-\[#9a746e\]/, /bg-\[#fffafa\]/],
    },
    {
      file: "src/components/admin/admin-create-dialog.tsx",
      required: [/placeholder:text-\[var\(--theme-muted-text\)\]/],
      forbidden: [/placeholder:text-\[#9aa3aa\]/],
    },
  ];

  for (const contract of contracts) {
    const source = readFileSync(contract.file, "utf8");
    for (const pattern of contract.required) {
      assert.match(source, pattern, `${contract.file} is missing ${pattern}`);
    }
    for (const pattern of contract.forbidden) {
      assert.doesNotMatch(source, pattern, `${contract.file} still contains ${pattern}`);
    }
  }

  const brandTextFiles = [
    "src/app/password/reset/page.tsx",
    "src/app/password/forgot/page.tsx",
    "src/app/invitations/[token]/page.tsx",
    "src/components/academy/member-welcome-modal.tsx",
  ];
  for (const file of brandTextFiles) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /text-\[var\(--theme-teal-text\)\]/, file);
    assert.doesNotMatch(source, /text-\[var\(--brand-accent\)\]/, file);
  }

  const settingsSource = readFileSync(
    "src/components/admin/settings-form.tsx",
    "utf8",
  );
  assert.match(
    settingsSource,
    /text-\[8px\] font-bold uppercase text-\[var\(--theme-teal-text\)\]/,
  );
  assert.doesNotMatch(
    settingsSource,
    /text-\[8px\] font-bold uppercase text-\[var\(--brand-accent\)\]/,
  );

  const metadataFiles = [
    "src/components/admin/course-module-access-admin.tsx",
    "src/app/(member)/academy/community/members/[id]/page.tsx",
  ];
  for (const file of metadataFiles) {
    assert.match(
      readFileSync(file, "utf8"),
      /text-\[var\(--theme-muted-text\)\]/,
      file,
    );
  }
});

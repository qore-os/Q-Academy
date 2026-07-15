import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hubCreateSchema } from "../src/lib/api/schemas";
import { hubCustomCodeDocument } from "../src/lib/hub-custom-code";
import { HUB_CUSTOM_CODE_MAX_LENGTH } from "../src/lib/hub-custom-code-policy";
import { resolveHubLayoutVariables } from "../src/lib/hub-variables";

const nonce = "0123456789abcdef0123456789abcdef";
const code = `<style>button{color:teal}</style><button id="run">Run</button><script nonce="forged">document.querySelector('#run').onclick=()=>document.body.dataset.ready='yes'</script>`;

test("hub custom code receives an originless, network-denying sandbox document", () => {
  const document = hubCustomCodeDocument(code, nonce);
  assert.ok(document);
  assert.match(document, /Content-Security-Policy/);
  assert.match(document, /default-src 'none'/);
  assert.match(document, /base-uri 'none'/);
  assert.match(document, /worker-src 'none'/);
  assert.match(document, /connect-src 'none'/);
  assert.match(document, /form-action 'none'/);
  assert.match(document, /manifest-src 'none'/);
  assert.match(document, /script-src 'unsafe-inline'/);
  assert.match(document, /<button id="run">Run<\/button>/);
  assert.match(document, new RegExp(`<script nonce="${nonce}">`));
  assert.doesNotMatch(document, /nonce="forged"/);
  assert.equal(hubCustomCodeDocument("", nonce), null);
  assert.equal(hubCustomCodeDocument(code, "forged"), null);
  assert.equal(
    hubCustomCodeDocument(
      "x".repeat(HUB_CUSTOM_CODE_MAX_LENGTH + 1),
      nonce,
    ),
    null,
  );
});

test("hub API accepts bounded code but keeps ordinary descriptions small", () => {
  const base = {
    title: "Sandbox",
    status: "published" as const,
    layout: [
      {
        id: "main",
        columns: [{ type: "code" as const, title: "Demo", description: code }],
      },
    ],
  };
  assert.equal(hubCreateSchema.safeParse(base).success, true);
  const exactCode = `\n${"x".repeat(HUB_CUSTOM_CODE_MAX_LENGTH - 2)}\n`;
  const exactResult = hubCreateSchema.safeParse({
    ...base,
    layout: [
      {
        id: "main",
        columns: [{ type: "code", title: "Demo", description: exactCode }],
      },
    ],
  });
  assert.equal(exactResult.success, true);
  if (exactResult.success) {
    assert.equal(exactResult.data.layout[0]?.columns[0]?.description, exactCode);
  }
  assert.equal(
    hubCreateSchema.safeParse({
      ...base,
      layout: [
        {
          id: "main",
          columns: [
            { type: "code", title: "Demo", description: " \n \t" },
          ],
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    hubCreateSchema.safeParse({
      ...base,
      layout: [
        {
          id: "main",
          columns: [
            {
              type: "code",
              title: "Demo",
              description: "x".repeat(HUB_CUSTOM_CODE_MAX_LENGTH + 1),
            },
          ],
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    hubCreateSchema.safeParse({
      ...base,
      layout: [
        {
          id: "main",
          columns: [
            { type: "text", title: "Demo", description: "x".repeat(2001) },
          ],
        },
      ],
    }).success,
    false,
  );
});

test("member variables never enter executable hub code", () => {
  const [row] = resolveHubLayoutVariables(
    [
      {
        id: "main",
        columns: [
          {
            type: "code",
            title: "Welcome {{member.firstName}}",
            description: `<p>{{member.firstName}}</p>`,
          },
          {
            type: "text",
            title: "Hello",
            description: "Welcome {{member.firstName}}",
          },
        ],
      },
    ],
    {
      member: { firstName: "<script>unsafe</script>", lastName: "Member" },
      course: null,
    },
  );
  assert.equal(row?.columns[0]?.title, "Welcome <script>unsafe</script>");
  assert.equal(row?.columns[0]?.description, `<p>{{member.firstName}}</p>`);
  assert.equal(
    row?.columns[1]?.description,
    "Welcome <script>unsafe</script>",
  );
});

test("member hub renders code only through the restricted iframe", () => {
  const source = readFileSync("src/app/(member)/academy/hub/page.tsx", "utf8");
  assert.match(source, /srcDoc=\{sandboxDocument\}/);
  assert.match(source, /const sandboxNonce = requestHeaders\.get\("x-nonce"\)/);
  assert.match(
    source,
    /hubCustomCodeDocument\(\s*widget\.description,\s*sandboxNonce,\s*\)/,
  );
  assert.match(source, /sandbox="allow-scripts"/);
  assert.match(source, /referrerPolicy="no-referrer"/);
  assert.match(source, /allow=""/);
  assert.match(source, /data-hub-code-sandbox="true"/);
  assert.doesNotMatch(source, /sandbox="[^"]*allow-same-origin/);
  assert.doesNotMatch(source, /<code>\{widget\.description\}<\/code>/);
});

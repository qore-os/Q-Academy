import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  "src/app/(admin)/admin/members/[id]/page.tsx",
  "utf8",
);
const dataService = readFileSync("src/lib/data.ts", "utf8");

test("admin member detail gates profile loading behind the tenant member lookup", () => {
  assert.match(page, /const memberIdSchema = z\.string\(\)\.uuid\(\);/);
  assert.match(
    page,
    /if \(!memberIdSchema\.safeParse\(id\)\.success\) notFound\(\);/,
  );

  const memberLookup = page.indexOf(
    "const data = await getAdminMemberProfile(id, actor.organizationId);",
  );
  const tenantGuard = page.indexOf("if (!data) notFound();");
  const profileLookup = page.lastIndexOf("getMemberDataProfileBundle({");

  assert.ok(memberLookup >= 0, "tenant-bound member lookup is required");
  assert.ok(
    tenantGuard > memberLookup,
    "a missing tenant member must terminate as 404",
  );
  assert.ok(
    profileLookup > tenantGuard,
    "profile loading must not start before the tenant guard",
  );
  assert.match(page, /organizationId: actor\.organizationId/);
  assert.match(page, /error instanceof DataProfileNotFoundError/);
  assert.doesNotMatch(
    page,
    /const \[data,\s*profiles,\s*locale\] = await Promise\.all/,
  );

  const loaderStart = dataService.indexOf(
    "export async function getAdminMemberProfile",
  );
  const loaderEnd = dataService.indexOf(
    "\nexport async function ",
    loaderStart + 1,
  );
  const memberLoader = dataService.slice(
    loaderStart,
    loaderEnd >= 0 ? loaderEnd : undefined,
  );

  assert.ok(loaderStart >= 0, "member profile service is required");
  assert.match(memberLoader, /eq\(users\.id, memberId\)/);
  assert.match(
    memberLoader,
    /eq\(users\.organizationId, organizationId\)/,
  );
});

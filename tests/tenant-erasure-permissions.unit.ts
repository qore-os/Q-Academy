import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const permissions = await readFile(
  new URL("../scripts/ops/database-permissions-entrypoint.sh", import.meta.url),
  "utf8",
);

test("runtime app role cannot create receipts or physically delete tenants", () => {
  assert.match(
    permissions,
    /revoke all on table public\.tenant_erasure_receipts, public\.tenant_erasure_events\s+from :"app_user";/,
  );
  assert.match(
    permissions,
    /revoke delete on table public\.organizations from :"app_user";/,
  );
  assert.match(
    permissions,
    /revoke update, delete on table public\.webhook_delivery_attempts from :"app_user";/,
  );
  assert.match(
    permissions,
    /not has_table_privilege\(:'app_user', 'public\.tenant_erasure_receipts', 'INSERT'\)/,
  );
  assert.match(
    permissions,
    /not has_table_privilege\(:'app_user', 'public\.organizations', 'DELETE'\)/,
  );
  assert.match(
    permissions,
    /not has_table_privilege\(:'app_user', 'public\.webhook_delivery_attempts', 'UPDATE'\)/,
  );
  assert.match(permissions, /tenant_erasure_privileges_are_operator_only/);
});

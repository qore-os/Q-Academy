import assert from "node:assert/strict";
import test from "node:test";

import {
  publicBrandingFromRows,
  type BrandingRow,
  type PublicBrandingHostConfiguration,
} from "../src/lib/branding";

const rows: BrandingRow[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Q Academy",
    slug: "q-academy",
    primaryColor: "#17324d",
    accentColor: "#2bb7a9",
    logoMark: "Q",
    settings: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Academy Tenant",
    slug: "academy",
    primaryColor: "#123456",
    accentColor: "#654321",
    logoMark: "A",
    settings: null,
    verifiedLoginHostname: "login.customer.de",
  },
];

const productionConfiguration: PublicBrandingHostConfiguration = {
  appDomain: "academy.q-academy.de",
  publicAppUrl: "https://academy.q-academy.de",
  defaultOrganizationSlug: "q-academy",
  tenantBaseDomain: "q-academy.de",
  allowLocalhostHosts: false,
};

test("exact canonical platform host resolves only to the configured default tenant", () => {
  const branding = publicBrandingFromRows(
    rows,
    "academy.q-academy.de:443",
    productionConfiguration,
  );
  assert.equal(branding.organizationId, rows[0]?.id);
  assert.equal(branding.organizationSlug, "q-academy");

  const missingDefault = publicBrandingFromRows(
    rows.slice(1),
    "academy.q-academy.de",
    productionConfiguration,
  );
  assert.equal(missingDefault.organizationId, null);
  assert.equal(missingDefault.organizationSlug, null);
});

test("unknown and locally forged production hosts remain tenantless", () => {
  for (const hostname of [
    "unknown.q-academy.de",
    "www.academy.q-academy.de",
    "localhost",
    "academy.localhost",
  ]) {
    const branding = publicBrandingFromRows(
      rows,
      hostname,
      productionConfiguration,
    );
    assert.equal(branding.organizationId, null, hostname);
    assert.equal(branding.organizationSlug, null, hostname);
  }
});

test("valid custom and tenant hosts remain isolated from the platform host", () => {
  assert.equal(
    publicBrandingFromRows(
      rows,
      "login.customer.de",
      productionConfiguration,
    ).organizationSlug,
    "academy",
  );
  assert.equal(
    publicBrandingFromRows(
      rows,
      "q-academy.q-academy.de",
      productionConfiguration,
    ).organizationSlug,
    "q-academy",
  );
});

test("conflicting canonical configuration disables all tenant host resolution", () => {
  const branding = publicBrandingFromRows(rows, "academy.q-academy.de", {
    ...productionConfiguration,
    appDomain: "login.q-academy.de",
  });
  assert.equal(branding.organizationId, null);
  assert.equal(branding.organizationSlug, null);
});

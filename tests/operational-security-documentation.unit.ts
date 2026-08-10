import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const readme = source("README.md");
const readiness = source("PRODUCTION_READINESS_PLAN.md");
const mfa = source("docs/MFA_SECURITY.md");
const oidc = source("docs/OIDC_SSO.md");
const threatModel = source("docs/THREAT_MODEL.md");
const deployment = source("docs/ROOTSERVER_DEPLOYMENT.md");
const retention = source("docs/DATA_RETENTION_AND_DSAR.md");
const ci = source(".github/workflows/ci.yml");

test("operations documentation covers the current privileged MFA roles", () => {
  assert.match(readme, /TOTP-MFA fuer Owner, Admins und Trainer/);
  assert.match(readiness, /TOTP-MFA fuer Owner,[\s\S]*Admins und Trainer/);
  assert.match(mfa, /`owner`, `admin` und `trainer`/);
  assert.match(threatModel, /Owner, Admins und Trainer mit aktiver MFA/);
});

test("OIDC UI mutations document fresh owner and conditional MFA step-up", () => {
  assert.match(
    oidc,
    /Interaktive Mutationen der OIDC-Konfiguration verlangen diesen frischen[\s\S]*Ist die persoenliche MFA des Owners[\s\S]*bevor die Anwendung den konfigurierten Provider kontaktiert/,
  );
  assert.match(oidc, /`PATCH`-API-Vertrag bleibt an einen `authentication:write`/);
  assert.match(readme, /Jede interaktive[\s\S]*Konfigurationsaenderung verlangt einen frischen Owner-Step-up/);
  assert.match(oidc, /tests\/oidc-settings-step-up\.unit\.ts/);
});

test("worker documentation fixes every internal batch maximum", () => {
  assert.match(deployment, /Job-Dispatch akzeptiert `limit` von 1 bis 100/);
  assert.match(deployment, /`cleanupLimit` von 1 bis 1000/);
  assert.match(deployment, /Webhook-Dispatch `limit` von 1 bis 100/);
  assert.match(deployment, /Medien-Dispatch exakt[\s\S]*`limit=1`/);
  assert.match(deployment, /Medienwartung `limit` von 1 bis 5/);
  assert.match(deployment, /HTTP 400 als[\s\S]*`application\/problem\+json`/);
  assert.match(retention, /`1000` ist[\s\S]*die harte Obergrenze der Route/);
});

test("documentation binds the production smoke to the exact CI image", () => {
  assert.match(ci, /name: Smoke-test exact production app image/);
  assert.match(ci, /PLAYWRIGHT_EXPECTED_RELEASE/);
  assert.match(ci, /Production app image identity changed during the browser smoke/);
  assert.match(readme, /CI-Workflow prueft das exakte Produktions-App-Image/);
  assert.match(readiness, /Produktions-App-Image wird per[\s\S]*Browser-Smoke/);
});

test("Caddy dependency remediation remains content-pinned and release-auditable", () => {
  assert.match(
    deployment,
    /CVE-2026-56852[\s\S]*`golang[.]org\/x\/text` `v0[.]39[.]0`/,
  );
  assert.match(
    deployment,
    /GHSA-hrxh-6v49-42gf[\s\S]*`google[.]golang[.]org\/grpc` `v1[.]82[.]1`/,
  );
  assert.match(
    deployment,
    /elf weitere Abhaengigkeiten[\s\S]*Alle 13 Versionspaare[\s\S]*`scripts\/ops\/caddy-module-patch[.]lock`/,
  );
  assert.match(
    deployment,
    /`go mod tidy`[\s\S]*`go mod verify`[\s\S]*548-zeiligen Endgraphen[\s\S]*`go[.]mod`[\s\S]*`go[.]sum`/,
  );
  assert.match(
    deployment,
    /Lockfile-Inhalt und alle Graph-Hashes[\s\S]*`release-build[.]env`/,
  );
  assert.match(
    deployment,
    /Trivy[\s\S]*fixbare `HIGH`- oder `CRITICAL`-Befunde/,
  );
});

test("external production and acceptance gates remain open", () => {
  assert.match(readiness, /- \[ \] Produktionsartefakt und CI\/CD sind reproduzierbar/);
  assert.match(readiness, /- \[ \] Managed PostgreSQL, PITR und Restore-Test sind gruen/);
  assert.match(readiness, /- \[ \] Unabhaengigen Penetrationstest beauftragen/);
  assert.match(readiness, /- \[ \] Datenschutzhinweise, Impressum, AVV, TOMs und Subprozessoren sind freigegeben/);
  assert.match(readiness, /- \[ \] Verteilte Rate-Limits und KI-Budgets funktionieren unter Last/);
  assert.match(readiness, /- \[ \] Formales Go\/No-Go wurde von Engineering, Operations, Security, Product und Legal signiert/);
  assert.match(readiness, /Rootserver-\/Staging-[\s\S]*Lasttests/);
  assert.match(readiness, /Rootserver-Verifikation bleiben extern abzunehmen/);
  assert.match(oidc, /reale IdP-Clientregistrierung je Tenant/);
});

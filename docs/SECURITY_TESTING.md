# Security testing

## Complete Git-history secret scan

`npm run security:scan-secrets` checks the current tracked worktree and prints
only the rule and location of a finding, never the matched credential. Before a
release, run the stronger repository gate from the repository root:

```bash
npm run security:scan-secrets:history
```

The history mode first performs the worktree scan and then requires a complete,
non-shallow Git repository. It verifies object connectivity with `git fsck`,
disables replacement objects and inventories every object reachable from all
local refs. Every blob, commit and annotated-tag payload is read by verified
object ID. Binary blobs are scanned too. Trees contain only structural object
references and are not interpreted as credential-bearing content.

The reader batches objects to bound memory. A payload over 64 MiB, malformed or
missing object metadata, a truncated object stream, an incomplete checkout, or
Git failure blocks the scan instead of silently reducing coverage. CI uses
`actions/checkout` with `fetch-depth: 0` and runs this history gate on every
verification job.

A historical finding is reported as
`git-object:<object-id>:<type>:<line>:<column>` plus its rule. Locate the commits
without printing the secret itself:

```bash
git log --all --find-object=<object-id> --oneline --name-status
```

Treat every real finding as compromised: revoke and rotate the credential,
remove it from reachable history using a reviewed rewrite, and rerun the full
gate. Deleting the current file alone is insufficient. The scanner has no
credential-value allowlist.

## Passive DAST baseline

CI runs OWASP ZAP `2.17.0` against the disposable production application at
`http://academy.ci.q-academy.de:3000/`. The image is pinned by tag and multiarch
SHA-256 digest in `.github/workflows/ci.yml`. The context in
`deploy/security/zap-ci.context` limits crawling to that exact local origin and
excludes internal job and OIDC callback routes. The scan has no credentials and
does not enable the Ajax spider, alpha rules, API scan, full scan, or active
scanner.

`deploy/security/zap-baseline.conf` promotes browser-policy, cookie,
information-disclosure, mixed-content, vulnerable-library, and application-error
alerts to `FAIL`. Unlisted alerts retain ZAP's `WARN` default. The runner does not
use `-I`, so both new warnings and configured failures block CI; scanner startup,
timeout, connectivity, and report errors also return a failing status.

ZAP can configure only a whole rule family, while CSP rule `10055` contains
separate sub-alerts. Rules `10055` and `10202` are therefore marked `INFO` only
at the scanner layer and passed to
`scripts/ci/validate-zap-baseline.ts`. That validator pins the exact ZAP version,
origin, alert references, routes, methods, counts, evidence, and request details.
Its independently pinned CSP literal is not derived from the application's CSP
builder. It accepts only the exact login Server Action form, CSP `10055-4`, and
style-only `10055-6`. Script `unsafe-inline`, `unsafe-eval`, a changed CSP, an
extra form field, an unknown sub-alert, malformed JSON, or a second target remains
a hard failure. Exit codes from the scanner, validator, and both evidence writers
are preserved separately; none can mask another.

The scanner exceptions are narrowly bounded, but the underlying CSP network
sources are not host-bounded: the browser may load images, media and frames from
any HTTPS origin and connect to any HTTPS/WSS origin. This is a deliberate
residual risk, not a false positive. The application currently needs those
scheme sources for remote media, direct object-storage transfers, integrations,
configurable Hub embeds, and sandboxed tenant custom code. Those `srcdoc` frames
inherit the parent CSP, so replacing the scheme sources with a static global host
list would disable reviewed product functions. The validator compares every
reported policy byte-for-byte after replacing only the random nonce. Removing
this exposure requires a separately designed same-origin media/network proxy or
a centrally enforced origin allowlist plus existing-data migration. The style
exception covers the documented runtime stylesheet/UI-style contract; the
production script policy still requires a nonce and `strict-dynamic` and forbids
inline script attributes.

The login form is a Next.js Server Action. Next.js compares `Origin` with
`Host`/`X-Forwarded-Host` before executing an action; Q-Academy configures no
cross-origin exceptions. The exact production-image browser smoke rewrites a
real login action to a foreign Origin and requires HTTP 500 with no session
cookie. This is the counter-test for ZAP `10202`, which looks only for a hidden
token. Anonymous `GET /` requests are redirected in Proxy before page rendering;
unit and exact-production smoke tests require status 307, `Location: /login`, no
session cookie, `private, no-store` caching, and `Vary: Cookie`. Next.js 16 emits
the relative destination as the redirect body, so the exact-production smoke
test pins that body to the six bytes `/login`; rendered page data or any other
content fails the gate. ZAP `10044` is not demoted and remains a normal blocking
finding if that contract regresses.

The container runs read-only without Linux capabilities or new privileges, with
CPU, memory, process, and writable-tmpfs limits. Its only writable bind mount is
`.artifacts/zap-baseline`. ZAP runs with `-silent`, so the rules bundled into the
pinned image are not updated over the network during CI. HTML, JSON, Markdown,
log, exact policy/context snapshots, metadata, and exit-code evidence is uploaded
with `if: always()`, including failed scans.

Run the identical scan locally while the disposable CI production image is
listening on port 3000 and Docker is available:

```bash
CI_ZAP_IMAGE='zaproxy/zap-stable:2.17.0@sha256:8d387b1a63e3425beef4846e39719f5af2a787753af2d8b6558c6257d7a577a2' \
  bash scripts/ops/run-zap-baseline.sh
```

This unauthenticated passive baseline is a release gate, not a penetration test.
Abuse and load testing and an independent penetration test remain separate
launch gates.

## Authenticated active DAST

Authenticated role/tenant coverage is provided by the separately invoked harness
described in this section.

`scripts/ops/run-zap-active-authenticated.ts` is the destructive, operator-run
counterpart to the passive CI baseline. It is deliberately not a CI job. Run it
only on a disposable, isolated staging deployment containing synthetic data and
two dedicated synthetic users. The expected roles are exactly `owner` and
`member`; MFA, a role mismatch, or an existing session that cannot be revoked
makes the run fail closed.

The runner accepts only a canonical HTTPS origin on port 443. Both the origin
hostname and project slug must contain the exact marker `dast`, a staging marker
(`staging`, `stage`, `qa`, `test`, `sandbox`, or `preprod`), and an isolation
marker (`disposable`, `isolated`, or `ephemeral`). Production markers,
localhost, IP literals, paths, redirects, non-public DNS answers, and any mixed
public/private DNS result are rejected. The validated public IPv4 address is
pinned into the container with `--add-host` to prevent DNS rebinding.
Container DNS points to loopback, so only that pinned host can resolve during the
scan.

Create two distinct, current-UID-owned credential files with mode `0400`. Each
file has exactly this schema and its `organizationSlug` must equal the confirmed
project slug:

```json
{
  "email": "synthetic-role-user@example.invalid",
  "password": "a-stage-only-password-of-at-least-16-characters",
  "organizationSlug": "dast-ephemeral-staging"
}
```

On a Linux host with Docker, invoke the runner directly. The origin and project
must each be supplied twice and the destructive acknowledgement must match
exactly:

```bash
npx tsx scripts/ops/run-zap-active-authenticated.ts \
  --origin https://dast-ephemeral-staging.security.example.com \
  --confirm-origin https://dast-ephemeral-staging.security.example.com \
  --project dast-ephemeral-staging \
  --confirm-project dast-ephemeral-staging \
  --ack ACTIVE_DAST_DESTROYS_DISPOSABLE_STAGE \
  --owner-credentials-file /run/secrets/q-academy-dast-owner.json \
  --member-credentials-file /run/secrets/q-academy-dast-member.json \
  --output /secure/evidence/q-academy-zap-active.json
```

The immutable scanner image is
`zaproxy/zap-stable:2.17.0@sha256:8d387b1a63e3425beef4846e39719f5af2a787753af2d8b6558c6257d7a577a2`.
It runs read-only, as the invoking UID, without capabilities or new privileges,
with CPU, memory, process, and tmpfs limits. Credentials are mounted read-only;
they never appear in Docker arguments or environment variables.

The Automation Framework plan uses direct JSON authentication and cookie
session management for separate Owner and Member contexts. It verifies both
authenticated `/api/v1/me` requests, imports the bounded OpenAPI document,
runs traditional and strict-scope browser spiders, and then runs the QA CI/CD
active policy. Timing and out-of-band rules are excluded. Authentication,
logout, request counts, scan duration, crawl depth/state, threads, alerts per
rule, and total process runtime are bounded. Defaults are 90 minutes total, 5
minutes per traditional spider, 5 minutes per browser spider, 20 minutes per
role active scan, and 5,000 ZAP requests. CLI overrides may only reduce or stay
within the compiled hard maxima.
Both successful and failed ZAP network sends count against the request limit.

The raw plan, extended report, browser state, and any ZAP log exist only in the
container tmpfs. They are never copied to evidence or printed. The sole scanner
output is sanitized to a fixed JSON whitelist containing counts and alert IDs,
names, risk/confidence, CWE/WASC, and no URL, parameter, payload, evidence,
request, response, cookie, email, or password. The host validates that whitelist
again and writes the final report once, with mode `0600`; an existing output is
never overwritten.

Before the scan and unconditionally afterward, the host logs in as each test
identity, verifies its exact role, revokes every other active session, logs out
the control session, and requires `/api/v1/me` to return `401
authentication_required`. Container removal and this cleanup run after scanner
errors, request/time limits, and termination signals. A missing request counter,
unsafe report, cleanup failure, ZAP warning, Low-or-higher finding, timeout, or
nonzero container exit produces failing evidence and a nonzero runner exit.

This harness improves authenticated coverage but is not an independent
penetration test and must never be pointed at a customer or production tenant.

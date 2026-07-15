# Staging resilience drills

This runbook covers destructive service-dependency drills that exercise the
production Compose topology on a dedicated staging deployment. It does not
authorize a production outage. None of these scripts may be run against a
production origin, production-like Compose project, remote Docker context, or
non-Unix Docker endpoint.

`scripts/ops/drill-environment.sh` is the shared fail-closed target policy for
the worker, app-replica, and storage-pipeline drills. The operator must provide
and duplicate both the canonical HTTPS origin and explicit Compose project
name. They must also match `APP_DOMAIN` and `COMPOSE_PROJECT_NAME` in the
regular, non-symlink env file byte for byte. The storage drill additionally
requires a duplicated staging-marked bucket that exactly matches
`MEDIA_S3_BUCKET`, and binds the canonical external HTTPS
`MEDIA_S3_ENDPOINT`. The env file is parsed as data and never sourced. Only an
active local Docker Unix socket is accepted; `DOCKER_HOST` and
`DOCKER_CONTEXT` overrides are rejected. Compose runs under `env -i`, retaining
only the already verified Docker configuration paths plus `PATH`/`HOME`, so a
poisoned operator-shell variable cannot override values from the confirmed
`--env-file`.

## Database outage contract

`scripts/ops/staging-database-outage-drill.sh` stops the `postgres` service in
one explicitly named Compose project and verifies the public application
contract:

- `/api/v1/health/live` remains HTTP 200 while PostgreSQL is unavailable.
- `/api/v1/health/ready` changes from HTTP 200 to a non-200 response.
- PostgreSQL is restarted from an `EXIT` trap on success, failure, interruption,
  or termination.
- Both endpoints return HTTP 200 again before the drill can pass.
- `stdout` contains one versioned JSON report. Operational messages use
  `stderr`, and environment contents or credentials are never printed.

The script rejects localhost, IP literals, reserved DNS suffixes, production
host labels, and production-like Compose project names. The HTTPS hostname must
contain an exact `staging`, `stage`, `stg`, `preprod`, or `sandbox` DNS label.
The project name must contain the same kind of staging marker. The confirmed
hostname must also exactly match `APP_DOMAIN` in the supplied environment file.
Only the local Unix-socket Docker context is accepted; `DOCKER_HOST` and
`DOCKER_CONTEXT` overrides are rejected to prevent cross-host execution.

## Preconditions

1. Use a dedicated staging root server and a production-shaped Compose stack.
2. Confirm `app`, `caddy`, and `postgres` are running and both public health
   endpoints return HTTP 200.
3. Announce the exercise, suppress only the expected staging alerts, and assign
   an operator to watch database and application telemetry.
4. Verify a current PostgreSQL backup and a recent successful restore drill.
5. Use an absolute path to a readable regular environment file that is not a
   symbolic link. Do not source that file in the operator shell.

## Execute

Run from a checked-out release directory on the staging root server. Replace
the example hostname, environment path, and project name with the exact staging
deployment values:

```bash
bash scripts/ops/staging-database-outage-drill.sh \
  --origin https://academy.staging.customer-domain.com \
  --confirm-origin https://academy.staging.customer-domain.com \
  --ack STAGING_DATABASE_OUTAGE \
  --env-file /opt/q-academy/staging.env \
  --project-name q-academy-staging \
  >resilience-database-outage.json
```

The confirmation origin is intentionally duplicated and must match byte for
byte. HTTPS uses the standard port; credentials, explicit ports, paths, query
strings, fragments, mixed-case hosts, and trailing slashes are rejected.

Do not pipe the command through a construct that masks its exit status. A pass
returns exit code 0 and reports `"status":"passed"`. Any failed assertion or
failed recovery returns nonzero and reports `"status":"failed"`. A
`recovery_failed` result is an incident: keep the staging deployment out of
service, inspect the Compose project immediately, and restore PostgreSQL before
any other drill activity.

## Report schema

The JSON object contains:

- `schemaVersion`: currently `1`.
- `status` and `failureCode`: overall result and stable failure category.
- `origin` and `composeProject`: the validated non-secret target identifiers.
- `startedAt` and `endedAt`: UTC timestamps.
- `checks`: observed HTTP status codes for baseline, outage, and recovery.
- `recoveryAttempted` and `recovered`: explicit recovery evidence.

Archive the report with the change ticket, staging alert timeline, and operator
notes. The report is evidence for this dependency behavior only; it does not
replace restore, load, network-partition, storage-capacity, or provider-failure
testing.

## Job and media-worker outage contract

`scripts/ops/staging-worker-outage-drill.sh` stops the single `scheduler` and
all existing `media-worker` replicas, but keeps `app`, `caddy`, `media-runner`,
PostgreSQL, and ClamAV running. It proves the following bounded contract:

- public `/api/v1/health/live` and `/api/v1/health/ready` remain HTTP 200
  before, during, and after the worker outage;
- aggregate app and media queue depth is read inside the relevant containers
  from `/api/internal/metrics`; each bearer secret remains inside its container
  environment and only integer depth/failure totals cross the Docker boundary;
- after the workers stop, aggregate queue depth must increase above the
  measured baseline within 240 seconds;
- an `EXIT`/signal trap starts every stopped worker even when an assertion or
  operator interruption fails the drill;
- the production-shaped baseline has one healthy scheduler and exactly two
  healthy media-worker replicas, and those exact running counts return;
- queue depth drains back to or below baseline within 15 minutes without
  increasing the aggregate failed-job count.

The script does not insert synthetic database rows. During the four-minute
outage window an operator must create one legitimate, disposable staging job
through the normal product flow, for example a test email, webhook, push,
already-due test assessment, completed test upload, or media-processing job.
Run this on quiet dedicated staging so unrelated traffic cannot make the
baseline or drain claim ambiguous. No queue increase means a failed drill, not
a skipped assertion.

### Execute the worker drill

```bash
bash scripts/ops/staging-worker-outage-drill.sh \
  --origin https://academy.staging.customer-domain.com \
  --confirm-origin https://academy.staging.customer-domain.com \
  --project-name q-academy-staging \
  --confirm-project-name q-academy-staging \
  --ack STAGING_WORKER_OUTAGE \
  --env-file /opt/q-academy/staging.env \
  >resilience-worker-outage.json
```

The JSON report records only the confirmed origin/project, UTC timestamps,
HTTP status codes, aggregate queue/failed counts, replica counts, queue-growth
and drain booleans, and recovery state. It contains no payload, tenant, user,
recipient, object key, token, metric bearer secret, or env value. A
`recovery_failed` report is an incident; verify both services and queue claims
before continuing.

## Two-replica app drain contract

`scripts/ops/staging-app-replica-drain-drill.sh` temporarily scales the
confirmed Compose `app` service to exactly two replicas. Both containers must
belong to the confirmed project, run the same immutable local image ID, and
report healthy before destructive steps begin. The script then stops each
validated container once, sequentially, while the other must carry public
traffic.

Every phase requires HTTP 200 from live, ready, and `/api/v1/me`. The session
probe uses a private curl-compatible cookie jar for a disposable staging
account. The response is held in a mode-0700 temporary directory, reduced to an
in-memory SHA-256 fingerprint of user, tenant, and server-side session IDs, and
deleted by the trap. Neither cookie, response body, identity, session ID, nor
fingerprint is written to the evidence JSON. A pass proves that the same
server-side session survived both replica drains and final topology recovery.
Each single-replica phase requires six consecutive successful probe samples,
spanning at least one configured Caddy active-health interval; any observed
HTTP or session regression after the surviving replica is healthy fails closed.

The cookie jar must be an absolute regular non-symlink file owned by the
operator, have no group/world permission bits, and be between 1 byte and 16
KiB. Use a disposable account, create the jar immediately before the drill,
set mode 0600, and securely remove it afterward. Do not pass a cookie value on
the command line.

### Execute the app drill

```bash
chmod 0600 /run/q-academy/drill-session.cookies
bash scripts/ops/staging-app-replica-drain-drill.sh \
  --origin https://academy.staging.customer-domain.com \
  --confirm-origin https://academy.staging.customer-domain.com \
  --project-name q-academy-staging \
  --confirm-project-name q-academy-staging \
  --ack STAGING_APP_REPLICA_DRAIN \
  --env-file /opt/q-academy/staging.env \
  --session-cookie-file /run/q-academy/drill-session.cookies \
  >resilience-app-replica-drain.json
```

The trap starts validated stopped containers and restores the exact initial app
replica count on normal exit, assertion failure, interruption, and termination.
The final public health and session contract must pass after restoration. Do
not continue with another drill when `initialTopologyRestored` or `recovered`
is false.

## Media storage pipeline outage contract

`scripts/ops/staging-storage-pipeline-outage-drill.sh` exercises a bounded,
production-shaped media dependency failure. It requires the quiet staging
topology of one healthy `app`, `caddy`, `postgres`, `clamav`, and
`media-runner`, exactly two healthy `media-worker` replicas, and empty,
failure-free `media_scan` and `media_processing` queues. The supplied private
cookie jar must represent an active disposable member in a disposable staging
tenant.

The drill creates one tiny, unbound `community` text asset through the normal
session API with random per-run content. Its signed upload must target the
exact confirmed bucket, tenant, asset ID, canonical incoming key, and signed
asset/tenant metadata; the URL is never written to logs or evidence. It then
stops both validated media workers and
disconnects only the validated `media-runner` from the exact project-labeled
Compose egress network. Both the running app and runner environments must first
match the confirmed bucket and endpoint. Public live and ready endpoints must
remain HTTP 200, the runner's S3 probe must fail, the app's independently bound
storage path and direct upload through the provider contract must still
succeed, and internal dispatch must report `retrying`. The queue must rise to
exactly one pending item without a failed job. The Canary itself must record
its first scan attempt with `storage_unavailable`; a retry from any other job
or cause fails the drill. Run only on dedicated, quiescent staging so unrelated
jobs cannot cause a deliberate fail-closed abort.

Recovery reconnects the runner network before restarting the two workers,
waits for both to become healthy, and requires the asset to reach `ready` while
the queue drains to zero. The application download redirect is captured
privately, must target the exact confirmed ready-object key, and is fetched
without a session cookie. Its bytes must match the random Canary's SHA-256
digest. The trap performs the same network-first restoration and worker restart
on normal exit, assertion failure, interruption, and termination, then requests
deletion of the disposable asset. Failure to remove the private signed-URL/API
files or to prove the named preflight container absent also fails recovery.

The asset DELETE is a logical deletion request. Physical asset cleanup follows
the product's fixed grace and provider lifecycle and is deliberately not
reported as immediate. After pipeline recovery, a separate full
`media-preflight` provider canary must pass ClamAV clean/malware checks,
FFmpeg/FFprobe checks, and verified cleanup of every canary object version and
delete marker. Its output remains in a private temporary directory and is not
included in the report.

### Execute the storage drill

```bash
chmod 0600 /run/q-academy/drill-member.cookies
bash scripts/ops/staging-storage-pipeline-outage-drill.sh \
  --origin https://academy.staging.customer-domain.com \
  --confirm-origin https://academy.staging.customer-domain.com \
  --project-name q-academy-staging \
  --confirm-project-name q-academy-staging \
  --bucket q-academy-staging-media \
  --confirm-bucket q-academy-staging-media \
  --ack STAGING_STORAGE_PIPELINE_OUTAGE \
  --env-file /opt/q-academy/staging.env \
  --session-cookie-file /run/q-academy/drill-member.cookies \
  >resilience-storage-pipeline-outage.json
```

The report contains only target identity, status codes, counts, and boolean
assertions. It excludes the bucket, endpoint, tenant/user/session/asset IDs,
cookie material, signed URL, provider response, object key, and content hash.
Do not proceed when `networkRestored`, `workersRestored`, `recovered`,
`testDataDeletionRequested`, or `providerCanaryCleanupVerified` is false.

This is specifically a media-runner egress failure drill. It does not prove a
provider-wide outage, provider DNS failure, storage-capacity exhaustion, IAM
revocation, cross-region failover, provider SLA, sustained concurrency, or
immediate physical asset erasure. Those require separate controlled staging
evidence.

## Evidence boundary and remaining gates

These scripts prepare and execute staging evidence; their presence in the
repository is not evidence that a staging run happened. Archive the JSON with
the release/image manifest, alert timeline, operator, timestamp, and ticket.

The current Compose default still declares one app service behind one Caddy on
one root server and one PostgreSQL instance. Temporary `--scale app=2` tests
Docker-DNS/Caddy failover inside that host, shared-session behavior, and
single-container drain only. It does not prove multi-host placement, an
external load balancer, connection draining during in-flight writes,
PostgreSQL HA, cross-zone failover, zero-downtime rollout, or general absence of
data loss. Those remain external architecture and staging gates. Likewise, the
worker drill proves observable backlog and recovery for one legitimate sample;
it does not replace sustained backpressure, crash-at-claim-boundary,
provider-outage, or load testing. The storage drill proves one bounded runner
network failure and provider canary cleanup; it does not expand that boundary
to a provider-wide failure or completed physical cleanup of the logical test
asset.

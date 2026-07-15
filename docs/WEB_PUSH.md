# Web Push

Q-Academy sends browser push notifications through the existing notification
center. The database notification remains the source of truth; push is a
best-effort delivery channel and never replaces the in-app inbox.

## Runtime configuration

Generate one P-256 VAPID key pair for the installation and configure the app
runtime with all three values:

```env
WEB_PUSH_VAPID_PUBLIC_KEY=<unpadded-base64url-public-key>
WEB_PUSH_VAPID_PRIVATE_KEY=<unpadded-base64url-private-key>
WEB_PUSH_VAPID_SUBJECT=mailto:push@ihre-domain.de
```

The public key must encode the 65-byte uncompressed P-256 point, the private
key must encode exactly 32 bytes, and both keys must be a matching pair. The
subject must be a maintained HTTPS contact URI or `mailto:` address. Production
startup fails closed when the keys are missing, malformed, mismatched, or use a
reserved contact domain.

Keep the private VAPID key in the app secret store. It is required by the app
and job-dispatch runtime, but it must not be exposed through `NEXT_PUBLIC_*`,
the browser configuration endpoint, logs, images, or repository files. VAPID
rotation invalidates existing browser subscriptions. The control compares an
existing browser subscription with the configured public key, shows a stale
subscription as inactive, and replaces it when the user enables push again.

## Delivery lifecycle

1. An authenticated user enables push and grants browser permission.
2. `/api/push/subscriptions` validates the P-256 and auth keys, resolves the
   HTTPS endpoint against private-network SSRF targets, and stores the payload
   with AES-256-GCM authenticated encryption.
3. The endpoint SHA-256 hash is used only for uniqueness. The plaintext
   endpoint and browser keys are not stored in queryable columns.
4. The internal job dispatcher materializes one delivery per notification and
   subscription. The database unique key makes repeated materialization
   idempotent.
5. Category preferences are tenant-bound and default to enabled when no row
   exists, preserving existing behavior. A disabled category is checked both
   during materialization and again after a worker claim, before credentials
   are decrypted or a provider is contacted. In-app notifications remain the
   source of truth and cannot be disabled.
6. Workers claim rows with a lease, send with bounded concurrency, and use
   exponential backoff with jitter for temporary failures. A claim can only
   finalize the exact row revision it acquired.
7. HTTP 404 or 410 removes the stale subscription. Its delivery rows are
   removed by the subscription foreign-key cascade; the notification remains
   available in the in-app inbox.

Subscriptions are bound by composite foreign keys to user, tenant, and the
exact browser login session. Logout removes only that session's subscriptions;
expired or otherwise revoked sessions are excluded by the worker. This prevents
notifications for a previous account after a browser account switch without
disabling another device. Reusing an endpoint already bound to another user or
tenant returns HTTP 409 without transferring or deleting the existing record.

## Operations

The normal internal job dispatch includes the push queue. Monitor job failures,
the counts of `pending`, `retrying`, `processing`, and `failed` deliveries, and
the age of the oldest retry. A `processing` row is reclaimable after its lease
expires. Repeated 401 or 403 provider responses usually indicate invalid VAPID
configuration and should be investigated before retrying subscriptions.

The service worker accepts only bounded text and same-origin relative links.
Notification clicks fall back to `/academy`; arbitrary external navigation is
not allowed.

## Verification

Run the pure configuration tests with:

```powershell
npx tsx --test tests/web-push-configuration.unit.ts
```

Run the isolated PostgreSQL integration test with the React Server export
condition enabled:

```powershell
$env:NODE_OPTIONS='--conditions=react-server'
npx tsx --test tests/web-push.integration.ts
Remove-Item Env:NODE_OPTIONS
```

The integration test creates and drops a dedicated
`q_academy_web_push_<pid>_test` database. It verifies P-256 input validation,
encrypted associated-data binding, tenant isolation, database constraints,
idempotent queue materialization, claim replay protection, retry recovery, and
stale-subscription cleanup.

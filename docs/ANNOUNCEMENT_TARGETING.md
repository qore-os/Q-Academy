# Announcement targeting and insights

## Content document

Banner and modals store a versioned `contentDocument` with at most 16 typed
blocks and a bounded 30 KiB JSON representation:

- `rich_text`: sanitized structured rich text,
- `callout`: optional title, bounded body and one of four semantic tones,
- `divider`: solid, dashed or dotted separator and
- `cta`: bounded label plus an internal path or credential-free HTTP(S) URL.

Block IDs are unique. At least one non-divider block and meaningful projected
text are required. The admin editor adds, removes and reorders blocks, inserts
only the explicitly allowed member/course variables and renders the same
responsive content component used by the learner banner and modal. Legacy
`body`, `href` and `actionLabel` values are materialized into a rich-text/CTA
document; a safe legacy projection remains available for compatibility.

Announcements retain the legacy base audience (`all`, `user`, or `group`) and
add a versioned `targetRuleSet`. The base audience and every rule condition
must match. Version 1 only supports the `and` conjunction.

Supported conditions:

- `role`: owner, admin, trainer, or member
- `group`: member or not a member of a tenant group
- `bundle`: direct or group-derived bundle membership, including negation
- `course_access`: presence or absence of a tenant course access grant
- `course_progress`: enrollment progress at least, at most, or within a range

Referenced groups, bundles, and courses are validated during creation,
updates, and previews. Delivery resolves those references again. Missing,
foreign-tenant, unsupported, or malformed rules fail closed.

## Measurement

`announcement_interactions` stores the first `impression`, `click`, and
`dismiss` per announcement and user. Its composite primary key makes client
retries idempotent. Composite foreign keys bind both the announcement and user
to the recorded organization.

A click also records an impression when none exists. A member dismissal is
committed atomically with its interaction. Admin insights aggregate unique
impressions, clicks, dismissals, and click rate.

## Privacy

Interactions are included in a subject export, covered by the communications
legal-hold scope, and deleted during member erasure after the hold is cleared.
The target rule set is reviewable announcement metadata in the privacy data
inventory.

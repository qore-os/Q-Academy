# Q-Academy PostgreSQL image

The production release contains a dedicated `q-academy-postgres` component.
It starts from the exact official PostgreSQL 16.14 Alpine 3.23 image index and
replaces its `gosu` executable with a static, reproducible build of upstream
`gosu` 1.19.

All build inputs are fail-closed in `Dockerfile` (including the digest-pinned
Dockerfile frontend):

- PostgreSQL base image and Go builder are pinned by complete registry digest.
- The upstream `gosu` tag resolves to commit
  `6456aaa0f3c854d199d0f037f068eb97515b7513`.
- The source archive is pinned by SHA-256 before extraction.
- Two builds use independent Go build caches and must be byte-identical.
- CGO, VCS metadata, path metadata and the Go build ID are disabled. An ELF
  verifier rejects a dynamic interpreter.
- The final build verifies version, permissions and a real switch to the
  unprivileged `postgres` user.

CI smoke-tests and scans this exact image ID, includes it in the release tar,
publishes it under an immutable GHCR digest and places that digest in the
attested `release-images.env`. Production deployment accepts PostgreSQL from
that verified manifest; the environment `POSTGRES_IMAGE` remains a fallback
only for drills and `RELEASE_IMAGE_MODE=local-build`.

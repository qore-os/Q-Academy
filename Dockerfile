ARG NODE_IMAGE=node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
ARG CADDY_BUILDER_IMAGE=golang:1.26.5-bookworm@sha256:3f6236bd765f898a2a3c2946112b04097814c4529d44534674700cd07b9c6b4c
ARG CADDY_VERSION=2.11.4
ARG CADDY_BUILDABLE_ARTIFACT_SHA256=33777097f666d60d78bfb74df06978c933f32aa5a0d4ce0b0c5d028489984187
ARG CADDY_SOURCE_DATE_EPOCH=1780342502
ARG DEBIAN_SNAPSHOT=20260714T202849Z
ARG CA_CERTIFICATES_VERSION=20230311+deb12u1
ARG FFMPEG_VERSION=7:5.1.9-0+deb12u1
ARG MESA_VERSION=22.3.6-1+deb12u2

FROM ${NODE_IMAGE} AS base
ARG DEBIAN_SNAPSHOT
ARG CA_CERTIFICATES_VERSION
ARG FFMPEG_VERSION
ARG MESA_VERSION
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --create-home --home-dir /home/nextjs nextjs

FROM base AS runtime-base
RUN rm -rf -- \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
      /opt/yarn-v* \
    && rm -f -- \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/corepack \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg \
    && test ! -e /usr/local/lib/node_modules/npm \
    && ! command -v npm >/dev/null 2>&1 \
    && ! command -v npx >/dev/null 2>&1 \
    && ! command -v corepack >/dev/null 2>&1 \
    && ! command -v yarn >/dev/null 2>&1 \
    && ! command -v yarnpkg >/dev/null 2>&1

FROM ${CADDY_BUILDER_IMAGE} AS caddy-builder
ARG CADDY_VERSION
ARG CADDY_BUILDABLE_ARTIFACT_SHA256
ARG CADDY_SOURCE_DATE_EPOCH
ENV GOTOOLCHAIN=local
COPY scripts/ops/caddy-runtime-entrypoint.go /tmp/q-academy-caddy-entrypoint.go
RUN set -eux; \
    test "$(go env GOVERSION)" = "go1.26.5"; \
    test "$CADDY_VERSION" = "2.11.4"; \
    test "$CADDY_BUILDABLE_ARTIFACT_SHA256" = "33777097f666d60d78bfb74df06978c933f32aa5a0d4ce0b0c5d028489984187"; \
    test "$CADDY_SOURCE_DATE_EPOCH" = "1780342502"; \
    artifact=/tmp/caddy-buildable-artifact.tar.gz; \
    curl --fail --location --silent --show-error --retry 3 \
      --connect-timeout 15 \
      --max-time 300 \
      --proto '=https' \
      --proto-redir '=https' \
      --output "$artifact" \
      "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_buildable-artifact.tar.gz"; \
    printf '%s  %s\n' "$CADDY_BUILDABLE_ARTIFACT_SHA256" "$artifact" \
      | sha256sum --check --strict -; \
    install -d -m 0755 \
      /build/caddy \
      /out/rootfs/etc/caddy \
      /out/rootfs/etc/ssl/certs \
      /out/rootfs/usr/bin \
      /out/rootfs/usr/share/licenses/caddy \
      /out/rootfs/tmp; \
    install -d -o 10001 -g 10001 -m 0700 \
      /out/rootfs/data \
      /out/rootfs/config; \
    tar --extract --gzip --file "$artifact" \
      --directory /build/caddy \
      --no-same-owner \
      --no-same-permissions; \
    grep -Fx "require github.com/caddyserver/caddy/v2 v${CADDY_VERSION}" \
      /build/caddy/go.mod; \
    cd /build/caddy; \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
      -mod=vendor \
      -trimpath \
      -buildvcs=false \
      -ldflags='-s -w -buildid=' \
      -o /out/rootfs/usr/bin/caddy \
      .; \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
      -mod=vendor \
      -trimpath \
      -buildvcs=false \
      -ldflags='-s -w -buildid=' \
      -o /tmp/caddy-reproducibility-check \
      .; \
    cmp /out/rootfs/usr/bin/caddy /tmp/caddy-reproducibility-check; \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
      -trimpath \
      -buildvcs=false \
      -ldflags='-s -w -buildid=' \
      -o /out/rootfs/usr/bin/q-academy-caddy-entrypoint \
      /tmp/q-academy-caddy-entrypoint.go; \
    /out/rootfs/usr/bin/caddy version | grep -E "^v${CADDY_VERSION}([[:space:]]|$)"; \
    go version -m /out/rootfs/usr/bin/caddy \
      | grep -E "^[[:space:]]*dep[[:space:]]+github.com/caddyserver/caddy/v2[[:space:]]+v${CADDY_VERSION}([[:space:]]|$)"; \
    if readelf -l /out/rootfs/usr/bin/caddy | grep -q 'INTERP'; then \
      printf 'Caddy must be statically linked.\n' >&2; \
      exit 1; \
    fi; \
    if readelf -l /out/rootfs/usr/bin/q-academy-caddy-entrypoint | grep -q 'INTERP'; then \
      printf 'The Caddy runtime preflight must be statically linked.\n' >&2; \
      exit 1; \
    fi; \
    install -m 0444 /etc/ssl/certs/ca-certificates.crt \
      /out/rootfs/etc/ssl/certs/ca-certificates.crt; \
    install -m 0444 /build/caddy/LICENSE \
      /out/rootfs/usr/share/licenses/caddy/LICENSE; \
    printf 'caddy:x:10001:10001:Caddy runtime:/config:/sbin/nologin\n' \
      > /out/rootfs/etc/passwd; \
    printf 'caddy:x:10001:\n' > /out/rootfs/etc/group; \
    chmod 0444 /out/rootfs/etc/passwd /out/rootfs/etc/group; \
    chmod 0555 \
      /out/rootfs/usr/bin/caddy \
      /out/rootfs/usr/bin/q-academy-caddy-entrypoint; \
    chmod 1777 /out/rootfs/tmp; \
    for directory in data config; do \
      printf 'q-academy-caddy-volume-v1\n' \
        > "/out/rootfs/$directory/.q-academy-caddy-volume-v1"; \
      chown 10001:10001 "/out/rootfs/$directory/.q-academy-caddy-volume-v1"; \
      chmod 0444 "/out/rootfs/$directory/.q-academy-caddy-volume-v1"; \
    done; \
    find /out/rootfs -exec \
      touch --no-dereference --date="@${CADDY_SOURCE_DATE_EPOCH}" {} +; \
    rm -f \
      "$artifact" \
      /tmp/caddy-reproducibility-check \
      /tmp/q-academy-caddy-entrypoint.go

FROM scratch AS caddy
LABEL org.opencontainers.image.title="Q-Academy Caddy" \
      org.opencontainers.image.version="2.11.4" \
      org.opencontainers.image.source="https://github.com/qore-os/Q-Academy" \
      org.opencontainers.image.licenses="Apache-2.0"
COPY --from=caddy-builder /out/rootfs/ /
ENV HOME=/config \
    PATH=/usr/bin \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    XDG_CONFIG_HOME=/config \
    XDG_DATA_HOME=/data
USER 10001:10001
VOLUME ["/data", "/config"]
EXPOSE 8080 8443 8443/udp
ENTRYPOINT ["/usr/bin/q-academy-caddy-entrypoint"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]

FROM runtime-base AS dispatcher
ENV NODE_ENV=production
COPY --chown=nextjs:nodejs scripts/ops/dispatcher-http-post.mjs /opt/q-academy/dispatcher-http-post.mjs
USER 1001:1001

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS release-verifier
COPY --chown=nextjs:nodejs scripts/secret-scan.ts ./scripts/
USER nextjs
ENTRYPOINT ["/app/node_modules/.bin/tsx", "/app/scripts/secret-scan.ts"]

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_ENABLE_PWA=true
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_ENABLE_PWA=${NEXT_PUBLIC_ENABLE_PWA}
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN test -n "$NEXT_PUBLIC_APP_URL" \
    && npm run build

FROM base AS production-dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

FROM runtime-base AS migrator
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs package.json ./package.json
COPY --chown=nextjs:nodejs scripts/migrate.ts scripts/load-environment.ts ./scripts/
COPY --chown=nextjs:nodejs src/lib/branding-host-policy.ts src/lib/database-encoding.ts src/lib/encryption-keyring.ts src/lib/migration-history-validation.ts src/lib/server-environment-validation.ts src/lib/operational-cleanup-policy.ts ./src/lib/
COPY --chown=nextjs:nodejs src/lib/media/storage-configuration.ts ./src/lib/media/
COPY --chown=nextjs:nodejs src/lib/push/configuration.ts ./src/lib/push/
COPY --chown=nextjs:nodejs drizzle ./drizzle
USER nextjs
ENTRYPOINT ["./node_modules/.bin/tsx", "scripts/migrate.ts"]

FROM runtime-base AS key-rotation
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs package.json ./package.json
COPY --chown=nextjs:nodejs scripts/rotate-encryption-keys.ts ./scripts/
COPY --chown=nextjs:nodejs src/lib/encryption-keyring.ts ./src/lib/
USER nextjs
ENTRYPOINT ["./node_modules/.bin/tsx", "scripts/rotate-encryption-keys.ts"]

FROM runtime-base AS tenant-ops
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs package.json tsconfig.json ./
COPY --chown=nextjs:nodejs scripts/provision-tenant.ts scripts/set-tenant-status.ts scripts/set-tenant-contract.ts scripts/erase-tenant.ts scripts/verify-tenant-erasure-archive.ts scripts/export-audit-events.ts scripts/verify-audit-export.ts scripts/export-user-data.ts scripts/http-slo-smoke.ts scripts/load-environment.ts ./scripts/
COPY --chown=nextjs:nodejs src/db ./src/db
COPY --chown=nextjs:nodejs src/lib ./src/lib
COPY --chown=nextjs:nodejs scripts/ops/tenant-ops-entrypoint.sh /usr/local/bin/q-academy-tenant-ops
RUN chmod 0555 /usr/local/bin/q-academy-tenant-ops
USER nextjs
ENTRYPOINT ["/usr/local/bin/q-academy-tenant-ops"]
CMD ["help"]

FROM runtime-base AS s3-preflight
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs scripts/load-environment.ts scripts/s3-provider-preflight.ts scripts/strato-privacy-export-sweeper.ts ./scripts/
COPY --chown=nextjs:nodejs src/lib/media/s3-object-integrity.ts src/lib/media/s3-operation-timeout.ts src/lib/media/s3-presigned-post.ts src/lib/media/s3-privacy-export-lifecycle.ts src/lib/media/s3-provider-contract.ts src/lib/media/s3-provider-contract-aws.ts src/lib/media/s3-strato-compatibility-preflight.ts src/lib/media/storage-configuration.ts ./src/lib/media/
COPY --chown=nextjs:nodejs src/lib/privacy/strato-retention-sweeper.ts ./src/lib/privacy/
USER nextjs
ENTRYPOINT ["./node_modules/.bin/tsx", "scripts/s3-provider-preflight.ts"]

FROM runtime-base AS s3-app-principal-preflight
ENV NODE_ENV=production
RUN install -d -o nextjs -g nodejs -m 0700 /var/lib/q-academy-strato-sweeper
COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs scripts/load-environment.ts scripts/s3-app-principal-preflight.ts scripts/strato-privacy-export-sweeper.ts ./scripts/
COPY --chown=nextjs:nodejs src/lib/media/s3-object-integrity.ts src/lib/media/s3-operation-timeout.ts src/lib/media/s3-presigned-post.ts src/lib/media/s3-privacy-export-lifecycle.ts src/lib/media/s3-app-principal-contract.ts src/lib/media/s3-app-principal-contract-aws.ts src/lib/media/s3-strato-compatibility-preflight.ts src/lib/media/storage-configuration.ts ./src/lib/media/
COPY --chown=nextjs:nodejs src/lib/privacy/strato-retention-sweeper.ts ./src/lib/privacy/
USER nextjs
ENTRYPOINT ["./node_modules/.bin/tsx", "scripts/s3-app-principal-preflight.ts"]

FROM runtime-base AS media-preflight
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
# The slim base has no system CA bundle. Debian's signed InRelease metadata and
# package hashes authenticate the exact HTTP bootstrap; HTTPS is enabled as
# soon as the pinned CA package is installed.
RUN test -r /usr/share/keyrings/debian-archive-keyring.gpg \
    && sed -Ei \
      -e "s|https?://deb.debian.org/debian-security|http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}/|g" \
      -e "s|https?://deb.debian.org/debian|http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}/|g" \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get --error-on=any -o Acquire::Check-Valid-Until=false update \
    && apt-get install --yes --no-install-recommends "ca-certificates=${CA_CERTIFICATES_VERSION}" \
    && test -s /etc/ssl/certs/ca-certificates.crt \
    && sed -Ei \
      -e "s|http://snapshot.debian.org|https://snapshot.debian.org|g" \
      /etc/apt/sources.list.d/debian.sources \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get --error-on=any -o Acquire::Check-Valid-Until=false update \
    && apt-get install --yes --no-install-recommends \
      "ffmpeg=${FFMPEG_VERSION}" \
      "libgbm1=${MESA_VERSION}" \
      "libgl1-mesa-dri=${MESA_VERSION}" \
      "libglapi-mesa=${MESA_VERSION}" \
      "libglx-mesa0=${MESA_VERSION}" \
    && for package in libgbm1 libgl1-mesa-dri libglapi-mesa libglx-mesa0; do \
      actual="$(dpkg-query -W -f='${Version}' "$package")"; \
      test "$actual" = "$MESA_VERSION" || exit 1; \
    done \
    && rm -rf /var/lib/apt/lists/*
COPY --chown=nextjs:nodejs tsconfig.json ./tsconfig.json
COPY --chown=nextjs:nodejs scripts/load-environment.ts scripts/clamav-preflight.ts scripts/media-processing-preflight.ts scripts/webm-duration-preflight.ts scripts/openai-whisper-transcribe-core.ts scripts/openai-whisper-transcribe.ts ./scripts/
COPY --chown=nextjs:nodejs src/lib ./src/lib
USER nextjs
ENTRYPOINT ["node", "--conditions=react-server", "--import", "tsx", "scripts/media-processing-preflight.ts"]

FROM runtime-base AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/content-security-policy.ts ./src/lib/content-security-policy.ts
RUN mkdir -p /app/.next/cache \
    && chown -R nextjs:nodejs /app/.next
USER nextjs
EXPOSE 3000
CMD ["./node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]

FROM runner AS media-runner
USER root
RUN test -r /usr/share/keyrings/debian-archive-keyring.gpg \
    && sed -Ei \
      -e "s|https?://deb.debian.org/debian-security|http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}/|g" \
      -e "s|https?://deb.debian.org/debian|http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}/|g" \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get --error-on=any -o Acquire::Check-Valid-Until=false update \
    && apt-get install --yes --no-install-recommends "ca-certificates=${CA_CERTIFICATES_VERSION}" \
    && test -s /etc/ssl/certs/ca-certificates.crt \
    && sed -Ei \
      -e "s|http://snapshot.debian.org|https://snapshot.debian.org|g" \
      /etc/apt/sources.list.d/debian.sources \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get --error-on=any -o Acquire::Check-Valid-Until=false update \
    && apt-get install --yes --no-install-recommends \
      "ffmpeg=${FFMPEG_VERSION}" \
      "libgbm1=${MESA_VERSION}" \
      "libgl1-mesa-dri=${MESA_VERSION}" \
      "libglapi-mesa=${MESA_VERSION}" \
      "libglx-mesa0=${MESA_VERSION}" \
    && for package in libgbm1 libgl1-mesa-dri libglapi-mesa libglx-mesa0; do \
      actual="$(dpkg-query -W -f='${Version}' "$package")"; \
      test "$actual" = "$MESA_VERSION" || exit 1; \
    done \
    && rm -rf /var/lib/apt/lists/*
COPY --chown=nextjs:nodejs scripts/openai-whisper-transcribe-core.ts scripts/openai-whisper-transcribe.ts ./scripts/
COPY --chown=nextjs:nodejs scripts/ops/media-runner-entrypoint.sh /usr/local/bin/q-academy-media-runner
RUN chmod 0755 /usr/local/bin/q-academy-media-runner
USER nextjs
ENTRYPOINT ["/usr/local/bin/q-academy-media-runner"]
CMD ["./node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]

ARG NODE_IMAGE=node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
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
COPY --chown=nextjs:nodejs scripts/load-environment.ts scripts/clamav-preflight.ts scripts/media-processing-preflight.ts ./scripts/
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
COPY --chown=nextjs:nodejs scripts/ops/media-runner-entrypoint.sh /usr/local/bin/q-academy-media-runner
RUN chmod 0755 /usr/local/bin/q-academy-media-runner
USER nextjs
ENTRYPOINT ["/usr/local/bin/q-academy-media-runner"]
CMD ["./node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]

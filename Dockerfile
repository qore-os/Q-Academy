ARG NODE_IMAGE=node:22-bookworm-slim@sha256:53ada149d435c38b14476cb57e4a7da73c15595aba79bd6971b547ceb6d018bf
ARG DEBIAN_SNAPSHOT=20260701T000000Z
ARG CA_CERTIFICATES_VERSION=20230311+deb12u1
ARG FFMPEG_VERSION=7:5.1.9-0+deb12u1

FROM ${NODE_IMAGE} AS base
ARG DEBIAN_SNAPSHOT
ARG CA_CERTIFICATES_VERSION
ARG FFMPEG_VERSION
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --create-home --home-dir /home/nextjs nextjs

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

FROM base AS migrator
ENV NODE_ENV=production
COPY --from=dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs package.json ./package.json
COPY --chown=nextjs:nodejs scripts/migrate.ts scripts/load-environment.ts ./scripts/
COPY --chown=nextjs:nodejs src/lib/branding-host-policy.ts src/lib/database-encoding.ts src/lib/encryption-keyring.ts src/lib/migration-history-validation.ts src/lib/server-environment-validation.ts src/lib/operational-cleanup-policy.ts ./src/lib/
COPY --chown=nextjs:nodejs src/lib/media/storage-configuration.ts ./src/lib/media/
COPY --chown=nextjs:nodejs src/lib/push/configuration.ts ./src/lib/push/
COPY --chown=nextjs:nodejs drizzle ./drizzle
USER nextjs
ENTRYPOINT ["./node_modules/.bin/tsx", "scripts/migrate.ts"]

FROM base AS key-rotation
ENV NODE_ENV=production
COPY --from=dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs package.json ./package.json
COPY --chown=nextjs:nodejs scripts/rotate-encryption-keys.ts ./scripts/
COPY --chown=nextjs:nodejs src/lib/encryption-keyring.ts ./src/lib/
USER nextjs
ENTRYPOINT ["./node_modules/.bin/tsx", "scripts/rotate-encryption-keys.ts"]

FROM dependencies AS tenant-ops
ENV NODE_ENV=production
COPY --chown=nextjs:nodejs package.json tsconfig.json ./
COPY --chown=nextjs:nodejs scripts/provision-tenant.ts scripts/set-tenant-status.ts scripts/set-tenant-contract.ts scripts/erase-tenant.ts scripts/verify-tenant-erasure-archive.ts scripts/export-audit-events.ts scripts/verify-audit-export.ts scripts/export-user-data.ts scripts/http-slo-smoke.ts scripts/load-environment.ts ./scripts/
COPY --chown=nextjs:nodejs src/db ./src/db
COPY --chown=nextjs:nodejs src/lib ./src/lib
COPY --chown=nextjs:nodejs scripts/ops/tenant-ops-entrypoint.sh /usr/local/bin/q-academy-tenant-ops
RUN chmod 0555 /usr/local/bin/q-academy-tenant-ops
USER nextjs
ENTRYPOINT ["/usr/local/bin/q-academy-tenant-ops"]
CMD ["help"]

FROM dependencies AS s3-preflight
ENV NODE_ENV=production
COPY --chown=nextjs:nodejs scripts/load-environment.ts scripts/s3-provider-preflight.ts ./scripts/
COPY --chown=nextjs:nodejs src/lib/media/s3-object-integrity.ts src/lib/media/s3-operation-timeout.ts src/lib/media/s3-privacy-export-lifecycle.ts src/lib/media/s3-provider-contract.ts src/lib/media/s3-provider-contract-aws.ts src/lib/media/storage-configuration.ts ./src/lib/media/
USER nextjs
ENTRYPOINT ["./node_modules/.bin/tsx", "scripts/s3-provider-preflight.ts"]

FROM dependencies AS s3-app-principal-preflight
ENV NODE_ENV=production
COPY --chown=nextjs:nodejs scripts/s3-app-principal-preflight.ts ./scripts/
COPY --chown=nextjs:nodejs src/lib/media/s3-object-integrity.ts src/lib/media/s3-operation-timeout.ts src/lib/media/s3-privacy-export-lifecycle.ts src/lib/media/s3-app-principal-contract.ts src/lib/media/s3-app-principal-contract-aws.ts src/lib/media/storage-configuration.ts ./src/lib/media/
USER nextjs
ENTRYPOINT ["./node_modules/.bin/tsx", "scripts/s3-app-principal-preflight.ts"]

FROM dependencies AS media-preflight
ENV NODE_ENV=production
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
    && apt-get install --yes --no-install-recommends "ffmpeg=${FFMPEG_VERSION}" \
    && rm -rf /var/lib/apt/lists/*
COPY --chown=nextjs:nodejs tsconfig.json ./tsconfig.json
COPY --chown=nextjs:nodejs scripts/load-environment.ts scripts/clamav-preflight.ts scripts/media-processing-preflight.ts ./scripts/
COPY --chown=nextjs:nodejs src/lib ./src/lib
USER nextjs
ENTRYPOINT ["node", "--conditions=react-server", "--import", "tsx", "scripts/media-processing-preflight.ts"]

FROM base AS runner
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
    && apt-get install --yes --no-install-recommends "ffmpeg=${FFMPEG_VERSION}" \
    && rm -rf /var/lib/apt/lists/*
COPY --chown=nextjs:nodejs scripts/ops/media-runner-entrypoint.sh /usr/local/bin/q-academy-media-runner
RUN chmod 0755 /usr/local/bin/q-academy-media-runner
USER nextjs
ENTRYPOINT ["/usr/local/bin/q-academy-media-runner"]
CMD ["./node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]

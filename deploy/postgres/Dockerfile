# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG POSTGRES_BASE_IMAGE=postgres:16.14-alpine3.23@sha256:42b8b8b29c8a4e933d88943e5b03001a78794905cf786e6e7634e9f2abd5a0d3
ARG GOLANG_BUILDER_IMAGE=golang:1.26.6-alpine3.23@sha256:5978cc992ad5ef96a7469713c8af849c1433824761ce3be2c56381403cd8d9a3

FROM ${GOLANG_BUILDER_IMAGE} AS gosu-builder
ARG GOLANG_BUILDER_IMAGE
ARG GOSU_VERSION=1.19
ARG GOSU_SOURCE_COMMIT=6456aaa0f3c854d199d0f037f068eb97515b7513
ARG GOSU_SOURCE_SHA256=33d7537d588ea49458b9509bcf4554bdf5ceacc66da71e5caa1058ea3b689c3b

RUN test "$GOLANG_BUILDER_IMAGE" = "golang:1.26.6-alpine3.23@sha256:5978cc992ad5ef96a7469713c8af849c1433824761ce3be2c56381403cd8d9a3" \
    && test "$(go env GOVERSION)" = "go1.26.6" \
    && test "$GOSU_VERSION" = "1.19" \
    && test "$GOSU_SOURCE_COMMIT" = "6456aaa0f3c854d199d0f037f068eb97515b7513" \
    && test "$GOSU_SOURCE_SHA256" = "33d7537d588ea49458b9509bcf4554bdf5ceacc66da71e5caa1058ea3b689c3b"

ADD --checksum=sha256:33d7537d588ea49458b9509bcf4554bdf5ceacc66da71e5caa1058ea3b689c3b \
    https://codeload.github.com/tianon/gosu/tar.gz/6456aaa0f3c854d199d0f037f068eb97515b7513 \
    /tmp/gosu-source.tar.gz

WORKDIR /build/gosu
RUN set -eux; \
    test "$(sha256sum /tmp/gosu-source.tar.gz | awk '{ print $1 }')" = "$GOSU_SOURCE_SHA256"; \
    tar \
      --extract \
      --gzip \
      --file /tmp/gosu-source.tar.gz \
      --strip-components=1 \
      --no-same-owner; \
    grep -Fx 'const Version = "1.19"' version.go; \
    go mod download; \
    go mod verify; \
    mkdir -p /out; \
    CGO_ENABLED=0 GOCACHE=/tmp/gosu-cache-one \
      go build \
        -mod=readonly \
        -trimpath \
        -buildvcs=false \
        -ldflags='-buildid= -s -w' \
        -o /out/gosu-one .; \
    CGO_ENABLED=0 GOCACHE=/tmp/gosu-cache-two \
      go build \
        -mod=readonly \
        -trimpath \
        -buildvcs=false \
        -ldflags='-buildid= -s -w' \
        -o /out/gosu-two .; \
    cmp /out/gosu-one /out/gosu-two; \
    install -m 0555 /out/gosu-one /out/gosu; \
    install -m 0444 LICENSE /out/LICENSE; \
    test "$(/out/gosu --version | awk '{ print $1 }')" = "$GOSU_VERSION"; \
    go version -m /out/gosu \
      | grep -E 'github[.]com/moby/sys/user[[:space:]]+v0[.]1[.]0'; \
    go version -m /out/gosu \
      | grep -E 'golang[.]org/x/sys[[:space:]]+v0[.]1[.]0'

RUN <<'EOF'
set -eux
cat >/tmp/verify-static.go <<'GO'
package main

import (
	"debug/elf"
	"fmt"
	"os"
)

func main() {
	if len(os.Args) != 2 {
		panic("expected one ELF path")
	}
	binary, err := elf.Open(os.Args[1])
	if err != nil {
		panic(err)
	}
	defer binary.Close()
	for _, program := range binary.Progs {
		if program.Type == elf.PT_INTERP {
			panic(fmt.Sprintf("%s contains a dynamic interpreter", os.Args[1]))
		}
	}
}
GO
go run /tmp/verify-static.go /out/gosu
EOF

FROM ${POSTGRES_BASE_IMAGE}
ARG POSTGRES_BASE_IMAGE
ARG GOLANG_BUILDER_IMAGE
ARG GOSU_VERSION=1.19
ARG GOSU_SOURCE_COMMIT=6456aaa0f3c854d199d0f037f068eb97515b7513
ARG GOSU_SOURCE_SHA256=33d7537d588ea49458b9509bcf4554bdf5ceacc66da71e5caa1058ea3b689c3b

LABEL org.opencontainers.image.title="Q-Academy PostgreSQL" \
      org.opencontainers.image.description="PostgreSQL with a reproducibly built static gosu" \
      org.opencontainers.image.source="https://github.com/qore-os/Q-Academy" \
      org.opencontainers.image.version="16.14" \
      org.opencontainers.image.licenses="PostgreSQL AND Apache-2.0" \
      org.opencontainers.image.base.name="${POSTGRES_BASE_IMAGE}" \
      io.qore-os.q-academy.golang-builder="${GOLANG_BUILDER_IMAGE}" \
      io.qore-os.q-academy.gosu.version="${GOSU_VERSION}" \
      io.qore-os.q-academy.gosu.source="https://github.com/tianon/gosu" \
      io.qore-os.q-academy.gosu.revision="${GOSU_SOURCE_COMMIT}" \
      io.qore-os.q-academy.gosu.source-sha256="${GOSU_SOURCE_SHA256}"

COPY --from=gosu-builder --chmod=0555 /out/gosu /usr/local/bin/gosu
COPY --from=gosu-builder --chmod=0444 /out/LICENSE /usr/share/licenses/gosu/LICENSE

RUN set -eux; \
    test "$POSTGRES_BASE_IMAGE" = "postgres:16.14-alpine3.23@sha256:42b8b8b29c8a4e933d88943e5b03001a78794905cf786e6e7634e9f2abd5a0d3"; \
    test "$(gosu --version | awk '{ print $1 }')" = "$GOSU_VERSION"; \
    test "$(gosu postgres id -u)" = "$(id -u postgres)"; \
    test "$(gosu postgres id -g)" = "$(id -g postgres)"; \
    test "$(stat -c '%a' /usr/local/bin/gosu)" = 555; \
    test "$(stat -c '%a' /usr/share/licenses/gosu/LICENSE)" = 444; \
    test ! -u /usr/local/bin/gosu; \
    test ! -g /usr/local/bin/gosu

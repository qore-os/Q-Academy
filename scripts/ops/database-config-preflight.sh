#!/bin/sh
set -eu

validate_identifier() {
  label="$1"
  value="$2"
  case "$value" in
    ""|[!a-z]*|*[!a-z0-9_]*)
      printf '%s must match ^[a-z][a-z0-9_]{0,62}$.\n' "$label" >&2
      exit 1
      ;;
  esac
  if [ "${#value}" -gt 63 ]; then
    printf '%s must match ^[a-z][a-z0-9_]{0,62}$.\n' "$label" >&2
    exit 1
  fi
}

validate_password() {
  label="$1"
  value="$2"
  case "$value" in
    *[!a-fA-F0-9]*)
      printf '%s must contain exactly 64 hexadecimal characters.\n' "$label" >&2
      exit 1
      ;;
  esac
  if [ "${#value}" -ne 64 ]; then
    printf '%s must contain exactly 64 hexadecimal characters.\n' "$label" >&2
    exit 1
  fi
}

validate_identifier POSTGRES_DB "${POSTGRES_DB:-}"
validate_identifier POSTGRES_BOOTSTRAP_USER "${POSTGRES_BOOTSTRAP_USER:-}"
validate_identifier OWNER_POSTGRES_USER "${OWNER_POSTGRES_USER:-}"
validate_identifier APP_POSTGRES_USER "${APP_POSTGRES_USER:-}"
validate_identifier MEDIA_POSTGRES_USER "${MEDIA_POSTGRES_USER:-}"

validate_password POSTGRES_BOOTSTRAP_PASSWORD "${POSTGRES_BOOTSTRAP_PASSWORD:-}"
validate_password OWNER_POSTGRES_PASSWORD "${OWNER_POSTGRES_PASSWORD:-}"
validate_password APP_POSTGRES_PASSWORD "${APP_POSTGRES_PASSWORD:-}"
validate_password MEDIA_POSTGRES_PASSWORD "${MEDIA_POSTGRES_PASSWORD:-}"

if [ "$POSTGRES_BOOTSTRAP_USER" = "$OWNER_POSTGRES_USER" ] ||
   [ "$POSTGRES_BOOTSTRAP_USER" = "$APP_POSTGRES_USER" ] ||
   [ "$POSTGRES_BOOTSTRAP_USER" = "$MEDIA_POSTGRES_USER" ] ||
   [ "$OWNER_POSTGRES_USER" = "$APP_POSTGRES_USER" ] ||
   [ "$OWNER_POSTGRES_USER" = "$MEDIA_POSTGRES_USER" ] ||
   [ "$APP_POSTGRES_USER" = "$MEDIA_POSTGRES_USER" ]; then
  printf 'All PostgreSQL role names must be distinct.\n' >&2
  exit 1
fi

if [ "$POSTGRES_BOOTSTRAP_PASSWORD" = "$OWNER_POSTGRES_PASSWORD" ] ||
   [ "$POSTGRES_BOOTSTRAP_PASSWORD" = "$APP_POSTGRES_PASSWORD" ] ||
   [ "$POSTGRES_BOOTSTRAP_PASSWORD" = "$MEDIA_POSTGRES_PASSWORD" ] ||
   [ "$OWNER_POSTGRES_PASSWORD" = "$APP_POSTGRES_PASSWORD" ] ||
   [ "$OWNER_POSTGRES_PASSWORD" = "$MEDIA_POSTGRES_PASSWORD" ] ||
   [ "$APP_POSTGRES_PASSWORD" = "$MEDIA_POSTGRES_PASSWORD" ]; then
  printf 'All PostgreSQL passwords must be distinct.\n' >&2
  exit 1
fi

printf 'PostgreSQL production configuration is valid.\n'

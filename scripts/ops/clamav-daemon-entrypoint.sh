#!/bin/sh
set -eu

max_upload_bytes="${MEDIA_MAX_UPLOAD_BYTES:-2000000000}"
case "$max_upload_bytes" in
  ""|*[!0-9]*)
    printf 'ClamAV stream limit is invalid.\n' >&2
    exit 1
    ;;
esac
if [ "$max_upload_bytes" -lt 1 ] || [ "$max_upload_bytes" -gt 2000000000 ]; then
  printf 'ClamAV stream limit is outside the supported range.\n' >&2
  exit 1
fi

source_config=/etc/clamav/clamd.conf
runtime_config=/tmp/q-academy-clamd.conf
/bin/sh /opt/q-academy/clamav-render-config.sh \
  "$source_config" "$runtime_config" "$max_upload_bytes"

exec clamd --foreground --config-file="$runtime_config"

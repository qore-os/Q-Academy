#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  printf 'ClamAV config renderer requires source, target, and stream limit.\n' >&2
  exit 1
fi
source_config="$1"
runtime_config="$2"
stream_limit="$3"

if [ ! -f "$source_config" ] || [ -L "$source_config" ]; then
  printf 'ClamAV source configuration is unavailable or unsafe.\n' >&2
  exit 1
fi
case "$stream_limit" in
  ""|*[!0-9]*)
    printf 'ClamAV stream limit is invalid.\n' >&2
    exit 1
    ;;
esac
if [ "$stream_limit" -lt 1 ] || [ "$stream_limit" -gt 2000000000 ]; then
  printf 'ClamAV stream limit is outside the supported range.\n' >&2
  exit 1
fi

umask 077
awk \
  -v stream_limit="$stream_limit" \
  '
  BEGIN {
    replacement["StreamMaxLength"] = stream_limit
    replacement["MaxFileSize"] = stream_limit
    replacement["MaxScanSize"] = stream_limit
    replacement["MaxScanTime"] = "600000"
    replacement["ReadTimeout"] = "600"
    replacement["AlertExceedsMax"] = "yes"
    order[1] = "StreamMaxLength"
    order[2] = "MaxFileSize"
    order[3] = "MaxScanSize"
    order[4] = "MaxScanTime"
    order[5] = "ReadTimeout"
    order[6] = "AlertExceedsMax"
  }
  {
    key = $1
    sub(/^#/, "", key)
    if (key in replacement) {
      if (!seen[key]) print key " " replacement[key]
      seen[key] = 1
      next
    }
    print
  }
  END {
    for (position = 1; position <= 6; position += 1) {
      key = order[position]
      if (!seen[key]) print key " " replacement[key]
    }
  }
  ' "$source_config" > "$runtime_config"
chmod 600 "$runtime_config"

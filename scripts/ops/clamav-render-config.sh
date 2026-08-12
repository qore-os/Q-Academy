#!/bin/sh
set -eu

if [ "$#" -ne 4 ]; then
  printf 'ClamAV config renderer requires source, target, stream limit, and scan concurrency.\n' >&2
  exit 1
fi
source_config="$1"
runtime_config="$2"
stream_limit="$3"
scan_concurrency="$4"

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
case "$scan_concurrency" in
  ""|*[!0-9]*)
    printf 'ClamAV scan concurrency is invalid.\n' >&2
    exit 1
    ;;
esac
if [ "$scan_concurrency" -lt 1 ] || [ "$scan_concurrency" -gt 4 ]; then
  printf 'ClamAV scan concurrency is outside the supported range.\n' >&2
  exit 1
fi
max_queue="$((scan_concurrency * 2))"

umask 077
awk \
  -v stream_limit="$stream_limit" \
  -v scan_concurrency="$scan_concurrency" \
  -v max_queue="$max_queue" \
  '
  BEGIN {
    replacement["StreamMaxLength"] = stream_limit
    replacement["MaxFileSize"] = stream_limit
    replacement["MaxScanSize"] = stream_limit
    replacement["MaxScanTime"] = "600000"
    replacement["ReadTimeout"] = "600"
    replacement["MaxThreads"] = scan_concurrency
    replacement["MaxQueue"] = max_queue
    replacement["ConcurrentDatabaseReload"] = "no"
    replacement["TemporaryDirectory"] = "/tmp"
    replacement["AlertExceedsMax"] = "yes"
    order[1] = "StreamMaxLength"
    order[2] = "MaxFileSize"
    order[3] = "MaxScanSize"
    order[4] = "MaxScanTime"
    order[5] = "ReadTimeout"
    order[6] = "MaxThreads"
    order[7] = "MaxQueue"
    order[8] = "ConcurrentDatabaseReload"
    order[9] = "TemporaryDirectory"
    order[10] = "AlertExceedsMax"
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
    for (position = 1; position <= 10; position += 1) {
      key = order[position]
      if (!seen[key]) print key " " replacement[key]
    }
  }
  ' "$source_config" > "$runtime_config"
chmod 600 "$runtime_config"

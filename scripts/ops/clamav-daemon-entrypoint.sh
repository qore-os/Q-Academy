#!/bin/sh
set -eu

max_upload_bytes="${MEDIA_MAX_UPLOAD_BYTES:-2000000000}"
scan_concurrency="${CLAMAV_SCAN_CONCURRENCY:-2}"
tmpfs_headroom_bytes="${CLAMAV_TMPFS_HEADROOM_BYTES:-1073741824}"
engine_memory_reserve_bytes="${CLAMAV_ENGINE_MEMORY_RESERVE_BYTES:-4294967296}"
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
tmpfs_type="$(stat -f -c %T /tmp)" || {
  printf 'ClamAV temporary filesystem type is unavailable.\n' >&2
  exit 1
}
tmpfs_capacity_kib="$(df -Pk /tmp | awk 'NR == 2 { print $2 }')" || {
  printf 'ClamAV temporary filesystem capacity is unavailable.\n' >&2
  exit 1
}
tmpfs_available_kib="$(df -Pk /tmp | awk 'NR == 2 { print $4 }')" || {
  printf 'ClamAV temporary filesystem availability is unavailable.\n' >&2
  exit 1
}
if [ -r /sys/fs/cgroup/memory.max ]; then
  cgroup_memory_limit_bytes="$(cat /sys/fs/cgroup/memory.max)" || {
    printf 'ClamAV cgroup v2 memory limit is unreadable.\n' >&2
    exit 1
  }
elif [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
  cgroup_memory_limit_bytes="$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)" || {
    printf 'ClamAV cgroup v1 memory limit is unreadable.\n' >&2
    exit 1
  }
elif [ -r /sys/fs/cgroup/memory.limit_in_bytes ]; then
  cgroup_memory_limit_bytes="$(cat /sys/fs/cgroup/memory.limit_in_bytes)" || {
    printf 'ClamAV cgroup v1 memory limit is unreadable.\n' >&2
    exit 1
  }
else
  printf 'ClamAV cgroup memory limit is unavailable.\n' >&2
  exit 1
fi
/bin/sh /opt/q-academy/clamav-resource-contract.sh \
  "$max_upload_bytes" "$scan_concurrency" "$tmpfs_headroom_bytes" \
  "$engine_memory_reserve_bytes" "$tmpfs_type" "$tmpfs_capacity_kib" \
  "$tmpfs_available_kib" "$cgroup_memory_limit_bytes"
/bin/sh /opt/q-academy/clamav-render-config.sh \
  "$source_config" "$runtime_config" "$max_upload_bytes" "$scan_concurrency"

exec clamd --foreground --config-file="$runtime_config"

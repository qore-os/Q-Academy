#!/bin/sh
set -eu

if [ "$#" -ne 8 ]; then
  printf 'ClamAV resource contract requires upload limit, concurrency, tmpfs headroom, engine reserve, filesystem type, capacity, availability, and cgroup memory limit.\n' >&2
  exit 1
fi

max_upload_bytes="$1"
scan_concurrency="$2"
headroom_bytes="$3"
engine_memory_reserve_bytes="$4"
tmpfs_type="$5"
tmpfs_capacity_kib="$6"
tmpfs_available_kib="$7"
cgroup_memory_limit_bytes="$8"

if [ "$cgroup_memory_limit_bytes" = "max" ]; then
  printf 'ClamAV cgroup memory limit is absent or effectively unbounded.\n' >&2
  exit 1
fi

for value in \
  "$max_upload_bytes" \
  "$scan_concurrency" \
  "$headroom_bytes" \
  "$engine_memory_reserve_bytes" \
  "$tmpfs_capacity_kib" \
  "$tmpfs_available_kib" \
  "$cgroup_memory_limit_bytes"
do
  case "$value" in
    ""|*[!0-9]*)
      printf 'ClamAV resource contract contains a non-numeric value.\n' >&2
      exit 1
      ;;
  esac
done

if [ "$max_upload_bytes" -lt 1 ] || [ "$max_upload_bytes" -gt 2000000000 ]; then
  printf 'ClamAV resource contract upload limit is outside the supported range.\n' >&2
  exit 1
fi
if [ "$scan_concurrency" -lt 1 ] || [ "$scan_concurrency" -gt 4 ]; then
  printf 'ClamAV resource contract concurrency is outside the supported range.\n' >&2
  exit 1
fi
if [ "$headroom_bytes" -lt 268435456 ] || [ "$headroom_bytes" -gt 4294967296 ]; then
  printf 'ClamAV resource contract headroom is outside the supported range.\n' >&2
  exit 1
fi
if [ "$engine_memory_reserve_bytes" -lt 2147483648 ] || [ "$engine_memory_reserve_bytes" -gt 17179869184 ]; then
  printf 'ClamAV resource contract engine memory reserve is outside the supported range.\n' >&2
  exit 1
fi
if [ "$tmpfs_type" != "tmpfs" ]; then
  printf 'ClamAV /tmp must be a dedicated tmpfs.\n' >&2
  exit 1
fi
if [ "$tmpfs_available_kib" -gt "$tmpfs_capacity_kib" ]; then
  printf 'ClamAV /tmp reports invalid available capacity.\n' >&2
  exit 1
fi

required_bytes="$((max_upload_bytes * scan_concurrency + headroom_bytes))"
required_kib="$(((required_bytes + 1023) / 1024))"
if [ "$tmpfs_capacity_kib" -lt "$required_kib" ]; then
  printf 'ClamAV /tmp is too small for the configured upload limit and scan concurrency.\n' >&2
  exit 1
fi
if [ "$tmpfs_available_kib" -lt "$required_kib" ]; then
  printf 'ClamAV /tmp does not have enough available space for the configured upload limit and scan concurrency.\n' >&2
  exit 1
fi

# Extremely large cgroup v1 sentinel values must never be accepted as a finite
# memory contract. The production host is well below 1 TiB.
if [ "${#cgroup_memory_limit_bytes}" -gt 13 ] || [ "$cgroup_memory_limit_bytes" -gt 1099511627776 ]; then
  printf 'ClamAV cgroup memory limit is absent or effectively unbounded.\n' >&2
  exit 1
fi
tmpfs_capacity_bytes="$((tmpfs_capacity_kib * 1024))"
required_memory_bytes="$((tmpfs_capacity_bytes + engine_memory_reserve_bytes))"
if [ "$cgroup_memory_limit_bytes" -lt "$required_memory_bytes" ]; then
  printf 'ClamAV cgroup memory limit is too small for the tmpfs and engine reserve.\n' >&2
  exit 1
fi

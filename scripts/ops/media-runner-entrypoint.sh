#!/bin/sh
set -eu

work_root="${MEDIA_PROCESSING_WORK_ROOT:-}"
mount_root="/var/lib/q-academy-media-processing"
expected_root="$mount_root/work"
sentinel="$mount_root/.q-academy-media-work-root"

if [ "$work_root" != "$expected_root" ] || [ ! -d "$work_root" ] || [ -L "$work_root" ] || [ ! -w "$work_root" ]; then
  printf 'Media processing work root is missing, unsafe, or not writable.\n' >&2
  exit 1
fi
if [ ! -f "$sentinel" ] || [ -L "$sentinel" ] || [ "$(cat -- "$sentinel")" != "q-academy-media-processing-v1" ]; then
  printf 'Media processing work mount sentinel is missing or invalid.\n' >&2
  exit 1
fi
if [ "$(stat -c '%u:%g:%a' "$mount_root")" != "0:0:755" ] || \
   [ "$(stat -c '%u:%g:%a' "$sentinel")" != "0:0:444" ] || \
   [ "$(stat -c '%u:%g:%a' "$work_root")" != "1001:1001:700" ]; then
  printf 'Media processing work mount ownership or mode is invalid.\n' >&2
  exit 1
fi

# Stay on the verified filesystem while removing children. A nested mount is
# never traversed and makes deletion fail closed instead of erasing its data.
find "$work_root" -xdev -depth -mindepth 1 -delete
probe="$work_root/.startup-probe.$$"
( umask 077 && : >"$probe" )
rm -f -- "$probe"

exec "$@"

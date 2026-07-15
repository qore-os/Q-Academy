#!/bin/sh
set -eu

mode="${1:-signatures}"
database_directory="${CLAMAV_SIGNATURE_DIRECTORY:-/var/lib/clamav}"
max_age_seconds="${CLAMAV_SIGNATURE_MAX_AGE_SECONDS:-129600}"

case "$max_age_seconds" in
  ""|*[!0-9]*)
    printf 'ClamAV signature age limit is invalid.\n' >&2
    exit 1
    ;;
esac
if [ "$max_age_seconds" -lt 3600 ] || [ "$max_age_seconds" -gt 604800 ]; then
  printf 'ClamAV signature age limit is outside the safe range.\n' >&2
  exit 1
fi

now="$(date +%s)"
latest=0

read_signature_timestamp() {
  signature_path="$1"
  signature_size="$(stat -c '%s' "$signature_path")" || return 1
  case "$signature_size" in
    ""|*[!0-9]*) return 1 ;;
  esac
  if [ "$signature_size" -lt 512 ]; then return 1; fi

  LC_ALL=C dd if="$signature_path" bs=512 count=1 2>/dev/null |
    LC_ALL=C awk -F ':' '
      BEGIN { ORS = "" }
      {
        record_length = length($0)
        sub(/[[:space:]]+$/, "", $9)
        if (NR != 1 || record_length != 512 || NF != 9 || $1 != "ClamAV-VDB" || $2 == "" || $3 !~ /^[0-9]+$/ || $4 !~ /^[0-9]+$/ || $5 !~ /^[0-9]+$/ || $9 !~ /^[0-9]+$/) {
          exit 1
        }
        print $9
      }
      END { if (NR != 1) exit 1 }
    '
}

found=false
for name in daily.cvd daily.cld; do
  path="${database_directory}/${name}"
  if [ -e "$path" ] || [ -L "$path" ]; then
    if [ ! -f "$path" ] || [ -L "$path" ]; then
      printf 'ClamAV daily signature database is not a regular file.\n' >&2
      exit 1
    fi
    issued_at="$(read_signature_timestamp "$path")" || {
      printf 'ClamAV daily signature database header is invalid.\n' >&2
      exit 1
    }
    case "$issued_at" in
      ""|*[!0-9]*)
        printf 'ClamAV signature database timestamp is invalid.\n' >&2
        exit 1
        ;;
    esac
    found=true
    if [ "$issued_at" -gt "$latest" ]; then latest="$issued_at"; fi
  fi
done

if [ "$found" != "true" ] || [ "$latest" -eq 0 ] || [ "$latest" -gt "$((now + 300))" ]; then
  printf 'ClamAV daily signatures are missing or have an invalid timestamp.\n' >&2
  exit 1
fi
if [ "$((now - latest))" -gt "$max_age_seconds" ]; then
  printf 'ClamAV daily signatures are stale.\n' >&2
  exit 1
fi

case "$mode" in
  signatures)
    ;;
  updater)
    freshclam_running=false
    for process_name in /proc/[0-9]*/comm; do
      if [ -r "$process_name" ] && [ "$(cat "$process_name")" = "freshclam" ]; then
        freshclam_running=true
        break
      fi
    done
    if [ "$freshclam_running" != "true" ]; then
      printf 'FreshClam updater process is unavailable.\n' >&2
      exit 1
    fi
    ;;
  clamd)
    exec /usr/local/bin/clamdcheck.sh
    ;;
  *)
    printf 'ClamAV health mode is invalid.\n' >&2
    exit 1
    ;;
esac

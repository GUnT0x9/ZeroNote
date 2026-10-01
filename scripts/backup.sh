#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
: "${AGE_RECIPIENT:?Set AGE_RECIPIENT (public key)}"
: "${BACKUP_DIRECTORY:?Set an absolute directory outside the repository}"
command -v age >/dev/null
pg_dump --version | grep -Eq ' 17\.' || { echo 'PostgreSQL 17 pg_dump is required.' >&2; exit 1; }
[[ "$BACKUP_DIRECTORY" = /* ]] || { echo 'Use an absolute backup directory.' >&2; exit 1; }
repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
BACKUP_DIRECTORY=$(realpath -m "$BACKUP_DIRECTORY")
case "$BACKUP_DIRECTORY/" in
  "$repository_root/"*) echo 'Keep backups outside the repository.' >&2; exit 1 ;;
esac
umask 077
mkdir -p "$BACKUP_DIRECTORY"
backup_file=$(mktemp "$BACKUP_DIRECTORY/zeronote-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.partial")
trap 'rm -f "$backup_file"' ERR
PGDATABASE="$DATABASE_URL" pg_dump --format=custom --no-owner --no-acl | age -r "$AGE_RECIPIENT" -o "$backup_file"
mv -- "$backup_file" "${backup_file%.partial}.age"
trap - ERR
# Keep four successfully completed encrypted dumps; never touch unrelated files.
mapfile -t backup_files < <(find "$BACKUP_DIRECTORY" -maxdepth 1 -type f -name 'zeronote-*.age' -printf '%T@ %f\n' | sort -nr | cut -d' ' -f2-)
for ((index=4; index<${#backup_files[@]}; index++)); do rm -- "$BACKUP_DIRECTORY/${backup_files[$index]}"; done
printf 'Encrypted backup saved.\n'

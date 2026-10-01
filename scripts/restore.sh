#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_DATABASE_URL:?Set an empty, separate database URL}"
: "${AGE_IDENTITY_FILE:?Set private identity file outside Git}"
: "${BACKUP_FILE:?Set encrypted backup path}"
command -v age >/dev/null
pg_restore --version | grep -Eq ' 17\.' || { echo 'PostgreSQL 17 pg_restore is required.' >&2; exit 1; }
repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
AGE_IDENTITY_FILE=$(realpath -e "$AGE_IDENTITY_FILE")
case "$AGE_IDENTITY_FILE" in
  "$repository_root/"*) echo 'Keep the private identity outside the repository.' >&2; exit 1 ;;
esac
if [[ -n "${DATABASE_URL:-}" && "$DATABASE_URL" = "$RESTORE_DATABASE_URL" ]]; then echo 'Source and restore databases must differ.' >&2; exit 1; fi
existing_tables=$(DATABASE_URL="$RESTORE_DATABASE_URL" node "$repository_root/scripts/postgres-client.mjs" psql -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
[[ "$existing_tables" = 0 ]] || { echo 'Restore requires an empty database.' >&2; exit 1; }
age -d -i "$AGE_IDENTITY_FILE" "$BACKUP_FILE" | DATABASE_URL="$RESTORE_DATABASE_URL" node "$repository_root/scripts/postgres-client.mjs" pg_restore --single-transaction --exit-on-error --no-owner --no-acl
printf 'Backup restored into the separate database.\n'

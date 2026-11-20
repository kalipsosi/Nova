#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  printf 'Usage: bash %s BACKUP.dump.age AGE_IDENTITY_FILE\n' "$0" >&2
  exit 2
fi
archive=$1
identity=$2
# Always create a fresh local database. A failed CREATE leaves any existing database untouched.
restore_db="nova_restore_$(date -u +%Y%m%d%H%M%S)_$$"
pg_opts=(--host=/var/run/postgresql --username=postgres)
sudo -u postgres createdb "${pg_opts[@]}" "$restore_db"
trap 'sudo -u postgres dropdb "${pg_opts[@]}" "$restore_db"' EXIT

age --decrypt --identity "$identity" "$archive" \
  | sudo -u postgres pg_restore "${pg_opts[@]}" --dbname="$restore_db" --exit-on-error --single-transaction --no-owner --no-privileges
sudo -u postgres psql "${pg_opts[@]}" --dbname="$restore_db" -X --set=ON_ERROR_STOP=1 \
  --command='SELECT count(*) AS migrations FROM schema_migrations; SELECT count(*) AS users FROM users;'
printf 'Restore check completed in %s. Removing the temporary database.\n' "$restore_db"

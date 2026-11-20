#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${NOVA_BACKUP_RECIPIENT:?Set NOVA_BACKUP_RECIPIENT to an age public key}"
backup_dir=/var/backups/nova
retention_days=${NOVA_BACKUP_RETENTION_DAYS:-14}
[[ $retention_days =~ ^[1-9][0-9]*$ ]] || exit 2
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$backup_dir/nova-$stamp.dump.age"
tmp=$(mktemp "$backup_dir/.nova-$stamp.XXXXXXXX")
trap 'rm -f -- "$tmp"' EXIT

pg_dump --host=/var/run/postgresql --username=postgres --dbname=nova --format=custom \
  | age --encrypt --recipient "$NOVA_BACKUP_RECIPIENT" > "$tmp"
mv -- "$tmp" "$out"
find "$backup_dir" -maxdepth 1 -type f -name 'nova-*.dump.age' -mtime "+$retention_days" -delete
printf 'Created encrypted backup %s\n' "$out"

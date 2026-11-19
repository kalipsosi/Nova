#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_FILE:?BACKUP_FILE must point to an encrypted .dump.enc file}"
: "${RESTORE_DB:?RESTORE_DB must name a temporary database}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -in "$BACKUP_FILE" -out "$tmp" -pass env:BACKUP_PASSPHRASE
docker compose -f docker-compose.prod.yml exec -T postgres createdb -U "${POSTGRES_USER:-nova}" "$RESTORE_DB" 2>/dev/null || true
docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U "${POSTGRES_USER:-nova}" -d "$RESTORE_DB" --clean --if-exists < "$tmp"
printf 'restored backup into temporary database %s\n' "$RESTORE_DB"

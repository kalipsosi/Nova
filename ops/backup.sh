#!/usr/bin/env bash
set -euo pipefail

backup_dir=${BACKUP_DIR:-/var/backups/nova}
retention_days=${BACKUP_RETENTION_DAYS:-14}
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$backup_dir/nova-$stamp.dump.enc"

# The dump is encrypted as a stream, so a plaintext database file is never written.
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -Fc -U "${POSTGRES_USER:-nova}" -d "${POSTGRES_DB:-nova}" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 300000 -salt -pass env:BACKUP_PASSPHRASE -out "$out"
chmod 600 "$out"
find "$backup_dir" -type f -name 'nova-*.dump.enc' -mtime "+$retention_days" -delete
printf 'created encrypted backup %s\n' "$out"

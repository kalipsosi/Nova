param(
  [string]$BackupDir = '.\backups'
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$out = Join-Path $BackupDir "nova-$stamp.dump"
docker compose exec -T postgres pg_dump -Fc -U nova -d nova --file /tmp/nova.dump
docker compose cp postgres:/tmp/nova.dump $out
docker compose exec -T postgres rm -f /tmp/nova.dump
Write-Output "Created local development dump at $out"

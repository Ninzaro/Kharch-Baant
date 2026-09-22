# Nightly logical dump (R-32). No PITR on this Supabase plan.
# Writes schema + data SQL outside the git repo. Does not print row contents.
# Requires: supabase CLI already logged in and this repo linked (supabase link).

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Error "Docker is not running. supabase db dump uses a pg_dump container. Start Docker Desktop, then rerun."
}

$outDir = Join-Path $env:USERPROFILE "Kharch-Baant-backups"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$schema = Join-Path $outDir "schema-$stamp.sql"
$data = Join-Path $outDir "data-$stamp.sql"

npx supabase db dump --linked --file $schema
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npx supabase db dump --linked --data-only --use-copy --file $data
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Get-ChildItem $outDir -File |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
  Remove-Item -Force

Write-Host "Dump written under $outDir ($stamp). Keep this folder off git and off the phone."

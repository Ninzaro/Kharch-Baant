# Deploy current work to GitHub main (Vercel + Android AAB CI).
# From the repo folder in Windows Terminal:
#   powershell -ExecutionPolicy Bypass -File .\deploy-main.ps1
#   powershell -ExecutionPolicy Bypass -File .\deploy-main.ps1 -Message "fix: google oauth via account portal"

param(
  [string]$Message = "chore: deploy latest changes"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path .git)) {
  Write-Error "Run this from the Kharch-Baant repo (no .git folder here)."
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "main") {
  Write-Error "You are on '$branch'. Switch to main before deploying."
}

git status --short
git add -A

$staged = git diff --cached --name-only
if ($staged) {
  git commit -m $Message
  Write-Host "Committed: $Message" -ForegroundColor Green
} else {
  Write-Host "Nothing new to commit." -ForegroundColor Yellow
}

git push origin main
Write-Host "Pushed to origin/main." -ForegroundColor Green
Write-Host "Web: Vercel  |  Android AAB: https://github.com/Ninzaro/Kharch-Baant/actions" -ForegroundColor Cyan

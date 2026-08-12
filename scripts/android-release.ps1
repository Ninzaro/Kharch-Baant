# Production Play Store AAB. Run from repo root:
#   npm run android:build:release
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Find-JdkHome {
    $searchRoots = @(
        $env:JAVA_HOME,
        "C:\Users\NINAD\AppData\Local\Programs\Eclipse Adoptium",
        "C:\Program Files\Eclipse Adoptium",
        "E:\Program Files\Java",
        "C:\Program Files\Java",
        "C:\Program Files\Android\Android Studio\jbr"
    ) | Where-Object { $_ -and (Test-Path $_) }

    $javas = @()
    foreach ($r in $searchRoots) {
        $javas += Get-ChildItem -Path $r -Recurse -Filter "java.exe" -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\bin\\java\.exe$' }
    }
    if ($javas.Count -eq 0) { return $null }

    $jdk21 = $javas | Where-Object { $_.FullName -match "jdk-21|jdk\\21" } | Select-Object -First 1
    if ($jdk21) { return $jdk21.Directory.Parent.FullName }

    $jdk17 = $javas | Where-Object { $_.FullName -match "jdk-17|jdk\\17|jbr" } | Select-Object -First 1
    if ($jdk17) { return $jdk17.Directory.Parent.FullName }

    return $javas[0].Directory.Parent.FullName
}

if ($env:CAPACITOR_DEV_SERVER_URL) {
    Remove-Item Env:CAPACITOR_DEV_SERVER_URL
}

$jdk = Find-JdkHome
if (-not $jdk) {
    Write-Host "No JDK found. Install Temurin 17 or 21 from https://adoptium.net/"
    exit 1
}

$env:JAVA_HOME = $jdk
$env:Path = (Join-Path $jdk "bin") + ";" + $env:Path
Write-Host "JAVA_HOME=$jdk"
& "$jdk\bin\java.exe" -version

Write-Host ""
Write-Host "1/4  Building web app..."
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "2/4  Syncing Capacitor Android..."
npx cap sync android
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "3/4  Checking release config..."
node scripts/assert-android-release.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "4/4  Gradle bundleRelease (this can take several minutes)..."
Set-Location (Join-Path $root "android")
& .\gradlew.bat bundleRelease --no-daemon
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$aab = Join-Path $root "android\app\build\outputs\bundle\release\app-release.aab"
if (-not (Test-Path $aab)) {
    Write-Host "Build finished but AAB not found at $aab"
    exit 1
}

Write-Host ""
Write-Host "SUCCESS"
Write-Host "Upload this file to Play Console (Internal testing first):"
Write-Host "  $aab"

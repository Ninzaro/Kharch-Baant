# Installs a local Android SDK (command-line tools only) for Play Store builds.
# Does not install Android Studio.
$ErrorActionPreference = "Stop"

$sdkRoot = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$toolsZip = Join-Path $env:TEMP "commandlinetools-win.zip"
$toolsUrl = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
$jdk = "C:\Users\NINAD\AppData\Local\Programs\Eclipse Adoptium\jdk-17.0.20.8-hotspot"
if (-not (Test-Path "$jdk\bin\java.exe")) {
    Write-Host "JDK 17 not found at $jdk"
    exit 1
}
$env:JAVA_HOME = $jdk
$env:Path = "$jdk\bin;" + $env:Path

New-Item -ItemType Directory -Force -Path $sdkRoot | Out-Null

$sdkmanager = Join-Path $sdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path $sdkmanager)) {
    Write-Host "Downloading Android command-line tools..."
    Invoke-WebRequest -Uri $toolsUrl -OutFile $toolsZip
    $extract = Join-Path $env:TEMP "android-cmdline-tools"
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    Expand-Archive -Path $toolsZip -DestinationPath $extract -Force
    $dest = Join-Path $sdkRoot "cmdline-tools\latest"
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    # Zip contains a top-level "cmdline-tools" folder
    $inner = Join-Path $extract "cmdline-tools"
    if (-not (Test-Path $inner)) { $inner = $extract }
    Move-Item $inner $dest
}

if (-not (Test-Path $sdkmanager)) {
    Write-Host "sdkmanager.bat missing after extract"
    exit 1
}

Write-Host "Accepting licenses and installing platform 35 + build-tools..."
$yes = "y`ny`ny`ny`ny`ny`ny`ny`ny`ny`n"
$yes | & $sdkmanager --sdk_root=$sdkRoot --licenses | Out-Host
& $sdkmanager --sdk_root=$sdkRoot "platforms;android-35" "build-tools;35.0.0" "platform-tools"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$props = Join-Path $PSScriptRoot "..\android\local.properties"
$escaped = ($sdkRoot -replace '\\', '\\')
@(
    "## This file must *NOT* be checked into Version Control Systems,"
    "sdk.dir=$($sdkRoot -replace '\\','\\')"
) | Set-Content -Path (Join-Path $PSScriptRoot "..\android\local.properties") -Encoding ASCII

# Gradle wants either C:\\path or C:/path
$sdkProp = $sdkRoot -replace '\\', '/'
Set-Content -Path (Join-Path $PSScriptRoot "..\android\local.properties") -Encoding ASCII -Value @"
## This file must *NOT* be checked into Version Control Systems,
sdk.dir=$sdkProp
"@

Write-Host ""
Write-Host "Android SDK ready at $sdkRoot"
Write-Host "local.properties updated (gitignored)."

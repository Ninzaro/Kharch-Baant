# Creates a Play Store upload keystore + android/keystore.properties.
# Run from the project root:
#   powershell -ExecutionPolicy Bypass -File scripts/create-release-keystore.ps1
#
# The .keystore file and passwords are NEVER committed to git.
# Back them up offline. Losing them means you cannot update the app on Play.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Find-Keytool {
    $searchRoots = @(
        $env:JAVA_HOME,
        "E:\Program Files\Java",
        "C:\Program Files\Java",
        "C:\Program Files (x86)\Java",
        "C:\Program Files\Eclipse Adoptium",
        "C:\Program Files\Microsoft",
        "C:\Program Files\Android\Android Studio\jbr"
    ) | Where-Object { $_ -and (Test-Path $_) }

    $found = @()
    foreach ($rootDir in $searchRoots) {
        $found += Get-ChildItem -Path $rootDir -Recurse -Filter "keytool.exe" -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -like "*\bin\keytool.exe" }
    }

    if ($found.Count -gt 0) {
        $jdk21 = $found | Where-Object { $_.FullName -match "jdk-21|jdk\\21|jbr" } | Select-Object -First 1
        if ($jdk21) { return $jdk21.FullName }
        return $found[0].FullName
    }

    return $null
}

$keytool = Find-Keytool
if (-not $keytool) {
    Write-Host ""
    Write-Host "Could not find keytool (Java)."
    Write-Host "Install JDK 21 from https://adoptium.net/temurin/releases/?version=21"
    Write-Host "Then run this script again."
    exit 1
}

$storeFileName = "kharch-baant-release.keystore"
$storePath = Join-Path $root "android\$storeFileName"
$propsPath = Join-Path $root "android\keystore.properties"
$alias = "kharch-baant"

if (Test-Path $storePath) {
    Write-Host "A keystore already exists at:"
    Write-Host "  $storePath"
    Write-Host "I will not overwrite it. If you meant to start over, move that file somewhere safe first."
    exit 1
}

Write-Host ""
Write-Host "This creates the secret key Google Play uses to recognize YOUR app."
Write-Host "If you lose this file or the password, you cannot publish updates."
Write-Host ""
Write-Host "Pick a password you will remember. Write it in a password manager or on paper."
Write-Host "Do not put it in GitHub or chat."
Write-Host ""

$secure1 = Read-Host "Type a new keystore password (min 6 characters)" -AsSecureString
$secure2 = Read-Host "Type the same password again" -AsSecureString

$bstr1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure1)
$bstr2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure2)
try {
    $pass1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr1)
    $pass2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr2)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr1)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr2)
}

if ($pass1 -ne $pass2) {
    Write-Host "Passwords did not match. Nothing was created."
    exit 1
}
if ($pass1.Length -lt 6) {
    Write-Host "Password must be at least 6 characters."
    exit 1
}

if (-not (Test-Path -LiteralPath $keytool)) {
    Write-Host "keytool path is invalid: $keytool"
    exit 1
}

Write-Host ""
Write-Host "Using keytool:"
Write-Host ("  " + $keytool)
Write-Host "Creating keystore (this takes a few seconds)..."

# No spaces in DN values — keytool treats spaces as new options.
$dname = "CN=KharchBaant,OU=Mobile,O=KharchBaant,L=Unknown,ST=Unknown,C=IN"

# Call operator + argument array keeps paths and DN as single args.
& $keytool @(
    "-genkeypair",
    "-v",
    "-keystore", $storePath,
    "-alias", $alias,
    "-keyalg", "RSA",
    "-keysize", "2048",
    "-validity", "10000",
    "-storepass", $pass1,
    "-keypass", $pass1,
    "-dname", $dname
)

if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $storePath)) {
    Write-Host "keytool failed. Nothing was saved."
    exit 1
}

@(
    "storeFile=$storeFileName"
    "storePassword=$pass1"
    "keyAlias=$alias"
    "keyPassword=$pass1"
) | Set-Content -Path $propsPath -Encoding ASCII

Write-Host ""
Write-Host "Done."
Write-Host "  Keystore:  android\$storeFileName"
Write-Host "  Config:    android\keystore.properties  (gitignored)"
Write-Host ""
Write-Host "BACKUP NOW (same day):"
Write-Host "  1. Copy android\$storeFileName to a USB drive or password-manager file."
Write-Host "  2. Save the password in the same safe place."
Write-Host "  3. Do not commit these files. Do not email them to me."
Write-Host ""
Write-Host "Next:  npm run android:build:release"

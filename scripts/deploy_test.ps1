$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot'
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

npm run build
npx cap sync android
Set-Location android
.\gradlew.bat assembleDebug

if ($LASTEXITCODE -eq 0) {
  & $adb -s RZCW308ZM5Y install -r app\build\outputs\apk\debug\app-debug.apk
  & $adb -s RZCW308ZM5Y shell am force-stop com.kharchbaant.app
  & $adb -s RZCW308ZM5Y shell am start -n com.kharchbaant.app/.MainActivity
}

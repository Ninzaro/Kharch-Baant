@echo off
cd /d "%~dp0"
echo.
echo === Git Push Script ===
echo.
git add -A
echo.
set /p msg="Commit message: "
if "%msg%"=="" set msg=Update changes
git commit -m "%msg%"
echo.
git push
echo.
echo === Done ===
pause

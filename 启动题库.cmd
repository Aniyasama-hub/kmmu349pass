@echo off
setlocal
cd /d "%~dp0" || goto :launch_failed
if exist "%~dp0windows\Kunming349Desktop.exe" goto :launch
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windowsuild.ps1"
if errorlevel 1 goto :build_failed

:launch
start "" "%~dp0windows\Kunming349Desktop.exe"
if errorlevel 1 goto :launch_failed
exit /b 0

:build_failed
echo The desktop application could not be built. See the Windows requirements in README.md.
pause
exit /b 1

:launch_failed
echo The desktop application could not be started. Open README.md for setup instructions.
pause
exit /b 1

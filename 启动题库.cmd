@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  python -X utf8 "%~dp0local_study.py"
) else (
  py -3 -X utf8 "%~dp0local_study.py"
)
if errorlevel 1 pause

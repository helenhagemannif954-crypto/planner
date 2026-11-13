@echo off
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
where py >nul 2>&1
if errorlevel 1 (
  echo Python ne najden. Ustanovite Python 3 s python.org i otkrojte etot fajl snova.
  pause
  exit /b 1
)
py -3 claude_archive.py
pause

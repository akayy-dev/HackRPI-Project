@echo off
rem One-click demo launcher. Double-click, or run: demo.cmd [-Rate 5] [-Malicious 40] [-NoTraffic] [-Stop]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\demo.ps1" %*
if errorlevel 1 pause

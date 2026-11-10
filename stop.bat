@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 智考通 · 停止器

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。
  pause
  exit /b 1
)

node "scripts\stop.js"
pause
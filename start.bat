@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 智考通 · 启动器

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 20 LTS 或更高版本。
  pause
  exit /b 1
)

rem 若已有实例在运行，则提示先停止
node -e "try{const r=require('./data/runtime.json');process.kill(r.pid,0);process.exit(2)}catch(e){process.exit(0)}" >nul 2>nul
if errorlevel 2 (
  echo [提示] 检测到服务已在运行，请先执行 Stop.bat 停止后再启动。
  pause
  exit /b 1
)

if not exist node_modules (
  echo [提示] 首次运行，正在安装依赖（约 1-2 分钟）...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo [提示] 正在启动服务，将自动寻找未被占用的端口...
start "智考通服务端" cmd /c "node server.js || pause"

echo.
echo [提示] 服务已在独立窗口启动，端口自动选择（默认从 8080 开始探测）。
echo [提示] 启动成功后浏览器会自动打开；如未打开，请查看服务窗口显示的访问地址。
echo [提示] 停止服务请运行 Stop.bat。
echo.
pause
@echo off
setlocal
chcp 65001 >nul
title CAELUS - 런타임 자동 설치

REM =====================================================================
REM  최초 1회, 인터넷이 연결된 PC에서 더블클릭.
REM  Node.js portable / PortableGit / Claude Code CLI / Electron 의존성을
REM  자동으로 내려받아 USB 안에 설치한다. (install_runtime.ps1 래퍼)
REM =====================================================================

set "USB_ROOT=%~dp0"
if "%USB_ROOT:~-1%"=="\" set "USB_ROOT=%USB_ROOT:~0,-1%"

echo ============================================
echo   CAELUS 포터블 런타임 자동 설치
echo   (Node.js / PortableGit / Claude Code CLI / Electron 의존성)
echo   인터넷 연결이 필요하며, 수 분 정도 걸릴 수 있습니다.
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%USB_ROOT%\install_runtime.ps1" %*

if %errorlevel% neq 0 (
    echo.
    echo [오류] 자동 설치 중 문제가 발생했습니다. 위 로그를 확인해주세요.
    pause
    exit /b 1
)

echo.
pause
exit /b 0

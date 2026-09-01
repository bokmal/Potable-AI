@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title CAELUS - 최초 1회 설정

REM =====================================================================
REM  CAELUS 최초 설정 스크립트
REM
REM  이 PC의 작업 스케줄러에 "이 USB 삽입 시 CAELUS 자동 실행" 트리거를
REM  등록한다. USB가 아니라 PC(로컬 작업 스케줄러)에 저장되는 설정이므로
REM  다른 PC에서 자동 실행을 원하면 그 PC에서도 이 스크립트를 실행해야
REM  한다.
REM =====================================================================

REM --- 관리자 권한 확인, 없으면 UAC 승인 후 재실행 ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [CAELUS] 관리자 권한이 필요합니다. UAC 승인 창을 확인해주세요...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

set "USB_ROOT=%~dp0"
if "%USB_ROOT:~-1%"=="\" set "USB_ROOT=%USB_ROOT:~0,-1%"

echo ============================================
echo   CAELUS 포터블 작업환경 - 최초 설정
echo ============================================
echo.
echo   USB 경로 : %USB_ROOT%
echo.
echo   이 PC에 "USB 삽입 시 CAELUS 자동 실행" 트리거를 등록합니다.
echo   (등록 정보는 이 PC의 작업 스케줄러에만 저장되며, USB에는 남지 않습니다.)
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%USB_ROOT%\install_trigger.ps1" -UsbRoot "%USB_ROOT%"

if %errorlevel% neq 0 (
    echo.
    echo [경고] 자동 실행 트리거 등록에 실패했습니다.
    echo   - 회사/공용 PC는 그룹 정책으로 작업 스케줄러 등록이 차단되어 있을 수 있습니다.
    echo   - 이 경우 자동 실행 없이 USB의 start.bat 을 더블클릭해서 수동으로 실행해주세요.
    echo.
    pause
    exit /b 1
)

echo.
echo [완료] 설정이 완료되었습니다.
echo        이제부터 이 PC에서는 USB를 꽂으면 CAELUS가 자동으로 실행됩니다.
echo        (다른 PC에서도 자동 실행을 원하면 해당 PC에서 setup.bat 을 한 번 더 실행하세요.)
echo.
pause
exit /b 0

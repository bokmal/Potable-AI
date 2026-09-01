@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title CAELUS

REM =====================================================================
REM  CAELUS 진입점
REM
REM  - HOME / USERPROFILE 을 이 세션에서만 USB 내부(claude-home)로 재설정한다.
REM    (시스템 환경변수는 건드리지 않으므로 PC 재부팅 시 흔적이 남지 않는다)
REM  - node\ , git\ 를 이 세션 PATH 앞쪽에 임시로 추가한다.
REM  - electron-app(CAELUS UI)을 실행한다. 실제 처리는 Claude Code CLI가 담당한다.
REM =====================================================================

set "USB_ROOT=%~dp0"
if "%USB_ROOT:~-1%"=="\" set "USB_ROOT=%USB_ROOT:~0,-1%"

REM --- HOME 리다이렉트 (세션 한정) ---
set "HOME=%USB_ROOT%\claude-home"
set "USERPROFILE=%USB_ROOT%\claude-home"
if not exist "%HOME%" mkdir "%HOME%"
if not exist "%HOME%\data" mkdir "%HOME%\data"

REM --- PATH 임시 확장 (세션 한정, 시스템 PATH 미변경) ---
set "PATH=%USB_ROOT%\node;%USB_ROOT%\git\bin;%USB_ROOT%\git\cmd;%PATH%"

REM --- 이 세션에서 사용할 볼륨 시리얼 (UI 표시/데이터 모델용, 선택 정보) ---
for /f "tokens=2 delims==" %%S in ('wmic logicaldisk where "DeviceID='%USB_ROOT:~0,2%'" get VolumeSerialNumber /value ^| findstr "="') do set "CAELUS_VOLUME_SERIAL=%%S"

echo ============================================
echo   CAELUS 포터블 작업환경 시작
echo ============================================
echo   USB 위치        : %USB_ROOT%
echo   HOME 리다이렉트 : %HOME%
echo ============================================
echo.

REM --- Node 존재 확인 ---
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] node.exe 를 찾을 수 없습니다.
    echo        "%USB_ROOT%\node" 폴더에 Node.js portable 배포판이 있는지 확인해주세요.
    echo        ^(node\README.md 참고^)
    pause
    exit /b 1
)

REM --- Claude Code CLI 존재 확인 (경고만, 실행은 계속 진행) ---
where claude >nul 2>&1
if %errorlevel% neq 0 (
    echo [경고] claude CLI 가 PATH 에서 발견되지 않았습니다.
    echo        "npm install -g @anthropic-ai/claude-code" 로 claude-home 아래에
    echo        전역 설치되어 있는지, 혹은 PATH 설정을 확인해주세요.
    echo.
)

REM --- Electron 앱(CAELUS UI) 실행 ---
pushd "%USB_ROOT%\electron-app"

if exist "node_modules\.bin\electron.cmd" (
    call node_modules\.bin\electron.cmd .
) else (
    echo [안내] electron-app 의 의존성이 아직 설치되지 않았습니다.
    echo        인터넷이 연결된 환경에서 최초 1회 다음을 실행해주세요:
    echo.
    echo            cd electron-app
    echo            npm install
    echo.
    pause
)

popd
endlocal

@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title CAELUS

REM =====================================================================
REM  CAELUS 진입점
REM
REM  - CAELUS_HOME 을 USB 내부(claude-home)로 설정한다 — Claude Code CLI의
REM    인증/세션 저장 위치를 USB로 고정하는 데 쓰인다(Electron 자체의
REM    HOME/USERPROFILE은 건드리지 않는다. 이유는 아래 CAELUS_HOME 설정
REM    부분 주석 참고). 이 값은 세션(창) 한정이며 시스템 환경변수는
REM    건드리지 않으므로 PC 재부팅 시 흔적이 남지 않는다.
REM  - node\ , git\ 를 이 세션 PATH 앞쪽에 임시로 추가한다.
REM  - electron-app(CAELUS UI)을 실행한다. 실제 처리는 Claude Code CLI가 담당한다.
REM =====================================================================

set "USB_ROOT=%~dp0"
if "%USB_ROOT:~-1%"=="\" set "USB_ROOT=%USB_ROOT:~0,-1%"

REM --- CAELUS 전용 HOME 위치 (세션 한정) ---
REM  주의: 시스템 HOME/USERPROFILE 자체를 여기서 바꾸지 않는다. 예전에는
REM  이 스크립트가 HOME/USERPROFILE을 통째로 재설정했는데, 그러면 Electron
REM  (Chromium)이 내부 프로필 경로 계산 중 조용히 비정상 종료하는 문제가
REM  실사용 중 확인되었다. 대신 CAELUS_HOME 변수로만 전달하고, Claude Code
REM  CLI를 실제로 실행하는 자식 프로세스에서만(claudeBridge.js) 이 값을
REM  HOME/USERPROFILE로 주입해 세션 저장 위치를 USB로 리다이렉트한다.
set "CAELUS_HOME=%USB_ROOT%\claude-home"
if not exist "%CAELUS_HOME%" mkdir "%CAELUS_HOME%"
if not exist "%CAELUS_HOME%\data" mkdir "%CAELUS_HOME%\data"

REM --- PATH 임시 확장 (세션 한정, 시스템 PATH 미변경) ---
REM  node 만 여기서 PATH에 추가한다(electron.cmd 실행 부트스트랩에 필요).
REM  git\bin, git\cmd 는 추가하지 않는다 — Electron(Chromium) 프로세스의
REM  PATH 맨 앞에 PortableGit의 bin 폴더가 끼면, 그 안의 DLL(openssl/zlib
REM  등, Chromium이 쓰는 것과 이름이 같은)과 충돌해 강제종료(액세스 위반,
REM  종료 코드 -1073741819 / 0xC0000005)되는 문제가 실사용 중 확인되었다.
REM  git은 CAELUS_GIT_BIN 변수로만 전달하고, Claude Code CLI 자식 프로세스
REM  에서만(claudeBridge.js) 그 PATH를 추가한다.
set "PATH=%USB_ROOT%\node;%PATH%"
set "CAELUS_GIT_BIN=%USB_ROOT%\git\bin;%USB_ROOT%\git\cmd"

REM --- 이 세션에서 사용할 볼륨 시리얼 (UI 표시/데이터 모델용, 선택 정보) ---
for /f "tokens=2 delims==" %%S in ('wmic logicaldisk where "DeviceID='%USB_ROOT:~0,2%'" get VolumeSerialNumber /value ^| findstr "="') do set "CAELUS_VOLUME_SERIAL=%%S"

echo ============================================
echo   CAELUS 포터블 작업환경 시작
echo ============================================
echo   USB 위치        : %USB_ROOT%
echo   CAELUS_HOME     : %CAELUS_HOME%
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
    if not exist "node_modules\electron\dist\electron.exe" (
        echo [경고] Electron 실행 파일^(node_modules\electron\dist\electron.exe^)이 없습니다.
        echo        "npm install" 중 Electron 바이너리 다운로드가 실패했을 수 있습니다.
        echo        electron-app 폴더에서 "npm install" 을 다시 실행해보세요.
        echo.
    )
    call :LaunchElectron
    if !CAELUS_EXIT! neq 0 (
        echo.
        echo [경고] CAELUS 앱이 비정상 종료됐습니다 ^(코드 !CAELUS_EXIT!^).
        echo        USB 접촉 불량 등 일시적인 문제였을 수 있습니다. 2초 후 한 번 더 시도합니다...
        timeout /t 2 /nobreak >nul
        call :LaunchElectron
        if !CAELUS_EXIT! neq 0 (
            echo.
            echo [오류] CAELUS 앱이 다시 오류 코드 !CAELUS_EXIT! 로 종료되었습니다.
            echo        USB 케이블/포트 연결 상태를 확인해주세요.
            echo        계속되면 electron-app\node_modules\electron\dist\electron.exe
            echo        가 있는지, 백신이 차단하고 있지는 않은지 확인해주세요.
            pause
        )
    )
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
exit /b 0

REM --- 서브루틴: Electron 실행, 종료 코드를 CAELUS_EXIT 에 남긴다 ---
:LaunchElectron
call node_modules\.bin\electron.cmd .
set "CAELUS_EXIT=%errorlevel%"
exit /b 0

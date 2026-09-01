<#
.SYNOPSIS
  CAELUS 포터블 런타임(Node.js, PortableGit, Claude Code CLI, Electron 의존성)을
  USB에 자동으로 내려받아 설치한다. 설계 문서 4장 "최초 1회 준비" 단계 자동화.

.DESCRIPTION
  인터넷이 연결된 Windows PC에서 한 번만 실행하면 된다 (install_runtime.bat 을
  더블클릭하거나 이 스크립트를 직접 실행).

  - node\ 에 node.exe 가 없으면 Node.js LTS(win-x64 zip, nodejs.org 공식 배포)를
    내려받아 압축을 푼다.
  - git\ 에 git.exe 가 없으면 PortableGit(git-for-windows 공식 GitHub 릴리스)을
    내려받아 자동 설치한다.
  - node\npm.cmd 로 Claude Code CLI 를 전역 설치한다. Node.js portable zip 배포판은
    자기 자신의 폴더를 기본 전역 설치 경로로 쓰므로, 별도 설정 없이 USB 내부
    (node\node_modules, node\claude.cmd)에 설치된다.
  - electron-app\ 의 npm 의존성을 설치한다.

  이미 설치된 항목은 건너뛴다(재실행해도 안전). -Force 로 강제 재설치 가능.

.PARAMETER Force
  이미 설치되어 있어도 Node.js/PortableGit을 다시 내려받아 덮어쓴다.
#>
[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$UsbRoot = Split-Path -Path $PSCommandPath -Parent

function Step { param([string]$Message) Write-Host "`n[CAELUS] $Message" -ForegroundColor Cyan }
function Ok { param([string]$Message) Write-Host "  -> $Message" -ForegroundColor Green }
function SkipStep { param([string]$Message) Write-Host "  -> $Message (건너뜀)" -ForegroundColor DarkGray }

function Get-DriveFileSystem {
    param([string]$Path)
    $qualifier = (Split-Path -Path $Path -Qualifier) -replace ':', ''
    try {
        return (Get-Volume -DriveLetter $qualifier -ErrorAction Stop).FileSystem
    } catch {
        return $null
    }
}

try {
    # 최신 TLS 사용 (구형 Windows/PowerShell 기본값이 TLS1.0이라 다운로드가 실패할 수 있음)
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    # 포터블 SSD/USB는 보통 exFAT로 출고되는데, exFAT/FAT32는 하드링크를 지원하지 않는다.
    # @anthropic-ai/claude-code 의 설치 스크립트가 바이너리를 하드링크로 배치하므로,
    # NTFS가 아니면 아래 3단계에서 "EISDIR ... link ..." 에러로 실패한다. 미리 경고한다.
    $fsType = Get-DriveFileSystem -Path $UsbRoot
    if ($fsType -and $fsType -ne "NTFS") {
        Write-Host "`n[경고] USB 드라이브 파일 시스템이 '$fsType' 입니다 (NTFS 아님)." -ForegroundColor Yellow
        Write-Host "        Claude Code CLI 설치 과정이 하드링크(NTFS 전용 기능)를 사용하므로," -ForegroundColor Yellow
        Write-Host "        exFAT/FAT32에서는 아래 3단계가 'EISDIR ... link ...' 에러로 실패할 수 있습니다." -ForegroundColor Yellow
        Write-Host "        가능하면 지금 중단하고 USB를 NTFS로 재포맷한 뒤 다시 실행하는 것을 권장합니다." -ForegroundColor Yellow
        Write-Host "        (탐색기에서 드라이브 우클릭 -> 포맷 -> 파일 시스템: NTFS)`n" -ForegroundColor Yellow
    }

    # --- 1. Node.js portable ---
    $nodeExe = Join-Path $UsbRoot "node\node.exe"
    if ((Test-Path $nodeExe) -and -not $Force) {
        SkipStep "Node.js 이미 설치됨: $nodeExe"
    } else {
        Step "Node.js LTS 최신 버전 확인 중..."
        $index = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json"
        $ltsVersion = ($index | Where-Object { $_.lts -ne $false } | Select-Object -First 1).version
        Ok "선택된 버전: $ltsVersion"

        $zipUrl = "https://nodejs.org/dist/$ltsVersion/node-$ltsVersion-win-x64.zip"
        $zipPath = Join-Path $env:TEMP "caelus-node.zip"
        $extractTmp = Join-Path $env:TEMP "caelus-node-extract"

        Step "Node.js 다운로드 중... ($zipUrl)"
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath

        Step "압축 해제 중..."
        if (Test-Path $extractTmp) { Remove-Item $extractTmp -Recurse -Force }
        Expand-Archive -Path $zipPath -DestinationPath $extractTmp -Force

        $extractedDir = Join-Path $extractTmp "node-$ltsVersion-win-x64"
        $nodeDir = Join-Path $UsbRoot "node"
        if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
        Move-Item -Path $extractedDir -Destination $nodeDir

        Remove-Item $zipPath -Force
        Remove-Item $extractTmp -Recurse -Force -ErrorAction SilentlyContinue
        Ok "Node.js 설치 완료: $nodeDir"
    }

    # --- 2. PortableGit ---
    $gitExe = Join-Path $UsbRoot "git\bin\git.exe"
    if ((Test-Path $gitExe) -and -not $Force) {
        SkipStep "PortableGit 이미 설치됨: $gitExe"
    } else {
        Step "PortableGit 최신 릴리스 확인 중..."
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/git-for-windows/git/releases/latest" `
            -Headers @{ "User-Agent" = "CAELUS-Setup" }
        $asset = $release.assets | Where-Object { $_.name -match '^PortableGit-.*-64-bit\.7z\.exe$' } | Select-Object -First 1
        if (-not $asset) {
            throw "PortableGit 릴리스 자산을 찾지 못했습니다."
        }
        Ok "선택된 릴리스: $($asset.name)"

        $installerPath = Join-Path $env:TEMP $asset.name
        Step "PortableGit 다운로드 중..."
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installerPath

        $gitDir = Join-Path $UsbRoot "git"
        if (Test-Path $gitDir) { Remove-Item $gitDir -Recurse -Force }

        Step "압축 해제(자동 설치) 중..."
        # PortableGit 설치 파일은 자체 압축 해제형 7z이다. -o<경로> -y 로 무인 설치한다.
        Start-Process -FilePath $installerPath -ArgumentList "-o`"$gitDir`"", "-y" -Wait

        Remove-Item $installerPath -Force
        Ok "PortableGit 설치 완료: $gitDir"
    }

    $npmCmd = Join-Path $UsbRoot "node\npm.cmd"

    # --- 3. Claude Code CLI ---
    Step "Claude Code CLI 설치 중 (node\npm.cmd install -g @anthropic-ai/claude-code)..."
    & $npmCmd install -g "@anthropic-ai/claude-code"
    if ($LASTEXITCODE -ne 0) {
        if ($fsType -and $fsType -ne "NTFS") {
            throw "Claude Code CLI 설치 실패 (exit $LASTEXITCODE) - USB가 NTFS가 아니라서(현재: $fsType) " + `
                  "하드링크 생성에 실패했을 가능성이 높습니다. USB를 NTFS로 재포맷한 뒤 다시 실행해주세요."
        }
        throw "Claude Code CLI 설치 실패 (exit $LASTEXITCODE)"
    }
    Ok "Claude Code CLI 설치 완료"

    # --- 4. Electron 앱 의존성 ---
    Step "Electron 앱 의존성 설치 중 (electron-app\npm install)..."
    Push-Location (Join-Path $UsbRoot "electron-app")
    try {
        & $npmCmd install
        if ($LASTEXITCODE -ne 0) { throw "npm install 실패 (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
    Ok "Electron 앱 의존성 설치 완료"

    Write-Host "`n[CAELUS] 모든 준비가 끝났습니다. start.bat 을 실행해보세요." -ForegroundColor Cyan
    exit 0
}
catch {
    Write-Host "`n[오류] 자동 설치 실패: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  node\README.md / git\README.md 의 수동 설치 방법으로 대체할 수 있습니다." -ForegroundColor Yellow
    exit 1
}

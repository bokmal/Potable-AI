<#
.SYNOPSIS
  볼륨 시리얼 번호(예: "1A2B3C4D")로 USB를 재탐색해 현재 드라이브 문자를 찾는다.
  필요 시 그 드라이브의 start.bat 을 바로 실행한다.

.DESCRIPTION
  USB를 다른 포트에 꽂으면 Windows가 드라이브 문자를 다시 배정할 수 있다(E: → F: 등).
  이 스크립트는 드라이브 문자 대신 볼륨 시리얼 번호로 장치를 식별하므로, 드라이브
  문자가 바뀌어도 정확한 USB를 다시 찾아낼 수 있다.

  install_trigger.ps1 이 작업 스케줄러에 등록하는 트리거 액션은 이 스크립트와 동일한
  탐색 알고리즘을 인라인 코드로 내장해 사용한다(등록 시점의 USB 파일 경로에 의존하지
  않기 위함). 이 파일은 수동 점검/디버깅 및 재사용 가능한 유틸리티로 제공된다.

.PARAMETER Serial
  대상 USB의 볼륨 시리얼 번호 (예: "1A2B3C4D". 대시(-)나 공백은 무시된다)

.PARAMETER RelativePath
  USB 루트 기준 CAELUS 폴더의 상대 경로 (예: "\PortableDev"). -RunStart 사용 시 필요.

.PARAMETER RunStart
  지정 시, 탐색된 드라이브의 "<RelativePath>\start.bat" 을 바로 실행한다.

.EXAMPLE
  .\find_usb_by_serial.ps1 -Serial 1A2B3C4D
  → 현재 드라이브 문자(예: "F:")만 출력한다.

.EXAMPLE
  .\find_usb_by_serial.ps1 -Serial 1A2B3C4D -RelativePath "\PortableDev" -RunStart
  → 드라이브를 찾아 start.bat 을 실행한다.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Serial,

    [string]$RelativePath = "",

    [switch]$RunStart
)

function Get-DriveLetterBySerial {
    param([string]$TargetSerial)

    $normalized = ($TargetSerial -replace '[^0-9A-Fa-f]', '').ToUpper()

    $disks = Get-CimInstance -ClassName Win32_LogicalDisk -ErrorAction SilentlyContinue
    foreach ($disk in $disks) {
        if (-not $disk.VolumeSerialNumber) { continue }
        $diskSerial = ($disk.VolumeSerialNumber -replace '[^0-9A-Fa-f]', '').ToUpper()
        if ($diskSerial -eq $normalized) {
            return $disk.DeviceID   # 예: "F:"
        }
    }
    return $null
}

$driveLetter = Get-DriveLetterBySerial -TargetSerial $Serial

if (-not $driveLetter) {
    # 이 시리얼을 가진 장치가 현재 없음 → 다른 USB의 이벤트이거나 아직 마운트 전.
    # 조용히 종료한다(오류로 취급하지 않음).
    exit 0
}

Write-Output $driveLetter

if ($RunStart) {
    if ([string]::IsNullOrEmpty($RelativePath)) {
        Write-Warning "RunStart 지정 시 -RelativePath 가 필요합니다."
        exit 1
    }

    $startBatPath = Join-Path -Path $driveLetter -ChildPath (Join-Path $RelativePath "start.bat")
    if (Test-Path -LiteralPath $startBatPath) {
        Start-Process -FilePath $startBatPath -WorkingDirectory (Split-Path -LiteralPath $startBatPath -Parent)
    } else {
        Write-Warning "start.bat 을 찾을 수 없습니다: $startBatPath"
        exit 1
    }
}

exit 0

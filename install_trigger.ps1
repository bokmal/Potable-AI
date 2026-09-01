<#
.SYNOPSIS
  이 PC의 작업 스케줄러에 "지정된 USB 삽입 시 CAELUS(start.bat) 자동 실행" 트리거를 등록한다.

.DESCRIPTION
  - 트리거 이벤트: Event ID 2003, 로그 "Microsoft-Windows-DriverFrameworks-UserMode/Operational"
    (USB 저장장치의 UserMode 드라이버 설치 완료 시점에 기록되는 이벤트)
  - 다른 USB가 꽂혀도 무반응하도록, 이 USB의 볼륨 시리얼 번호를 액션 스크립트 안에
    고정값으로 내장해 매번 실제로 꽂힌 장치와 대조한다.
  - 드라이브 문자 변동 대응: 트리거의 "액션"은 USB 위의 파일 경로(예: E:\PortableDev\...)를
    직접 참조하지 않는다. 작업 스케줄러 자체가 PC에 저장되므로, 액션에는 볼륨 시리얼로
    현재 드라이브 문자를 재탐색한 뒤 그 경로의 start.bat 을 실행하는 인라인 PowerShell
    코드를 -EncodedCommand 로 등록한다. find_usb_by_serial.ps1 은 동일한 탐색 로직을
    담은 독립 실행 가능한 유틸리티(수동 점검용)이며, 트리거 액션 자체는 여기에 파일로
    의존하지 않는다 — USB가 뽑혀 있거나 드라이브 문자가 바뀐 상태에서도 트리거 "등록"
    자체는 항상 유효해야 하기 때문이다.

.PARAMETER UsbRoot
  CAELUS 루트 폴더의 현재 전체 경로 (예: "E:\PortableDev")
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$UsbRoot
)

$ErrorActionPreference = "Stop"

function Write-Fail {
    param([string]$Message)
    Write-Host "[오류] $Message" -ForegroundColor Red
}

try {
    if (-not (Test-Path -LiteralPath $UsbRoot)) {
        Write-Fail "USB 경로를 찾을 수 없습니다: $UsbRoot"
        exit 1
    }

    $UsbRoot = (Resolve-Path -LiteralPath $UsbRoot).ProviderPath
    $driveLetter = (Split-Path -Path $UsbRoot -Qualifier)          # 예: "E:"
    $relativePath = $UsbRoot.Substring($driveLetter.Length)        # 예: "\PortableDev"
    if ([string]::IsNullOrEmpty($relativePath)) { $relativePath = "\" }

    $diskInfo = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='$driveLetter'" -ErrorAction Stop
    if (-not $diskInfo -or -not $diskInfo.VolumeSerialNumber) {
        Write-Fail "USB 볼륨 시리얼 번호를 읽을 수 없습니다."
        exit 1
    }
    $serial = $diskInfo.VolumeSerialNumber

    Write-Host "[정보] USB 드라이브       : $driveLetter"
    Write-Host "[정보] USB 볼륨 시리얼    : $serial"
    Write-Host "[정보] CAELUS 상대 경로   : $relativePath"

    # --- 트리거 액션에 내장할 인라인 스크립트 ---
    # find_usb_by_serial.ps1 과 동일한 알고리즘: 볼륨 시리얼로 현재 드라이브 문자를
    # 재탐색한 뒤 그 드라이브의 <relativePath>\start.bat 을 실행한다.
    # 일치하는 드라이브가 없으면(=다른 USB의 이벤트) 조용히 종료한다.
    $inlineScript = @"
`$serial = '$serial'
`$relativePath = '$relativePath'
`$disks = Get-CimInstance -ClassName Win32_LogicalDisk -ErrorAction SilentlyContinue
foreach (`$disk in `$disks) {
    if (`$disk.VolumeSerialNumber -eq `$serial) {
        `$startBat = Join-Path `$disk.DeviceID (Join-Path `$relativePath 'start.bat')
        if (Test-Path -LiteralPath `$startBat) {
            Start-Process -FilePath `$startBat -WorkingDirectory (Split-Path -LiteralPath `$startBat -Parent)
        }
        break
    }
}
"@

    $bytes = [System.Text.Encoding]::Unicode.GetBytes($inlineScript)
    $encodedCommand = [Convert]::ToBase64String($bytes)

    $taskName = "CAELUS_AutoRun_$serial"

    # 동일 USB 재설정 시나리오: 기존 등록이 있으면 정리 후 재등록
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "[정보] 기존 등록('$taskName')을 발견해 재등록합니다."
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }

    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand $encodedCommand"

    $cimTriggerClass = Get-CimClass -ClassName MSFT_TaskEventTrigger -Namespace "Root/Microsoft/Windows/TaskScheduler"
    $trigger = New-CimInstance -CimClass $cimTriggerClass -ClientOnly
    $trigger.Subscription = @"
<QueryList><Query Id="0" Path="Microsoft-Windows-DriverFrameworks-UserMode/Operational"><Select Path="Microsoft-Windows-DriverFrameworks-UserMode/Operational">*[System[(EventID=2003)]]</Select></Query></QueryList>
"@
    $trigger.Enabled = $true

    $settings = New-ScheduledTaskSettingsSet `
        -MultipleInstances IgnoreNew `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable

    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal `
        -Description "CAELUS USB(시리얼 $serial) 삽입 시 자동 실행" -Force | Out-Null

    Write-Host "[완료] 작업 스케줄러에 '$taskName' 등록됨."
    exit 0
}
catch {
    Write-Fail "트리거 등록 실패: $($_.Exception.Message)"
    Write-Host "  회사/공용 PC는 그룹 정책으로 작업 스케줄러 등록이 차단되어 있을 수 있습니다." -ForegroundColor Yellow
    Write-Host "  이 경우 start.bat 을 직접 더블클릭하는 수동 실행 방식을 이용해주세요." -ForegroundColor Yellow
    exit 1
}

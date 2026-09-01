<#
.SYNOPSIS
  이 PC에 "지정된 USB가 마운트되면 CAELUS(start.bat) 자동 실행" 설정을 등록한다.

.DESCRIPTION
  - 실행할 작업(예약 작업, Task Scheduler Task)과 그걸 깨우는 신호(WMI 이벤트
    구독)를 분리한 구조다.

  - 예약 작업(Task): "볼륨 시리얼로 드라이브를 재탐색해 start.bat을 실행"하는
    리졸버 스크립트(`%ProgramData%\CAELUS\resolve-and-launch-<시리얼>.ps1`,
    이 PC에 저장, USB 아님)를 실행한다. 이 작업 자체엔 트리거를 걸지 않는다
    — 아래 WMI 구독이 필요할 때 `schtasks /run` 으로 깨운다. (Task
    Scheduler에 등록되며 로그온 사용자 세션에서 실행되므로 CAELUS 창이
    화면에 정상적으로 보인다.)

  - WMI 영구 이벤트 구독(Filter + CommandLineEventConsumer + Binding):
    `Win32_VolumeChangeEvent`(EventType=2, 볼륨 마운트/도착 — Windows
    자동재생 팝업이 쓰는 것과 같은 신호)를 구독해, 어떤 볼륨이 마운트되든
    위 예약 작업을 `schtasks /run`으로 깨운다. 어떤 USB든 반응하지만,
    "이게 진짜 우리 USB인지"는 예약 작업이 실행하는 리졸버 스크립트가
    볼륨 시리얼로 다시 확인하므로 다른 USB를 꽂아도 무반응이다.

    ※ 원래는 Task Scheduler의 이벤트 트리거를 "Microsoft-Windows-
    DriverFrameworks-UserMode/Operational" 로그의 Event ID 2003(드라이버
    설치 완료)에 걸었었다. 하지만 이건 UMDF 기반 USB 장치의 "최초 드라이버
    설치" 시점에만 한 번 기록되는 이벤트라, UASP를 쓰는 포터블 SSD 등에서는
    아예 발생하지 않는 경우가 실사용 중 확인됐다(재삽입해도 로그가 안 남음).
    WMI의 볼륨 마운트 이벤트는 장치 종류(플래시 드라이브/포터블 SSD/외장
    HDD 등)와 무관하게 "드라이브 문자가 배정되는 순간"에 항상 발생하므로
    이 방식으로 바꿨다. 또한 WMI 영구 구독은 재부팅 후에도 유지된다.

  - 드라이브 문자 변동 대응: 리졸버 스크립트는 USB 위의 파일 경로를 직접
    참조하지 않는다. 볼륨 시리얼로 현재 드라이브 문자를 매번 재탐색한 뒤
    그 경로의 start.bat 을 실행한다. find_usb_by_serial.ps1 은 동일한 탐색
    로직을 담은 독립 실행 가능한 유틸리티(수동 점검용)다.

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

    # ===================================================================
    # 1) 예약 작업(Task) 등록 — 실제로 start.bat을 실행하는 부분
    # ===================================================================

    # find_usb_by_serial.ps1 과 동일한 알고리즘: 볼륨 시리얼로 현재 드라이브
    # 문자를 재탐색한 뒤 그 드라이브의 <relativePath>\start.bat 을 실행한다.
    # 일치하는 드라이브가 없으면(=우리 USB가 아니거나 이미 뽑힘) 조용히 종료.
    #
    # 이 로직을 예약 작업의 Arguments에 -EncodedCommand로 통째로(base64)
    # 욱여넣었더니, 그 문자열이 1000자를 넘어가면서 Task Scheduler의
    # Arguments 필드 길이 제한(오래된 Windows에서 ~261자 근처부터 조용히
    # 잘리는 것으로 알려진 문제)에 걸려, 실행 시점에 깨진 인코딩으로 실패
    # (종료 코드 1)하는 것이 실사용 중 확인됐다. 등록 시점엔 에러가 안 나고
    # "조용히" 잘리기 때문에 알아차리기 어려운 문제였다. 대신 이 로직을 이
    # PC의 ProgramData에 실제 .ps1 파일로 저장해두고, 예약 작업은 짧은
    # -File 인자로 그 경로만 가리키게 한다. USB가 아니라 이 PC에 저장하므로
    # USB가 없어도, 드라이브 문자가 바뀌어도 이 파일 자체는 항상 존재한다.
    $resolverDir = Join-Path $env:ProgramData "CAELUS"
    if (-not (Test-Path -LiteralPath $resolverDir)) {
        New-Item -ItemType Directory -Path $resolverDir -Force | Out-Null
    }
    $resolverPath = Join-Path $resolverDir "resolve-and-launch-$serial.ps1"

    $resolverScript = @"
`$serial = '$serial'
`$relativePath = '$relativePath'
`$disks = Get-CimInstance -ClassName Win32_LogicalDisk -ErrorAction SilentlyContinue
foreach (`$disk in `$disks) {
    if (`$disk.VolumeSerialNumber -eq `$serial) {
        `$startBat = Join-Path `$disk.DeviceID (Join-Path `$relativePath 'start.bat')
        if (Test-Path -LiteralPath `$startBat) {
            # -LiteralPath 와 -Parent 를 같이 쓰면 일부 PowerShell 버전에서
            # AmbiguousParameterSet 오류가 난다(실사용 중 확인됨). -Parent 는
            # 기본 동작이라 안 써도 된다.
            Start-Process -FilePath `$startBat -WorkingDirectory (Split-Path -LiteralPath `$startBat)
        }
        break
    }
}
"@
    Set-Content -LiteralPath $resolverPath -Value $resolverScript -Encoding UTF8 -Force

    $taskName = "CAELUS_AutoRun_$serial"

    # 동일 USB 재설정 시나리오: 기존 등록이 있으면 정리 후 재등록
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Write-Host "[정보] 기존 작업('$taskName')을 발견해 재등록합니다."
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }

    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$resolverPath`""

    $settings = New-ScheduledTaskSettingsSet `
        -MultipleInstances IgnoreNew `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable

    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

    # 이 작업 자체엔 트리거를 걸지 않는다 — 아래 WMI 구독이 필요할 때만
    # schtasks /run 으로 깨운다. (로그온 사용자 세션에서 실행되어야 CAELUS
    # 창이 화면에 보이므로, 이 작업 등록 방식 자체는 그대로 유지한다.)
    Register-ScheduledTask -TaskName $taskName -Action $action `
        -Settings $settings -Principal $principal `
        -Description "CAELUS USB(시리얼 $serial) 마운트 시 자동 실행 (WMI 구독이 깨움)" -Force | Out-Null

    Write-Host "[완료] 예약 작업 '$taskName' 등록됨."

    # ===================================================================
    # 2) WMI 영구 이벤트 구독 등록 — 볼륨 마운트를 감지해 위 작업을 깨움
    # ===================================================================

    $filterName = "CAELUS_VolArrival_Filter_$serial"
    $consumerName = "CAELUS_VolArrival_Consumer_$serial"

    Write-Host "[정보] WMI 볼륨 마운트 구독 등록 중..."

    # 동일 USB 재설정 시나리오: 기존 바인딩/필터/컨슈머 정리 (참조가 있으면
    # 삭제가 실패하므로 바인딩부터 지운다)
    Get-WmiObject -Namespace root\subscription -Class __FilterToConsumerBinding -ErrorAction SilentlyContinue |
        Where-Object { $_.Filter -match [regex]::Escape($filterName) -or $_.Consumer -match [regex]::Escape($consumerName) } |
        ForEach-Object { $_.Delete() }

    Get-WmiObject -Namespace root\subscription -Class __EventFilter -Filter "Name='$filterName'" -ErrorAction SilentlyContinue |
        ForEach-Object { $_.Delete() }

    Get-WmiObject -Namespace root\subscription -Class CommandLineEventConsumer -Filter "Name='$consumerName'" -ErrorAction SilentlyContinue |
        ForEach-Object { $_.Delete() }

    # __FilterToConsumerBinding의 Filter/Consumer는 참조(REF) 타입 프로퍼티다.
    # New-CimInstance로 이 셋을 만들면 바인딩 단계에서 "Consumer 속성과 형식이
    # 일치하지 않습니다" 오류가 난다(REF 프로퍼티를 문자열/객체 어느 쪽으로
    # 넘겨도 실패하는, 잘 알려진 New-CimInstance의 한계). 대신 예전부터 이런
    # WMI 영구 구독을 만들 때 표준으로 쓰이는 Set-WmiInstance(레거시 WMI
    # cmdlet, ManagementObject를 반환하며 참조 프로퍼티를 자동으로 올바르게
    # 처리한다)를 쓴다. Windows PowerShell(5.1)에 기본 포함돼 있어 별도
    # 설치가 필요 없다.
    $filter = Set-WmiInstance -Namespace root\subscription -Class __EventFilter -Arguments @{
        Name           = $filterName
        EventNamespace = 'root\cimv2'
        QueryLanguage  = 'WQL'
        # EventType 2 = 볼륨 도착(마운트). 장치 종류(USB 플래시/포터블 SSD/
        # 외장 HDD 등)와 무관하게 드라이브 문자가 배정되는 순간 항상 발생한다.
        Query          = 'SELECT * FROM Win32_VolumeChangeEvent WHERE EventType = 2'
    }

    $consumer = Set-WmiInstance -Namespace root\subscription -Class CommandLineEventConsumer -Arguments @{
        Name                = $consumerName
        # "우리 USB인지"는 여기서 판단하지 않는다 — 위 예약 작업이 실행하는
        # 리졸버 스크립트가 볼륨 시리얼로 다시 확인하므로, 여기서는 그냥
        # 깨우기만 한다. 일치하지 않으면 예약 작업이 몇 ms 안에 조용히 끝난다.
        CommandLineTemplate = "schtasks.exe /run /tn `"$taskName`""
    }

    Set-WmiInstance -Namespace root\subscription -Class __FilterToConsumerBinding -Arguments @{
        Filter   = $filter
        Consumer = $consumer
    } | Out-Null

    Write-Host "[완료] WMI 구독 등록됨 ('$filterName' → '$consumerName')."
    Write-Host "[완료] 이제 이 PC에 이 USB를 꽂으면(다른 포트로 옮겨도) CAELUS가 자동 실행됩니다."
    exit 0
}
catch {
    Write-Fail "트리거 등록 실패: $($_.Exception.Message)"
    Write-Host "  회사/공용 PC는 그룹 정책으로 작업 스케줄러/WMI 등록이 차단되어 있을 수 있습니다." -ForegroundColor Yellow
    Write-Host "  이 경우 start.bat 을 직접 더블클릭하는 수동 실행 방식을 이용해주세요." -ForegroundColor Yellow
    exit 1
}

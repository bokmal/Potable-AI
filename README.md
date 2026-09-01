# CAELUS — USB 포터블 AI 작업환경

USB 하나로 어느 Windows PC에서든 비설치로 실행되는 개인 AI 작업환경.
화면(UI)은 커스텀 프로그램 **CAELUS**(JARVIS 스타일 Electron 앱)이고,
실제 두뇌는 **Claude Code CLI**가 담당한다.

> 설계 배경/근거는 [`docs/CAELUS_DESIGN.md`](docs/CAELUS_DESIGN.md) (원본 설계 문서)를 참고.

```
[Electron UI: CAELUS]  ← 사용자가 보는 화면
        ↓ child_process(--print 모드)
[Claude Code CLI]      ← 실제 처리 엔진
        ↓
[Claude API]
```

## 폴더 구조

```
Potable-AI\
├── setup.bat               최초 1회, 관리자 권한, PC에 자동실행 트리거 등록
├── install_trigger.ps1     작업 스케줄러 등록 스크립트
├── find_usb_by_serial.ps1  볼륨 시리얼로 USB 재탐색 (드라이브 문자 변동 대응)
├── install_runtime.bat      런타임(Node/Git/CLI/Electron 의존성) 자동 설치
├── install_runtime.ps1      〃 실제 로직
├── start.bat                CAELUS 진입점 (HOME 리다이렉트 포함)
├── node\                    Node.js portable (install_runtime.bat 또는 node/README.md 참고)
├── git\                     PortableGit (install_runtime.bat 또는 git/README.md 참고)
├── electron-app\            CAELUS UI 소스 (electron-app/README.md 참고)
├── claude-home\              HOME 리다이렉트 대상 — Claude 인증/세션, 작업 기록
├── projects\                 실제 작업 파일
└── docs\CAELUS_DESIGN.md     원본 설계 문서 사본
```

## USB 준비 (최초 1회, 인터넷 필요)

1. 이 저장소 전체를 USB로 복사한다 (예: `E:\PortableDev\`).
2. `install_runtime.bat`을 더블클릭한다. Node.js portable, PortableGit, Claude
   Code CLI, Electron 의존성을 전부 자동으로 내려받아 설치한다 (수 분 소요).
   이미 설치된 항목은 건너뛰므로 재실행해도 안전하다.
   - 자동 설치가 막히는 환경(사내 프록시/방화벽 등)이라면 `node/README.md`,
     `git/README.md`의 수동 설치 절차를 대신 따른다.

## 사용법

### 수동 실행 (모든 PC에서 항상 동작)
USB의 `start.bat`을 더블클릭한다.

### 특정 PC에서 자동 실행 등록 (선택)
`setup.bat`을 더블클릭한다 (관리자 권한 UAC 승인 1회 필요). 이후 그 PC에서는
이 USB를 꽂으면 `start.bat`이 자동으로 실행된다.

- 이 등록은 **USB가 아니라 그 PC**(작업 스케줄러 + WMI)에 저장된다. 다른
  PC에서도 자동 실행을 원하면 그 PC에서 `setup.bat`을 다시 실행해야 한다.
- 감지 방식: 예약 작업 자체엔 트리거를 안 걸고, WMI 영구 이벤트 구독이
  "어떤 볼륨이든 마운트되면"(`Win32_VolumeChangeEvent`, Windows 자동재생
  팝업이 쓰는 것과 같은 신호) 그 예약 작업을 깨우는 구조다. 볼륨 시리얼
  번호로 "이 USB"인지는 깨어난 예약 작업이 스스로 확인하므로, 다른 USB를
  꽂아도 무반응이다.
  - 처음엔 "USB 드라이버 설치 완료" 이벤트(Event ID 2003)를 트리거로
    썼는데, 이건 UMDF 기반 구형 USB 플래시 드라이브에서만 발생하고
    UASP를 쓰는 포터블 SSD 등에서는 아예 안 남는 것이 실사용 중 확인돼
    지금 방식으로 바꿨다.
- USB를 다른 포트에 꽂아 드라이브 문자가 바뀌어도(`E:` → `F:` 등) 예약
  작업은 실행 시점에 볼륨 시리얼로 실제 드라이브 문자를 재탐색해 정상
  동작한다 (`install_trigger.ps1`, `find_usb_by_serial.ps1` 참고).
- 회사/공용 PC는 그룹 정책으로 작업 스케줄러/WMI 등록이 차단되어 있을 수
  있다. 이 경우 `setup.bat`이 실패 메시지를 띄우고, `start.bat` 수동 실행
  으로 안내한다.

### 로그인 세션 이동
`start.bat`이 `CAELUS_HOME`을 `claude-home\`으로 설정해둔다. Electron
앱은 이 값을 Claude Code CLI를 실행하는 **자식 프로세스에서만**
`HOME`/`USERPROFILE`로 주입한다(`claudeBridge.js`) — Electron 프로세스
자체의 `HOME`/`USERPROFILE`은 건드리지 않는다. (처음에는 세션 전체의
`HOME`/`USERPROFILE`을 통째로 재설정했으나, 그렇게 하면 Electron 내부의
Chromium이 프로필 경로 계산 중 조용히 비정상 종료하는 문제가 실사용
테스트에서 확인되어 이렇게 바꿨다.) 시스템 환경변수는 건드리지 않으므로
PC 재부팅 시 흔적이 남지 않는다. PC A에서 최초 1회 로그인하면 세션이
USB에 저장되고, 이후 다른 PC에 꽂아도 재로그인 없이 이어서 작업할 수
있다(세션 만료 시에는 재로그인 필요).

## UI 개요

JARVIS 스타일 다크 네이비 배경에 네온 글로우 원형 인디케이터.

| 상태 | 색상 | 의미 |
|---|---|---|
| 대기 | `#4fd1e0` 청록 | 대기 중 |
| 입력 처리 중 | `#f2c34d` 황색 | 명령 전송 후 CLI 응답 대기 |
| 응답 완료 | `#6fd68a` 초록 | CLI 응답 수신 |

좌측 사이드바에 작업 기록(TASK) 목록, 중앙에 상태 인디케이터와 대화 영역,
하단에 명령 입력바. 자세한 구현은 [`electron-app/README.md`](electron-app/README.md).

## 데이터 모델

`DEVICE(PC+작업스케줄러) — SESSION(USB 볼륨시리얼 귀속) — TASK — LOG`
4단계 ERD. SESSION/TASK/LOG는 `claude-home\data\caelus-store.json`에
JSON으로 저장된다 (`electron-app/src/main/store.js`). 자세한 내용은
[`docs/CAELUS_DESIGN.md`](docs/CAELUS_DESIGN.md) 5장 참고.

## 알려진 제약 / 검증 필요 항목

- [x] **(실제 Windows PC에서 종단간 검증 완료)** USB → `start.bat` → CAELUS
      (Electron) → `claude --print` 자식 프로세스 → 응답 수신 → 화면 렌더링 →
      작업 기록 저장까지, 실제 하드웨어에서 전체 플로우가 동작하는 것을 확인함.
      로그인 세션도 `claude-home\.claude`에 저장되어 USB에 귀속된다.
- [x] **(실제 확인됨, 수정함)** `start.bat`이 세션 전체의 `HOME`/`USERPROFILE`을
      재설정하던 초기 구현은 Electron(Chromium)이 내부 프로필 경로 계산 중
      조용히 비정상 종료(창이 아예 안 뜨고 즉시 종료)하는 문제가 있었다.
      Electron 프로세스 자체는 건드리지 않고, Claude Code CLI 자식 프로세스
      에만 `CAELUS_HOME`을 `HOME`/`USERPROFILE`로 주입하도록 구조를 바꿔
      해결했다 (`start.bat`, `claudeBridge.js`, `store.js` 참고).
- [x] **(실제 확인됨, 수정함)** 같은 이유로 `git\bin`/`git\cmd`를 세션 PATH에
      통째로 추가하던 것도 Electron이 종료 코드 -1073741819(0xC0000005,
      액세스 위반)로 강제종료되는 문제가 있었다 — PortableGit의 DLL들이
      Chromium이 쓰는 것과 이름이 겹쳐 충돌한 것으로 추정된다. `CAELUS_HOME`과
      동일한 패턴으로, Electron 프로세스 PATH에는 넣지 않고 `CAELUS_GIT_BIN`
      변수로 전달해 Claude Code CLI 자식 프로세스의 PATH에만 추가하도록
      바꿔 해결했다.
- [x] **(수정함)** USB가 예고 없이 뽑히는 상황(포터블 매체 특성상 상시 위험)에서
      작업 기록(`caelus-store.json`)이 쓰는 도중 깨지거나, 깨진 걸 다음에
      조용히 버리고 새로 시작해버려 기록이 흔적 없이 사라지는 문제가 있었다.
      임시 파일 + rename으로 원자적 쓰기를 하고, 손상된 파일은 버리지 않고
      `.corrupted-<timestamp>.bak`으로 백업하도록 고쳤다 (`store.js`).
      다만 Claude Code CLI 자신의 세션/인증 파일(`claude-home\.claude\*`)은
      CLI 자체가 관리하는 영역이라 이 저장소 코드로는 원자성을 보장할 수
      없다. 대신 로그인 토큰(`.credentials.json`)만은 CAELUS가 켜질 때마다
      정상 상태면 백업(`.backup`)해두고, 다음 실행 때 손상된 게 발견되면
      자동으로 그 백업에서 복구한다 (`credentialsGuard.js`) — 완전한
      원자성은 아니지만 재로그인까지 가는 상황을 대부분 피할 수 있다.
- [x] **(대응함, 완전 방지는 불가)** 앱이 막 켜지는 중(Electron이 자신의 JS
      파일을 USB에서 읽는 도중)에 USB가 뽑히면 그 시점엔 아직 JS 코드가
      실행되기 전이라 앱 내부에서 막을 수 없다. 대신 `start.bat`이 비정상
      종료를 감지하면 2초 후 자동으로 한 번 더 재시도하고(일시적 접촉
      불량 대응), 그래도 실패하면 USB 연결 상태를 확인하라는 구체적 안내와
      함께 로그를 남긴다.
- [x] **(수정함)** 자동실행 트리거가 걸린 PC에서, 기존 CAELUS 인스턴스가
      완전히 종료되지 않은 채로 USB를 재삽입하면 창이 중복 실행되고, 두
      프로세스가 같은 USB 저장소 파일에 동시에 써서 원자적 쓰기로도 못
      막는 경합이 생길 수 있었다. Electron의 `requestSingleInstanceLock`으로
      같은 PC에서의 중복 실행을 막았다(락은 USB가 아니라 그 PC의 실제
      Windows 프로필에 저장되므로, 여러 PC에서 각자 쓰는 정상적인 사용에는
      영향 없다) (`main.js`).
- [x] **(실제 Windows PC에서 종단간 검증 완료)** `setup.bat` 자동실행 등록 →
      USB 재삽입 → CAELUS 자동 실행까지 사람 개입 없이 동작하는 것을 실제
      하드웨어에서 확인함. 여기까지 오는 데 네 가지 문제를 실사용 중
      순서대로 발견해 고쳤다:
      1. 원래 쓰던 트리거 이벤트(Event ID 2003, "USB 드라이버 설치 완료")가
         UASP 기반 포터블 SSD에서는 아예 발생하지 않음 → 장치 종류와 무관한
         볼륨 마운트 이벤트(`Win32_VolumeChangeEvent`, WMI 영구 구독)로 교체.
      2. `New-CimInstance`로 WMI 필터/컨슈머를 바인딩할 때 참조(REF) 타입
         프로퍼티 처리가 실패함 → 레거시 `Set-WmiInstance`로 교체.
      3. 예약 작업 인자에 로직을 `-EncodedCommand`(base64)로 통째로 넣었더니
         Task Scheduler의 인자 길이 제한에 걸려 조용히 잘림(등록은 성공,
         실행 시 실패) → 이 PC의 `%ProgramData%\CAELUS\`에 실제 .ps1 파일로
         저장하고 짧은 `-File` 인자로 가리키는 방식으로 교체.
      4. `Split-Path -LiteralPath ... -Parent` 조합이 매개변수 충돌 오류를 냄
         (그런데 예약 작업 종료 코드는 0으로 나와 원인 파악이 까다로웠다)
         → `-Parent`는 기본 동작이라 제거.
      (`install_trigger.ps1`, `find_usb_by_serial.ps1`) **이 수정들 이후
      `setup.bat`을 다시 실행해야 기존 PC에도 반영된다** — 예전에 이미
      `setup.bat`을 돌린 PC가 있다면 한 번 더 실행해서 재등록해야 한다.
- [ ] 회사/공용 PC 그룹정책으로 작업 스케줄러 등록이 차단되는 경우의
      수동 실행 폴백은 구현되어 있으나, 실제 그런 환경에서의 검증 필요.
- [ ] 안티바이러스가 포터블 `node.exe`를 오탐할 수 있음 → 화이트리스트 등록 안내 필요.
- [ ] Electron 앱 용량(특히 `node_modules`)이 USB 용량 대비 부담되는지 확인 필요.
- [ ] 음성 인식(STT)은 아직 미구현 — 현재는 텍스트 명령 입력만 지원.
- [ ] `claudeBridge.js`가 사용하는 CLI 인자(`--print`)는 설치된 Claude Code CLI
      버전에 맞춰 검증 필요 (버전에 따라 세션 재개용 플래그 등이 다를 수 있음).
- [ ] `install_runtime.ps1`은 nodejs.org / GitHub API(github.com)에 직접 접속해야
      한다 — 사내 프록시·방화벽 환경에서는 실패할 수 있으며, 이 경우 각 폴더의
      README 수동 설치 절차로 대체해야 한다.
- [x] **(실제 확인됨)** USB가 exFAT/FAT32로 포맷돼 있으면 `@anthropic-ai/claude-code`
      설치 중 `EISDIR ... link ...` 에러로 실패한다 — 그 설치 스크립트가 바이너리를
      하드링크로 배치하는데, exFAT/FAT32는 하드링크를 지원하지 않기 때문이다.
      **USB를 NTFS로 재포맷**해야 한다 (이 프로젝트는 Windows 전용이라 NTFS로 바꿔도
      무방하다). `install_runtime.ps1`이 설치 전 파일 시스템을 확인해 경고를 띄운다.

이 저장소의 모든 스크립트는 Windows 전용(batch/PowerShell)이며, 이 개발
환경(Linux)에서는 실제 실행 테스트를 하지 못했다. Windows PC에서 최초
실행 시 위 검증 항목들을 함께 확인할 것.

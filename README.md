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
├── start.bat                CAELUS 진입점 (HOME 리다이렉트 포함)
├── node\                    Node.js portable (직접 다운로드, node/README.md 참고)
├── git\                     PortableGit (직접 다운로드, git/README.md 참고)
├── electron-app\            CAELUS UI 소스 (electron-app/README.md 참고)
├── claude-home\              HOME 리다이렉트 대상 — Claude 인증/세션, 작업 기록
├── projects\                 실제 작업 파일
└── docs\CAELUS_DESIGN.md     원본 설계 문서 사본
```

## USB 준비 (최초 1회, 인터넷 필요)

1. 이 저장소 전체를 USB로 복사한다 (예: `E:\PortableDev\`).
2. `node/README.md`, `git/README.md`의 안내대로 Node.js portable, PortableGit을 받아
   각 폴더에 채워 넣는다.
3. Claude Code CLI를 설치한다:
   ```
   node\npm.cmd install -g @anthropic-ai/claude-code
   ```
4. Electron 앱 의존성을 설치한다:
   ```
   cd electron-app
   ..\node\npm.cmd install
   ```

## 사용법

### 수동 실행 (모든 PC에서 항상 동작)
USB의 `start.bat`을 더블클릭한다.

### 특정 PC에서 자동 실행 등록 (선택)
`setup.bat`을 더블클릭한다 (관리자 권한 UAC 승인 1회 필요). 이후 그 PC에서는
이 USB를 꽂으면 `start.bat`이 자동으로 실행된다.

- 이 등록은 **USB가 아니라 그 PC의 작업 스케줄러**에 저장된다. 다른 PC에서도
  자동 실행을 원하면 그 PC에서 `setup.bat`을 다시 실행해야 한다.
- 볼륨 시리얼 번호로 "이 USB"인지 식별하므로, 다른 USB를 꽂아도 무반응이다.
- USB를 다른 포트에 꽂아 드라이브 문자가 바뀌어도(`E:` → `F:` 등) 트리거는
  실행 시점에 볼륨 시리얼로 실제 드라이브 문자를 재탐색해 정상 동작한다
  (`install_trigger.ps1`, `find_usb_by_serial.ps1` 참고).
- 회사/공용 PC는 그룹 정책으로 작업 스케줄러 등록이 차단되어 있을 수 있다.
  이 경우 `setup.bat`이 실패 메시지를 띄우고, `start.bat` 수동 실행으로
  안내한다.

### 로그인 세션 이동
`start.bat`이 세션 한정으로 `HOME`/`USERPROFILE`을 `claude-home\`으로
재설정한 뒤 CLI를 실행한다. 시스템 환경변수는 건드리지 않으므로 PC
재부팅 시 흔적이 남지 않는다. PC A에서 최초 1회 로그인하면 세션이
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

- [ ] HOME 리다이렉트가 Claude Code CLI 인증 로직(하드웨어 지문 체크 등)과
      충돌하지 않는지 실제 Windows 환경 테스트 필요.
- [ ] 회사/공용 PC 그룹정책으로 작업 스케줄러 등록이 차단되는 경우의
      수동 실행 폴백은 구현되어 있으나, 실제 그런 환경에서의 검증 필요.
- [ ] 안티바이러스가 포터블 `node.exe`를 오탐할 수 있음 → 화이트리스트 등록 안내 필요.
- [ ] Electron 앱 용량(특히 `node_modules`)이 USB 용량 대비 부담되는지 확인 필요.
- [ ] 음성 인식(STT)은 아직 미구현 — 현재는 텍스트 명령 입력만 지원.
- [ ] `claudeBridge.js`가 사용하는 CLI 인자(`--print`)는 설치된 Claude Code CLI
      버전에 맞춰 검증 필요 (버전에 따라 세션 재개용 플래그 등이 다를 수 있음).

이 저장소의 모든 스크립트는 Windows 전용(batch/PowerShell)이며, 이 개발
환경(Linux)에서는 실제 실행 테스트를 하지 못했다. Windows PC에서 최초
실행 시 위 검증 항목들을 함께 확인할 것.

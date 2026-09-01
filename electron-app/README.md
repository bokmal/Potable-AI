# CAELUS (Electron UI)

Claude Code CLI를 두뇌로 쓰는 CAELUS의 프론트엔드. UI는 입력을 받아 CLI에
전달하고 응답을 렌더링만 하며, 실제 처리(코드 실행/파일 조작 등)는 전부
Claude Code CLI가 담당한다.

## 구조

```
src/
├── main/
│   ├── main.js             BrowserWindow 생성, 단일 인스턴스 락, IPC 핸들러
│   ├── claudeBridge.js      Claude Code CLI child_process 래퍼 (--print 모드)
│   ├── store.js             작업 기록(SESSION/TASK/LOG) JSON 저장소 (원자적 쓰기)
│   ├── credentialsGuard.js  CLI 로그인 토큰 백업/자동 복구
│   └── preload.js           contextBridge로 렌더러에 안전하게 API 노출
└── renderer/
    ├── index.html        사이드바 + 원형 상태 인디케이터 + 대화창 + 입력바
    ├── styles.css         JARVIS 스타일 네온 팔레트/글로우 이펙트
    └── renderer.js        상태 전이, 대화 렌더링, IPC 호출
```

## 최초 1회 설정 (인터넷 필요)

```
cd electron-app
npm install
```

USB 내부에 `node_modules`가 생성된다. 이후에는 오프라인 환경(다른 PC)에서도
`start.bat`이 그대로 `node_modules\.bin\electron.cmd`를 실행한다.

## 개발 중 직접 실행

```
npm start
```

## Claude Code CLI 연동 방식

- `claudeBridge.js`가 `claude --print`를 `child_process.spawn`으로 호출한다.
  사용자 프롬프트는 명령줄 인자가 아니라 **stdin으로 전달**한다 — Windows에서
  이 프로세스는 shell:true로 cmd.exe를 거쳐 실행되는데, 사용자가 입력한
  문장에 괄호/`&`/`%`/`^` 같은 cmd.exe 특수문자가 섞이면 명령줄 자체가 깨져서
  프롬프트가 잘리거나 다른 인자와 뒤섞이는 문제가 실사용 중 확인됐다. stdin은
  셸 파싱을 거치지 않으므로 사용자가 뭘 입력하든 안전하다.
- CLI 실행 파일 경로는 기본적으로 PATH의 `claude`를 사용하며,
  `CAELUS_CLAUDE_CMD` 환경변수로 재정의할 수 있다.
- `start.bat`이 `PATH`에 portable `node`/`git`을 추가하고 `CAELUS_HOME`
  환경변수를 `claude-home`으로 설정해둔 상태에서 이 앱이 실행된다.
  `claudeBridge.js`는 CLI를 spawn할 때 **그 자식 프로세스에만**
  `HOME`/`USERPROFILE`을 `CAELUS_HOME`으로 덮어써서, CLI의 인증/세션
  저장 위치를 USB로 고정한다.
  - **주의**: Electron 프로세스 자체의 `HOME`/`USERPROFILE`은 절대 건드리지
    않는다. 예전에는 `start.bat`이 세션 전체의 `HOME`/`USERPROFILE`을
    재설정했는데, 그러면 Electron 내부 Chromium이 프로필 경로 계산 중
    조용히 비정상 종료(창이 아예 안 뜸)하는 문제가 실사용 테스트에서
    확인됐다. `store.js`도 같은 이유로 `CAELUS_HOME`을 최우선으로 읽는다.

## 대화 / 코딩 모드

Claude Code CLI의 기본 시스템 프롬프트는 "파일을 함부로 안 건드리는 신중한
코딩 에이전트"로 튜닝돼 있어서, `--print` 모드로 일반 잡담이나 산수 질문을
던져도 "무엇을 하시려는 건가요?" 하고 자꾸 되묻는 경향이 있다(실사용 중
확인됨). 명령 입력바 위 토글로 두 모드를 전환할 수 있다.

- **대화**(기본값) — `claudeBridge.js`가 `--append-system-prompt`로 "일반
  채팅처럼 자연스럽게 답하라"는 지시를 얹어서 호출한다.
- **코딩** — 아무것도 얹지 않고 CLI 기본 동작(신중한 에이전트) 그대로
  호출한다. `projects\` 안의 실제 코드 작업을 시킬 때는 이 신중함이
  필요하므로 이쪽을 쓴다.

선택한 모드는 `localStorage`에 기억되고(브라우저별 편의 저장, 작업 기록
자체에는 영향 없음), 각 작업의 모드는 사이드바 기록에도 표시된다.

## 상태 3종 (설계 문서 6장)

| 상태 | 색상 | 트리거 |
|---|---|---|
| `idle` | 청록 `#4fd1e0` | 대기 중 |
| `listening` | 황색 `#f2c34d` | 명령 전송 후 CLI 응답 대기 중 |
| `response` | 초록 `#6fd68a` | CLI 응답 수신 완료 |
| `error` | 적색 `#e05c5c` | CLI 실행 실패/비정상 종료 |

## USB 안전성 (예고 없이 뽑히는 것에 대한 대비)

USB는 언제든 예고 없이 뽑힐 수 있는 매체라는 전제로 아래 세 가지를 넣어뒀다.
자세한 배경은 `README.md`의 "알려진 제약" 참고.

1. **작업 기록 손상 방지** — `store.js`가 파일을 직접 덮어쓰지 않고 임시
   파일 + rename으로 원자적으로 쓴다. 혹시 손상된 파일을 만나도 조용히
   버리지 않고 `.corrupted-<timestamp>.bak`으로 백업한다.
2. **로그인 세션 손상 대비** — `credentialsGuard.js`가 매 실행마다 CLI의
   로그인 토큰이 정상이면 백업하고, 손상돼 있으면 백업에서 자동 복구한다.
3. **중복 실행 방지** — `main.js`가 `app.requestSingleInstanceLock()`으로
   같은 PC에서 CAELUS가 두 번 뜨는 것을 막는다(자동실행 트리거가 걸린
   PC에서, 죽지 않은 이전 창이 있는데 USB가 재삽입되는 경우 대비). 이
   락은 USB가 아니라 그 PC의 실제 Windows 프로필에 저장되므로, 여러
   PC에서 각자 CAELUS를 쓰는 정상적인 사용에는 영향을 주지 않는다.

앱이 완전히 로딩되기 전(Electron이 자신의 JS 파일을 USB에서 읽는 도중)에
USB가 뽑히는 경우는 그 시점에 아직 JS 코드가 안 떠 있어 앱 내부에서 막을
수 없다 — `start.bat`이 비정상 종료를 감지해 한 번 자동 재시도하고, 그래도
실패하면 안내 메시지를 띄우는 것으로 대응한다.

## 알려진 제약

- 음성 인식(STT)은 아직 구현되어 있지 않다. 텍스트 명령 입력바만 동작하며,
  `listening` 상태는 "명령 전송 후 CLI 처리 대기"를 의미한다.
- Claude Code CLI의 정확한 CLI 플래그(세션 재개, `--append-system-prompt`
  등)는 설치된 버전에 따라 달라질 수 있으므로, 버전 업데이트 시
  `claudeBridge.js`의 인자 구성을 다시 확인해야 한다.

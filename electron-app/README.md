# CAELUS (Electron UI)

Claude Code CLI를 두뇌로 쓰는 CAELUS의 프론트엔드. UI는 입력을 받아 CLI에
전달하고 응답을 렌더링만 하며, 실제 처리(코드 실행/파일 조작 등)는 전부
Claude Code CLI가 담당한다.

## 구조

```
src/
├── main/
│   ├── main.js          BrowserWindow 생성, IPC 핸들러
│   ├── claudeBridge.js   Claude Code CLI child_process 래퍼 (--print 모드)
│   ├── store.js          작업 기록(SESSION/TASK/LOG) JSON 저장소
│   └── preload.js        contextBridge로 렌더러에 안전하게 API 노출
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

- `claudeBridge.js`가 `claude --print "<입력>"`을 `child_process.spawn`으로 호출한다.
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

## 상태 3종 (설계 문서 6장)

| 상태 | 색상 | 트리거 |
|---|---|---|
| `idle` | 청록 `#4fd1e0` | 대기 중 |
| `listening` | 황색 `#f2c34d` | 명령 전송 후 CLI 응답 대기 중 |
| `response` | 초록 `#6fd68a` | CLI 응답 수신 완료 |
| `error` | 적색 `#e05c5c` | CLI 실행 실패/비정상 종료 |

## 알려진 제약

- 음성 인식(STT)은 아직 구현되어 있지 않다. 텍스트 명령 입력바만 동작하며,
  `listening` 상태는 "명령 전송 후 CLI 처리 대기"를 의미한다.
- Claude Code CLI의 정확한 CLI 플래그(세션 재개 등)는 설치된 버전에 따라
  달라질 수 있으므로, 버전 업데이트 시 `claudeBridge.js`의 인자 구성을
  다시 확인해야 한다.

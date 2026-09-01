# node/ (Node.js portable)

## 자동 설치 (권장)
저장소 루트의 `install_runtime.bat`을 더블클릭하면 이 폴더를 포함해
필요한 런타임을 전부 자동으로 받아 설치한다. 아래는 수동으로 하고 싶을
때의 절차다.

## 수동 설치

이 폴더에 Windows용 Node.js "portable" 배포판을 압축 해제해서 넣는다.

1. https://nodejs.org/en/download 에서 "Windows Binary (.zip)" 를 받는다
   (설치형 .msi가 아니라 압축 파일이어야 한다).
2. 압축을 풀어 이 폴더(`node/`) 바로 아래에 `node.exe`가 오도록 배치한다.

```
node\
├── node.exe
├── npm.cmd
├── npx.cmd
└── ...
```

3. Claude Code CLI 설치:

```
node\npm.cmd install -g @anthropic-ai/claude-code
```

Node.js의 Windows zip 배포판은 별도 설정이 없으면 `node.exe`가 있는 폴더
자체를 npm 전역 설치 경로로 사용한다(레지스트리/시스템 설정에 의존하지
않음). 따라서 위 명령을 실행하면 `node\node_modules`, `node\claude.cmd`에
설치되어 USB 안에 자체적으로 담긴다 — `USERPROFILE`을 어떻게 설정했는지와
무관하다.

> 이 폴더의 실제 바이너리는 저장소에 커밋하지 않는다 (`.gitignore` 참고).
> 라이선스·용량 문제로 각자 다운로드해서 채워 넣는 방식으로 둔다.

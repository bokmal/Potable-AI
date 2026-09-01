# node/ (Node.js portable)

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

전역 설치 위치는 `start.bat`이 설정하는 `USERPROFILE`(=`claude-home`) 기준으로
결정되므로, `start.bat`을 통해 실행한 셸에서 위 명령을 실행해야 CLI가
USB 내부에 설치된다.

> 이 폴더의 실제 바이너리는 저장소에 커밋하지 않는다 (`.gitignore` 참고).
> 라이선스·용량 문제로 각자 다운로드해서 채워 넣는 방식으로 둔다.

# claude-home/

`start.bat`이 이 폴더를 세션 한정 `HOME`/`USERPROFILE`로 지정한다.

Claude Code CLI의 인증/세션 정보(`.claude/`)와 CAELUS의 작업 기록
(`data/caelus-store.json`, 설계 문서 5장 SESSION/TASK/LOG)이 여기에
저장된다. PC를 옮겨도 이 폴더가 그대로 USB에 있으므로 재로그인 없이
이어서 작업할 수 있다.

이 폴더의 내용물(인증 토큰 포함)은 저장소에 커밋하지 않는다
(`.gitignore` 참고). USB에는 실제로 존재해야 하는 폴더이므로
`.gitkeep`으로 빈 폴더 구조만 유지한다.

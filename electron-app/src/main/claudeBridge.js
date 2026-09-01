const { spawn } = require('child_process');

// Claude Code CLI의 기본 시스템 프롬프트는 "파일을 함부로 안 건드리는 신중한
// 코딩 에이전트"로 튜닝돼 있다. 그래서 "2 더하기 2는?" 같은 일반 대화에도
// 자꾸 범위를 되묻는다(--print 모드 특성). "대화" 모드에서는 이 지시를 얹어서
// 일반 채팅처럼 자연스럽게 답하도록 유도한다. "코딩" 모드에서는 아무것도
// 얹지 않아 기본(신중한 에이전트) 동작을 그대로 쓴다 — projects\ 안의 실제
// 코드 작업을 시킬 땐 그 신중함이 오히려 필요하다.
//
// 괄호/따옴표 등 특수문자를 피해 plain 문장으로만 구성한다 — 아래 stdin 관련
// 주석 참고.
const CHAT_MODE_SYSTEM_PROMPT =
  'You are being used through a casual chat style interface, not as an autonomous ' +
  'coding agent working inside a repository. Respond directly and naturally to ' +
  'conversational, informational, or math questions instead of asking what file or ' +
  'option the user means. Only ask a clarifying question when the request is ' +
  'genuinely ambiguous about what to do, or before making changes to files.';

/**
 * Claude Code CLI(--print 모드)를 child_process 로 호출하는 얇은 래퍼.
 *
 * 설계 원칙(설계 문서 2장): Electron UI는 입력을 받아 CLI 에 전달하고 응답을
 * 렌더링만 한다. 코드 실행/파일 조작 등 실제 처리는 전부 CLI 가 담당하며,
 * 이 클래스는 그 경계를 넘지 않는다.
 */
class ClaudeBridge {
  constructor(options = {}) {
    // CAELUS_CLAUDE_CMD 환경변수로 CLI 실행 파일 경로를 재정의할 수 있다.
    // start.bat 이 PATH 에 node/claude 를 등록해두므로 기본값 'claude' 로 충분하다.
    this.command = options.command || process.env.CAELUS_CLAUDE_CMD || 'claude';
  }

  /**
   * @param {object} opts
   * @param {string} opts.prompt 사용자 입력
   * @param {'chat' | 'code'} [opts.mode] 'chat'(기본값)이면 대화체로 답하도록
   *   시스템 프롬프트를 얹는다. 'code'면 CLI 기본 동작(신중한 코딩 에이전트) 그대로.
   * @param {string} [opts.cwd] CLI를 실행할 작업 디렉터리(프로젝트 전환용).
   *   생략하면 이 프로세스(Electron 메인)의 cwd를 그대로 쓴다.
   * @param {string} [opts.sessionId] 대화 연속성을 위한 Claude 세션 uuid.
   *   호출자(main.js)가 crypto.randomUUID()로 직접 만들어 넘긴다 — 우리가
   *   직접 관리하는 값이라 특수문자가 없어 인자로 넘겨도 안전하다(위 stdin
   *   관련 주석과 같은 이유).
   * @param {boolean} [opts.resume] true면 --resume(기존 스레드 이어가기),
   *   false/생략이면 --session-id(그 uuid로 새 스레드 시작)로 넘긴다.
   * @param {(chunk: string) => void} [opts.onChunk] stdout 스트리밍 콜백
   * @param {(child: import('child_process').ChildProcess) => void} [opts.onSpawn]
   *   spawn 직후 자식 프로세스를 넘겨준다 — 호출자가 취소(child.kill())할 수
   *   있도록 참조를 잡아두는 용도.
   * @returns {Promise<string>} 전체 응답 텍스트
   */
  send({ prompt, mode, cwd, sessionId, resume, onChunk, onSpawn } = {}) {
    return new Promise((resolve, reject) => {
      // 사용자 프롬프트는 명령줄 인자가 아니라 stdin으로 전달한다(아래에서
      // child.stdin에 씀). Windows에서 이 프로세스는 shell:true로 cmd.exe를
      // 거쳐 실행되는데, 사용자가 입력한 문장에 괄호/&/%/^ 같은 cmd.exe
      // 특수문자가 섞이면 명령줄 자체가 깨져서 프롬프트가 잘리거나 다른
      // 인자와 뒤섞이는 문제가 실사용 중 확인됐다. stdin은 셸 파싱을 아예
      // 거치지 않으므로 어떤 문자가 들어와도 안전하다.
      // --append-system-prompt 값(CHAT_MODE_SYSTEM_PROMPT)은 우리가 직접
      // 관리하는 고정 문자열이라 특수문자를 안 쓰도록 짜뒀으므로 인자로
      // 넘겨도 안전하다.
      const args = ['--print'];
      if (mode !== 'code') {
        args.push('--append-system-prompt', CHAT_MODE_SYSTEM_PROMPT);
      }
      if (sessionId) {
        if (resume) args.push('--resume', sessionId);
        else args.push('--session-id', sessionId);
      }

      // Claude Code CLI의 인증/세션 저장 위치를 USB 내부(claude-home)로 고정한다.
      // Electron 프로세스 자체의 HOME/USERPROFILE은 건드리지 않는다 — 그걸 통째로
      // 바꾸면 Chromium이 내부 프로필 경로 계산 중 비정상 종료하는 문제가 실사용
      // 중 확인되었다. 이 CLI 자식 프로세스에만 적용해 그 문제를 피한다.
      const env = { ...process.env };
      if (process.env.CAELUS_HOME) {
        env.HOME = process.env.CAELUS_HOME;
        env.USERPROFILE = process.env.CAELUS_HOME;
      }
      // PortableGit도 같은 이유로 Electron 프로세스 자체의 PATH에는 넣지 않고
      // (start.bat 참고), 이 CLI 자식 프로세스의 PATH에만 추가한다. CLI가 파일에
      // git 명령을 실행할 때 필요하다.
      if (process.env.CAELUS_GIT_BIN) {
        // Windows에서는 PATH 환경변수의 실제 키 이름이 "Path"처럼 대소문자가
        // 다를 수 있다. env.PATH로 그냥 덮어쓰면 별도의 새 키가 생겨서 기존
        // PATH(node\ 포함)가 통째로 무시되는 문제가 있었다 — 실제 키를 찾아
        // 그 값에 이어붙인다.
        const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
        env[pathKey] = `${process.env.CAELUS_GIT_BIN};${env[pathKey] || ''}`;
      }

      const child = spawn(this.command, args, {
        shell: process.platform === 'win32',
        env,
        cwd: cwd || undefined,
      });

      if (onSpawn) onSpawn(child);

      // 프롬프트를 stdin으로 쓰고 바로 닫는다(EOF). 위 주석 참고 — 명령줄
      // 인자 대신 stdin을 쓰는 이유는 셸 특수문자로 인한 명령줄 손상을
      // 피하기 위함이다.
      child.stdin.end(prompt, 'utf8');

      let stdout = '';
      let stderr = '';
      let cancelled = false;

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        if (onChunk) onChunk(text);
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        reject(new Error(`Claude Code CLI 실행 실패 (PATH 확인 필요): ${err.message}`));
      });

      // 취소(cancel) 표시 — main.js가 child.kill()을 호출하기 전에 이 플래그를
      // 세팅해두면, 'close' 핸들러가 종료 코드 대신 취소로 처리한다.
      child.once('caelus:cancelled', () => {
        cancelled = true;
      });

      child.on('close', (code) => {
        if (cancelled) {
          reject(new Error('사용자가 요청을 취소했습니다.'));
        } else if (code === 0) {
          resolve(stdout.trim());
        } else {
          const detail = stderr.trim() || stdout.trim() || '(출력 없음)';
          const err = new Error(`Claude Code CLI 가 코드 ${code} 로 종료되었습니다: ${detail}`);
          // isResumeFailure()가 원본 stderr/종료코드를 볼 수 있도록 붙여둔다
          // (위 detail은 stdout이 섞여 들어갈 수 있어 판별용으로는 stderr가 더 정확함).
          err.stderr = stderr.trim();
          err.exitCode = code;
          reject(err);
        }
      });
    });
  }
}

// --resume <uuid> 가 실패했을 때(주로 그 uuid로 된 스레드를 CLI가 못 찾을
// 때) 감지하는 보수적인 휴리스틱. "resume"이라는 단어와 실패를 뜻하는
// 단어가 같이 나올 때만 true를 반환한다 — 인증 실패, 네트워크 오류 등
// 무관한 에러를 잘못 "이어가기 실패"로 분류할 위험을 줄이기 위함이다.
//
// ⚠️ 실기기 검증 필요: --print 모드에서 잘못된 --resume 값이 정말 종료코드
// nonzero + stderr로 실패하는지, 아니면 조용히 "그런 세션 없음" 내용을
// 종료코드 0의 정상 응답으로 뱉는지 확인되지 않았다. 후자라면 이 감지 자체가
// 무의미해지고 main.js의 폴백 재시도 로직이 트리거되지 않는다 — 알려진 제약.
function isResumeFailure(err) {
  const text = `${err && err.stderr ? err.stderr : ''} ${err && err.message ? err.message : ''}`.toLowerCase();
  if (!text.includes('resume')) return false;
  return /(not found|no such|invalid|expired|unknown|cannot find)/.test(text);
}

module.exports = { ClaudeBridge, isResumeFailure };

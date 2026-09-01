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
   * @param {string} prompt 사용자 입력
   * @param {'chat' | 'code'} [mode] 'chat'(기본값)이면 대화체로 답하도록 시스템
   *   프롬프트를 얹는다. 'code'면 CLI 기본 동작(신중한 코딩 에이전트) 그대로.
   * @param {(chunk: string) => void} [onChunk] stdout 스트리밍 콜백
   * @returns {Promise<string>} 전체 응답 텍스트
   */
  send(prompt, mode, onChunk) {
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
      });

      // 프롬프트를 stdin으로 쓰고 바로 닫는다(EOF). 위 주석 참고 — 명령줄
      // 인자 대신 stdin을 쓰는 이유는 셸 특수문자로 인한 명령줄 손상을
      // 피하기 위함이다.
      child.stdin.end(prompt, 'utf8');

      let stdout = '';
      let stderr = '';

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

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          const detail = stderr.trim() || stdout.trim() || '(출력 없음)';
          reject(new Error(`Claude Code CLI 가 코드 ${code} 로 종료되었습니다: ${detail}`));
        }
      });
    });
  }
}

module.exports = { ClaudeBridge };

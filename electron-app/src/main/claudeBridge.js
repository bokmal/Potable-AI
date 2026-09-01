const { spawn } = require('child_process');

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
   * @param {(chunk: string) => void} [onChunk] stdout 스트리밍 콜백
   * @returns {Promise<string>} 전체 응답 텍스트
   */
  send(prompt, onChunk) {
    return new Promise((resolve, reject) => {
      const args = ['--print', prompt];

      // Claude Code CLI의 인증/세션 저장 위치를 USB 내부(claude-home)로 고정한다.
      // Electron 프로세스 자체의 HOME/USERPROFILE은 건드리지 않는다 — 그걸 통째로
      // 바꾸면 Chromium이 내부 프로필 경로 계산 중 비정상 종료하는 문제가 실사용
      // 중 확인되었다. 이 CLI 자식 프로세스에만 적용해 그 문제를 피한다.
      const env = { ...process.env };
      if (process.env.CAELUS_HOME) {
        env.HOME = process.env.CAELUS_HOME;
        env.USERPROFILE = process.env.CAELUS_HOME;
      }

      const child = spawn(this.command, args, {
        shell: process.platform === 'win32',
        env,
      });

      // 이 프로세스는 stdin으로 아무것도 보내지 않는다(프롬프트는 인자로 전달).
      // stdin을 열어둔 채로 두면 CLI가 "혹시 파이프로 입력이 오나?" 하고 몇 초
      // 대기하다 경고를 낸다 — 즉시 EOF를 보내 그 대기를 건너뛴다.
      child.stdin.end();

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

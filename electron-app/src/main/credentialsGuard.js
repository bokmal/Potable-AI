const fs = require('fs');
const path = require('path');

/**
 * Claude Code CLI의 로그인 토큰(.credentials.json)이 USB가 쓰는 도중 뽑히는
 * 등으로 손상되는 것에 대비한 얇은 백업/복구 장치.
 *
 * CLI 자신의 저장 로직 자체는 건드릴 수 없으므로(그건 CLI 내부 구현이다),
 * CAELUS가 켜질 때마다:
 *  - 현재 파일이 정상 JSON이면 → 최신 내용으로 백업(.backup)을 갱신한다.
 *  - 현재 파일이 없거나 손상됐는데 백업은 정상이면 → 백업에서 복구한다.
 *
 * 두 파일이 정확히 같은 순간에 동시에 손상될 확률은 매우 낮으므로, 이 정도
 * 얇은 방어로도 "USB가 로그인 파일 쓰는 도중 뽑혀서 재로그인해야 하는" 상황을
 * 대부분 피할 수 있다.
 *
 * @param {string | undefined} caelusHome start.bat이 설정하는 CAELUS_HOME
 *   (예: D:\PortableAi\claude-home). 설정 안 돼 있으면(= start.bat을 거치지
 *   않고 실행한 경우) 실제 Windows 프로필을 잘못 건드리지 않도록 아무것도
 *   하지 않는다.
 */
function guardCredentials(caelusHome) {
  if (!caelusHome) return;

  const credPath = path.join(caelusHome, '.claude', '.credentials.json');
  const backupPath = `${credPath}.backup`;

  const readValidJson = (filePath) => {
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      JSON.parse(text);
      return text;
    } catch {
      return null;
    }
  };

  const current = readValidJson(credPath);
  if (current) {
    try {
      fs.writeFileSync(backupPath, current, 'utf8');
    } catch (err) {
      console.error(`[CAELUS] 로그인 정보 백업 실패: ${err.message}`);
    }
    return;
  }

  // 현재 파일이 없거나 손상됨 — 백업에서 복구를 시도한다.
  const backup = readValidJson(backupPath);
  if (backup) {
    try {
      fs.mkdirSync(path.dirname(credPath), { recursive: true });
      fs.writeFileSync(credPath, backup, 'utf8');
      console.error('[CAELUS] 로그인 정보 파일이 손상되어 백업에서 복구했습니다.');
    } catch (err) {
      console.error(`[CAELUS] 로그인 정보 복구 실패: ${err.message}`);
    }
  }
  // 백업도 없으면(최초 실행 등) 조용히 넘어간다 — 아직 로그인 전일 뿐이다.
}

module.exports = { guardCredentials };

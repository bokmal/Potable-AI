const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * 데이터 모델(설계 문서 5장 ERD)의 SESSION / TASK / LOG 를 claude-home 내부 JSON
 * 파일에 저장하는 초경량 로컬 스토어.
 *
 * USB 어디서나 그대로 이동 가능해야 하므로 SQLite 같은 네이티브 바이너리
 * 의존성 없이 순수 JSON 파일로 구현한다. DEVICE(볼륨 시리얼 ↔ PC) 정보는
 * install_trigger.ps1 이 PC의 작업 스케줄러에 등록하므로, 여기서는
 * 참고용으로 CAELUS_VOLUME_SERIAL 환경변수만 세션에 기록한다.
 *
 * USB는 예고 없이 뽑힐 수 있는 매체이므로, 쓰기는 임시 파일 + rename으로
 * 원자적으로 처리하고(`_save`), 읽기 중 파일이 손상된 것을 발견하면 조용히
 * 버리지 않고 백업해둔 뒤 새로 시작한다(`_load`). 두 경우 모두 작업 기록이
 * 경고 없이 통째로 사라지는 일을 막기 위함이다.
 */
class Store {
  constructor(options = {}) {
    const home =
      options.homeDir ||
      process.env.CAELUS_HOME ||
      process.env.HOME ||
      process.env.USERPROFILE ||
      process.cwd();
    this.dataDir = path.join(home, 'data');
    this.filePath = path.join(this.dataDir, 'caelus-store.json');
    this._load();
  }

  _load() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (fs.existsSync(this.filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        // 구버전 저장 파일(activeThreads/presets/favorites 필드가 생기기
        // 전)과의 하위호환.
        if (!this.data.activeThreads) this.data.activeThreads = {};
        if (!this.data.presets) this.data.presets = [];
        if (!this.data.favorites) this.data.favorites = [];
        return;
      } catch (err) {
        // 파일이 깨져 있어도(예: USB가 저장 도중 뽑힘) 조용히 버리지 않는다.
        // 손상된 파일을 백업해두고 새로 시작한다 — 나중에 수동 복구라도
        // 시도할 수 있도록 흔적을 남긴다.
        console.error(`[CAELUS] 작업 기록 파일 파싱 실패: ${err.message}`);
        try {
          const backupPath = `${this.filePath}.corrupted-${Date.now()}.bak`;
          fs.copyFileSync(this.filePath, backupPath);
          console.error(`[CAELUS] 손상된 파일을 백업했습니다: ${backupPath}`);
        } catch (backupErr) {
          console.error(`[CAELUS] 손상된 파일 백업 실패: ${backupErr.message}`);
        }
      }
    }
    this.data = this._blank();
    this._save();
  }

  _blank() {
    return {
      session: {
        session_id: crypto.randomUUID(),
        volume_serial: process.env.CAELUS_VOLUME_SERIAL || null,
        auth_token: null,
        last_used: new Date().toISOString(),
      },
      tasks: [],
      logs: [],
      // 프로젝트별로 "지금 이어지고 있는" Claude 대화 스레드 id.
      // { [projectName]: claudeSessionUuid }. 옛 파일에는 이 필드가 없을 수
      // 있으므로 _load()에서 읽은 직후 항상 존재를 보장한다(아래 참고).
      activeThreads: {},
      // 사용자가 직접 만든 자주 쓰는 프롬프트 문구(§I 프리셋 관리 패널).
      // 프로젝트 구분 없이 전역으로 공유한다 — { id, label, text }[].
      presets: [],
      // 즐겨찾기(고정)한 대화 스레드. "project::threadId" 형태의 문자열
      // 배열 — 스레드 단위 식별자가 이미 이 두 값의 조합이라(threadId가
      // 없는 옛 1회성 기록은 즐겨찾기 대상에서 제외) 별도 id 체계 불필요.
      favorites: [],
    };
  }

  _save() {
    // 원자적 쓰기: 기존 파일을 바로 덮어쓰지 않고 임시 파일에 먼저 쓴 다음
    // rename으로 교체한다. rename은 같은 볼륨 안에서 사실상 순간적으로
    // 끝나므로, 쓰는 도중 USB가 뽑히더라도 "완전히 새 파일" 아니면
    // "기존 파일 그대로" 둘 중 하나만 남는다 — 기존 파일이 절반만 써진
    // 상태로 깨질 일이 없다.
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }

  createTask(title, mode, { project, claudeSessionId } = {}) {
    const task = {
      task_id: crypto.randomUUID(),
      session_id: this.data.session.session_id,
      title,
      mode: mode === 'code' ? 'code' : 'chat',
      status: 'running',
      created_at: new Date().toISOString(),
      // project/claude_session_id: 어느 프로젝트 폴더에서, 어느 Claude 대화
      // 스레드의 일부로 보낸 요청인지. 옛 기록에는 없으므로 읽는 쪽에서
      // task.project || 'general' 로 취급한다(마이그레이션 불필요).
      project: project || 'general',
      claude_session_id: claudeSessionId || null,
    };
    this.data.tasks.unshift(task);
    this.data.session.last_used = task.created_at;
    this._save();
    return task;
  }

  // --- 프로젝트별 활성 대화 스레드 포인터 ---
  getActiveThread(project) {
    return this.data.activeThreads[project] || null;
  }

  setActiveThread(project, threadId) {
    this.data.activeThreads[project] = threadId;
    this._save();
  }

  clearActiveThread(project) {
    delete this.data.activeThreads[project];
    this._save();
  }

  // 그 프로젝트의 지금 활성 스레드와, 그 스레드에 쌓인 턴(task) 개수.
  // 상태 표시줄이 매 응답마다 이걸 다시 조회해서 "n번째 메시지"를 표시한다.
  getThreadInfo(project) {
    const threadId = this.getActiveThread(project);
    if (!threadId) return { threadId: null, turnCount: 0 };
    const turnCount = this.data.tasks.filter(
      (t) => (t.project || 'general') === project && t.claude_session_id === threadId
    ).length;
    return { threadId, turnCount };
  }

  // --print --resume 이 실패해서 새 스레드로 재시도(폴백)했을 때, 이미 만든
  // task 기록의 claude_session_id 를 새 스레드 id로 보정한다.
  updateTaskThread(taskId, newClaudeSessionId) {
    const task = this.data.tasks.find((t) => t.task_id === taskId);
    if (task) {
      task.claude_session_id = newClaudeSessionId;
      this._save();
    }
  }

  renameTask(taskId, newTitle) {
    const title = String(newTitle || '').trim();
    if (!title) return false;
    const task = this.data.tasks.find((t) => t.task_id === taskId);
    if (!task) return false;
    task.title = title;
    this._save();
    return true;
  }

  // 프로젝트 폴더 이름변경 시, 그 프로젝트에 속한 모든 task와 activeThreads
  // 항목을 새 이름으로 일괄 갱신한다(기록이 "일반"으로 떨어져 나가지 않도록).
  renameProjectInTasks(oldName, newName) {
    this.data.tasks.forEach((t) => {
      if ((t.project || 'general') === oldName) t.project = newName;
    });
    if (Object.prototype.hasOwnProperty.call(this.data.activeThreads, oldName)) {
      this.data.activeThreads[newName] = this.data.activeThreads[oldName];
      delete this.data.activeThreads[oldName];
    }
    // 즐겨찾기 키에도 프로젝트 이름이 그대로 박혀 있으므로("project::threadId"),
    // 이름을 안 옮기면 이름변경 후 그 스레드의 즐겨찾기 표시가 조용히 풀린다.
    const oldPrefix = `${oldName}::`;
    this.data.favorites = this.data.favorites.map((key) =>
      key.startsWith(oldPrefix) ? `${newName}::${key.slice(oldPrefix.length)}` : key
    );
    this._save();
  }

  updateTaskStatus(taskId, status) {
    const task = this.data.tasks.find((t) => t.task_id === taskId);
    if (task) {
      task.status = status;
      this._save();
    }
  }

  appendLog(taskId, content) {
    this.data.logs.push({
      log_id: crypto.randomUUID(),
      task_id: taskId,
      content,
      created_at: new Date().toISOString(),
    });
    this._save();
  }

  getTasks() {
    return this.data.tasks.map((task) => ({
      ...task,
      logs: this.data.logs.filter((l) => l.task_id === task.task_id),
    }));
  }

  getTask(taskId) {
    const task = this.data.tasks.find((t) => t.task_id === taskId);
    if (!task) return null;
    return { ...task, logs: this.data.logs.filter((l) => l.task_id === taskId) };
  }

  deleteTask(taskId) {
    this.data.tasks = this.data.tasks.filter((t) => t.task_id !== taskId);
    this.data.logs = this.data.logs.filter((l) => l.task_id !== taskId);
    this._save();
  }

  clearAll() {
    this.data.tasks = [];
    this.data.logs = [];
    // activeThreads(프로젝트별 활성 Claude 세션 포인터)도 같이 지워야 한다.
    // 여기서 안 지우면, 화면상 기록은 싹 없어졌는데 다음 메시지가 여전히
    // 예전 세션을 --resume 해서 "지웠는데도 기억한다"는 문제가 생긴다
    // (실사용 중 확인된 버그 — CLI 쪽 실제 세션 기억 자체를 지울 방법은
    // 없지만, 포인터를 지우면 다음 메시지부터 --session-id로 완전히 새
    // 세션을 시작하므로 사용자 입장에선 기억이 사라진 것과 동일하다).
    this.data.activeThreads = {};
    this._save();
  }

  // --- 즐겨찾기(고정) 대화 스레드(§I) ---
  _favKey(project, threadId) {
    return `${project}::${threadId}`;
  }

  getFavorites() {
    return this.data.favorites;
  }

  isFavorite(project, threadId) {
    if (!threadId) return false;
    return this.data.favorites.includes(this._favKey(project, threadId));
  }

  // 반환값: 토글 후 지금 즐겨찾기 상태(true=추가됨, false=해제됨).
  toggleFavorite(project, threadId) {
    if (!threadId) return false;
    const key = this._favKey(project, threadId);
    const idx = this.data.favorites.indexOf(key);
    if (idx === -1) {
      this.data.favorites.push(key);
    } else {
      this.data.favorites.splice(idx, 1);
    }
    this._save();
    return idx === -1;
  }

  // --- 프롬프트 프리셋(§I) ---
  getPresets() {
    return this.data.presets;
  }

  addPreset(label, text) {
    const preset = {
      id: crypto.randomUUID(),
      label: String(label || '').trim() || '제목 없음',
      text: String(text || ''),
    };
    this.data.presets.push(preset);
    this._save();
    return preset;
  }

  updatePreset(id, { label, text } = {}) {
    const preset = this.data.presets.find((p) => p.id === id);
    if (!preset) return false;
    if (label !== undefined) {
      const trimmed = String(label).trim();
      if (trimmed) preset.label = trimmed;
    }
    if (text !== undefined) preset.text = String(text);
    this._save();
    return true;
  }

  deletePreset(id) {
    const before = this.data.presets.length;
    this.data.presets = this.data.presets.filter((p) => p.id !== id);
    const deleted = this.data.presets.length !== before;
    if (deleted) this._save();
    return deleted;
  }

  // 사용량(%) 위젯은 로컬 추정치 대신 실제 Claude 계정 사용량 페이지로
  // 바로 연결하는 방식으로 대체했다 — main.js의 'caelus:open-usage-page'
  // 참고. 세션/주간 한도 %는 Claude 계정(구독 플랜) 자체의 정보라 이 USB에
  // 저장된 로컬 작업 기록만으로는 정확히 알 수 없기 때문이다.
}

module.exports = { Store };

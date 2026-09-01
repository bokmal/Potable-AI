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

  createTask(title, mode) {
    const task = {
      task_id: crypto.randomUUID(),
      session_id: this.data.session.session_id,
      title,
      mode: mode === 'code' ? 'code' : 'chat',
      status: 'running',
      created_at: new Date().toISOString(),
    };
    this.data.tasks.unshift(task);
    this.data.session.last_used = task.created_at;
    this._save();
    return task;
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
    this._save();
  }

  /**
   * 사용량 위젯용 로컬 집계. Claude Code CLI에 남은 한도/실제 초기화 시각을
   * 조회하는 공식적인 방법이 확인되지 않아, 여기서는 이 USB에 저장된 작업
   * 기록만으로 만든 "추정치"다. 실제 계정 한도와 다를 수 있다.
   *
   * - session: 최근 5시간 내 작업 수. 이 창의 "초기화 예정 시각"은 그 5시간
   *   창에서 가장 오래된 작업 시각 + 5시간으로 추정한다(Claude의 일반적인
   *   세션 한도 주기를 참고한 근사치).
   * - weekly: 최근 7일 내 작업 수. 마찬가지로 가장 오래된 작업 시각 + 7일을
   *   "초기화 예정 시각" 추정치로 표시한다.
   */
  getUsageStats() {
    const now = Date.now();
    const FIVE_HOURS = 5 * 60 * 60 * 1000;
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

    const within = (windowMs) =>
      this.data.tasks
        .map((t) => Date.parse(t.created_at))
        .filter((t) => !Number.isNaN(t) && now - t < windowMs)
        .sort((a, b) => a - b);

    const buildWindow = (windowMs) => {
      const timestamps = within(windowMs);
      if (timestamps.length === 0) {
        return { count: 0, resetsAt: null };
      }
      const oldest = timestamps[0];
      return { count: timestamps.length, resetsAt: new Date(oldest + windowMs).toISOString() };
    };

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayCount = this.data.tasks.filter(
      (t) => Date.parse(t.created_at) >= todayStart.getTime()
    ).length;

    return {
      today: todayCount,
      session: buildWindow(FIVE_HOURS),
      weekly: buildWindow(SEVEN_DAYS),
      isEstimate: true,
    };
  }
}

module.exports = { Store };

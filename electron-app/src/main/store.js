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
      } catch {
        this.data = this._blank();
      }
    } else {
      this.data = this._blank();
      this._save();
    }
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
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  createTask(title) {
    const task = {
      task_id: crypto.randomUUID(),
      session_id: this.data.session.session_id,
      title,
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
}

module.exports = { Store };

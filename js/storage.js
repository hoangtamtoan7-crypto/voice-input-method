/**
 * 本地存储模块
 * 管理语音识别历史记录（localStorage），支持增删查
 */
export class HistoryStorage {
  #key;
  #maxItems;

  constructor(key = 'voice_input_history', maxItems = 50) {
    this.#key = key;
    this.#maxItems = maxItems;
  }

  /** 获取所有历史记录 */
  getAll() {
    try {
      const raw = localStorage.getItem(this.#key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  /** 添加一条记录 */
  add(text) {
    if (!text || !text.trim()) return;
    const records = this.getAll();
    // 去重：与最新记录相同则跳过
    if (records.length > 0 && records[0].text === text.trim()) return;
    records.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: text.trim(),
      time: Date.now(),
    });
    // 限制条数
    if (records.length > this.#maxItems) {
      records.length = this.#maxItems;
    }
    this.#save(records);
  }

  /** 删除一条记录 */
  remove(id) {
    const records = this.getAll().filter(r => r.id !== id);
    this.#save(records);
  }

  /** 清空所有记录 */
  clearAll() {
    localStorage.removeItem(this.#key);
  }

  #save(records) {
    try {
      localStorage.setItem(this.#key, JSON.stringify(records));
    } catch {
      // 存储满了则删掉最旧的一半
      const half = Math.floor(records.length / 2);
      localStorage.setItem(this.#key, JSON.stringify(records.slice(0, half)));
    }
  }
}

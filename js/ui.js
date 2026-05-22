/**
 * UI控制模块
 * 管理DOM交互、主题切换、Toast提示、按钮状态
 */
export class UIController {
  constructor() {
    // 录音
    this.recordBtn = document.getElementById('recordBtn');
    this.recordHint = document.getElementById('recordHint');
    this.statusIndicator = document.getElementById('statusIndicator');
    this.statusText = document.getElementById('statusText');

    // 控制
    this.langSelect = document.getElementById('langSelect');
    this.copyBtn = document.getElementById('copyBtn');
    this.clearBtn = document.getElementById('clearBtn');
    this.exportBtn = document.getElementById('exportBtn');

    // 文本
    this.textOutput = document.getElementById('textOutput');
    this.charCount = document.getElementById('charCount');

    // 主题
    this.themeToggle = document.getElementById('themeToggle');

    // 历史
    this.historyList = document.getElementById('historyList');

    this.#initTheme();
    this.#bindThemeToggle();
  }

  /** 设置录音按钮状态 */
  setRecordingState(isRecording) {
    if (isRecording) {
      this.recordBtn.classList.add('recording');
      this.recordBtn.setAttribute('aria-label', '停止录音');
      this.recordHint.textContent = '正在录音...点击停止';
      this.setStatus('listening', '录音中');
    } else {
      this.recordBtn.classList.remove('recording');
      this.recordBtn.setAttribute('aria-label', '开始录音');
      this.recordHint.textContent = '点击麦克风开始录音';
    }
  }

  /** 设置状态指示器 */
  setStatus(state, text) {
    this.statusIndicator.className = 'status-indicator ' + state;
    this.statusText.textContent = text;
  }

  /** 更新文本显示 */
  updateText(text, interim = '') {
    const fullText = interim ? text + ' ' + interim : text;
    this.textOutput.value = fullText;
    // 滚动到底部
    this.textOutput.scrollTop = this.textOutput.scrollHeight;
    // 更新字数
    const count = fullText.replace(/\s/g, '').length;
    this.charCount.textContent = count + ' 字';
    // 更新按钮状态
    const hasText = text.length > 0;
    this.copyBtn.disabled = !hasText;
    this.clearBtn.disabled = !hasText;
    this.exportBtn.disabled = !hasText;
  }

  /** 获取当前文本（仅final文本） */
  getText() {
    return this.textOutput.value;
  }

  /** 获取选择的语言 */
  getLanguage() {
    return this.langSelect.value;
  }

  /** 渲染历史记录列表 */
  renderHistory(records, onDelete) {
    if (!records || records.length === 0) {
      this.historyList.innerHTML = '<li class="history-empty">暂无历史记录</li>';
      return;
    }
    this.historyList.innerHTML = records.map(r => `
      <li class="history-item" data-id="${r.id}">
        <span class="history-text" title="${this.#escapeHtml(r.text)}">${this.#escapeHtml(r.text.slice(0, 50))}${r.text.length > 50 ? '...' : ''}</span>
        <span class="history-time">${this.#formatTime(r.time)}</span>
        <button class="history-delete" data-id="${r.id}" title="删除">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </li>
    `).join('');

    // 绑定点击和删除事件
    this.historyList.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.history-delete')) return;
        const text = records.find(r => r.id === item.dataset.id)?.text || '';
        this.textOutput.value = text;
        this.updateText(text);
      });
    });
    this.historyList.querySelectorAll('.history-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onDelete(btn.dataset.id);
      });
    });
  }

  /** 显示Toast消息 */
  showToast(message, duration = 2000) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  // --- 私有方法 ---

  #initTheme() {
    const saved = localStorage.getItem('voice_input_theme');
    if (saved === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (saved === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }
    // 无保存时跟随系统
    if (!saved) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  }

  #bindThemeToggle() {
    this.themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('voice_input_theme', next);
    });
  }

  #formatTime(timestamp) {
    const d = new Date(timestamp);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  #escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

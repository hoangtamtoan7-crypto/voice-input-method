/**
 * 语音输入法 — 完整应用
 * 纯前端，兼容 file:// 协议直接打开
 */
(function () {
  'use strict';

  // ==================== SpeechRecognizer ====================
  class SpeechRecognizer {
    #recognition = null;
    #isSupported = false;
    #isListening = false;

    constructor() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.#recognition = new SpeechRecognition();
        this.#isSupported = true;
        this.#configure();
      }
    }

    #configure() {
      this.#recognition.continuous = true;
      this.#recognition.interimResults = true;
      this.#recognition.maxAlternatives = 1;
    }

    get isSupported() { return this.#isSupported; }
    get isListening() { return this.#isListening; }

    set language(lang) {
      if (this.#recognition) this.#recognition.lang = lang;
    }

    set onResult(callback) {
      if (!this.#recognition) return;
      this.#recognition.onresult = (event) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) final += transcript;
          else interim += transcript;
        }
        callback({ final, interim });
      };
    }

    set onError(callback) {
      if (!this.#recognition) return;
      this.#recognition.onerror = (event) => {
        this.#isListening = false;
        callback({ error: event.error, message: event.message });
      };
    }

    set onEnd(callback) {
      if (!this.#recognition) return;
      this.#recognition.onend = () => {
        this.#isListening = false;
        callback();
      };
    }

    start() {
      if (!this.#recognition) return { success: false, error: '浏览器不支持语音识别' };
      if (this.#isListening) return { success: false, error: '已经在录音中' };
      try {
        this.#recognition.start();
        this.#isListening = true;
        return { success: true };
      } catch (err) {
        this.#isListening = false;
        return { success: false, error: err.message || '启动录音失败' };
      }
    }

    stop() {
      if (!this.#recognition || !this.#isListening) return;
      try { this.#recognition.stop(); } catch (_) { /* ignore */ }
      this.#isListening = false;
    }

    destroy() {
      this.stop();
      this.#recognition = null;
    }
  }

  // ==================== TextProcessor ====================
  class TextProcessor {
    static fixChinesePunctuation(text) {
      let result = text;
      result = result.replace(/\?/g, '？');
      result = result.replace(/!/g, '！');
      result = result.replace(/，/g, '，');
      result = result.replace(/\s*(。|，|？|！|；|：)\s*/g, '$1');
      result = result.replace(/([^\x00-\xff])\s+([^\x00-\xff])/g, '$1$2');
      return result;
    }

    static fixEnglishPunctuation(text) {
      let result = text;
      result = result.replace(/(?:^|[.!?]\s+)([a-z])/g, function (match) { return match.toUpperCase(); });
      result = result.replace(/\bi\b(?=[\s.,!?']|$)/g, 'I');
      result = result.replace(/([.,!?;:])([^\s\d])/g, '$1 $2');
      return result;
    }

    static fixPunctuation(text, lang) {
      if (!text) return text;
      lang = lang || 'zh-CN';
      if (lang.startsWith('en')) return TextProcessor.fixEnglishPunctuation(text);
      return TextProcessor.fixChinesePunctuation(text);
    }

    static async copyToClipboard(text) {
      if (!text) return { success: false, error: '没有可复制的文本' };
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return { success: true };
        }
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message || '复制失败' };
      }
    }

    static exportToTxt(text, filename) {
      if (!text) return { success: false, error: '没有可导出的文本' };
      filename = filename || 'transcript';
      var blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename + '_' + new Date().toISOString().slice(0, 10) + '.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { success: true };
    }
  }

  // ==================== HistoryStorage ====================
  class HistoryStorage {
    #key;
    #maxItems;

    constructor(key, maxItems) {
      this.#key = key || 'voice_input_history';
      this.#maxItems = maxItems || 50;
    }

    getAll() {
      try {
        var raw = localStorage.getItem(this.#key);
        return raw ? JSON.parse(raw) : [];
      } catch (_) { return []; }
    }

    add(text) {
      if (!text || !text.trim()) return;
      var records = this.getAll();
      if (records.length > 0 && records[0].text === text.trim()) return;
      records.unshift({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        text: text.trim(),
        time: Date.now()
      });
      if (records.length > this.#maxItems) records.length = this.#maxItems;
      this.#save(records);
    }

    remove(id) {
      var records = this.getAll().filter(function (r) { return r.id !== id; });
      this.#save(records);
    }

    clearAll() { localStorage.removeItem(this.#key); }

    #save(records) {
      try {
        localStorage.setItem(this.#key, JSON.stringify(records));
      } catch (_) {
        var half = Math.floor(records.length / 2);
        localStorage.setItem(this.#key, JSON.stringify(records.slice(0, half)));
      }
    }
  }

  // ==================== UIController ====================
  class UIController {
    constructor() {
      this.recordBtn = document.getElementById('recordBtn');
      this.recordHint = document.getElementById('recordHint');
      this.statusIndicator = document.getElementById('statusIndicator');
      this.statusText = document.getElementById('statusText');
      this.langSelect = document.getElementById('langSelect');
      this.copyBtn = document.getElementById('copyBtn');
      this.clearBtn = document.getElementById('clearBtn');
      this.exportBtn = document.getElementById('exportBtn');
      this.textOutput = document.getElementById('textOutput');
      this.charCount = document.getElementById('charCount');
      this.themeToggle = document.getElementById('themeToggle');
      this.historyList = document.getElementById('historyList');

      this._initTheme();
      this._bindThemeToggle();
    }

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

    setStatus(state, text) {
      this.statusIndicator.className = 'status-indicator ' + state;
      this.statusText.textContent = text;
    }

    updateText(text, interim) {
      var fullText = interim ? text + ' ' + interim : text;
      this.textOutput.value = fullText;
      this.textOutput.scrollTop = this.textOutput.scrollHeight;
      var count = fullText.replace(/\s/g, '').length;
      this.charCount.textContent = count + ' 字';
      var hasText = text.length > 0;
      this.copyBtn.disabled = !hasText;
      this.clearBtn.disabled = !hasText;
      this.exportBtn.disabled = !hasText;
    }

    getText() { return this.textOutput.value; }
    getLanguage() { return this.langSelect.value; }

    renderHistory(records, onDelete) {
      var self = this;
      if (!records || records.length === 0) {
        this.historyList.innerHTML = '<li class="history-empty">暂无历史记录</li>';
        return;
      }
      this.historyList.innerHTML = records.map(function (r) {
        return '<li class="history-item" data-id="' + r.id + '">'
          + '<span class="history-text" title="' + self._escapeHtml(r.text) + '">'
          + self._escapeHtml(r.text.slice(0, 50)) + (r.text.length > 50 ? '...' : '')
          + '</span>'
          + '<span class="history-time">' + self._formatTime(r.time) + '</span>'
          + '<button class="history-delete" data-id="' + r.id + '" title="删除">'
          + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
          + '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
          + '</svg></button></li>';
      }).join('');

      this.historyList.querySelectorAll('.history-item').forEach(function (item) {
        item.addEventListener('click', function (e) {
          if (e.target.closest('.history-delete')) return;
          var found = records.find(function (r) { return r.id === item.dataset.id; });
          if (found) {
            self.textOutput.value = found.text;
            self.updateText(found.text);
          }
        });
      });
      this.historyList.querySelectorAll('.history-delete').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          onDelete(btn.dataset.id);
        });
      });
    }

    showToast(message, duration) {
      duration = duration || 2000;
      var toast = document.querySelector('.toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(toast._timeout);
      toast._timeout = setTimeout(function () {
        toast.classList.remove('show');
      }, duration);
    }

    _initTheme() {
      var saved = localStorage.getItem('voice_input_theme');
      if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else if (saved === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      }
    }

    _bindThemeToggle() {
      var self = this;
      this.themeToggle.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme');
        var next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('voice_input_theme', next);
      });
    }

    _formatTime(timestamp) {
      var d = new Date(timestamp);
      var pad = function (n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    _escapeHtml(str) {
      var div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
  }

  // ==================== VoiceInputApp ====================
  class VoiceInputApp {
    #recognizer;
    #storage;
    #ui;
    #finalText = '';

    constructor() {
      this.#recognizer = new SpeechRecognizer();
      this.#storage = new HistoryStorage();
      this.#ui = new UIController();
      this._init();
    }

    _init() {
      if (!this.#recognizer.isSupported) {
        this.#ui.setStatus('error', '浏览器不支持语音识别');
        this.#ui.recordBtn.disabled = true;
        this.#ui.recordHint.textContent = '请使用Chrome或Edge浏览器';
        this.#ui.showToast('当前浏览器不支持语音识别，请使用Chrome或Edge', 4000);
        return;
      }

      this.#recognizer.language = this.#ui.getLanguage();
      var self = this;
      this.#ui.renderHistory(this.#storage.getAll(), function (id) { self._deleteHistory(id); });
      this._bindEvents();
      this._setupRecognizerCallbacks();
    }

    _bindEvents() {
      var self = this;

      this.#ui.recordBtn.addEventListener('click', function () { self._toggleRecording(); });

      this.#ui.langSelect.addEventListener('change', function () {
        self.#recognizer.language = self.#ui.getLanguage();
      });

      this.#ui.copyBtn.addEventListener('click', async function () {
        var result = await TextProcessor.copyToClipboard(self.#finalText);
        self.#ui.showToast(result.success ? '已复制到剪贴板' : result.error);
      });

      this.#ui.clearBtn.addEventListener('click', function () {
        self.#finalText = '';
        self.#ui.updateText('');
        self.#ui.showToast('已清空');
      });

      this.#ui.exportBtn.addEventListener('click', function () {
        var lang = self.#ui.getLanguage();
        var prefix = lang.startsWith('en') ? 'transcript' : '语音转录';
        var result = TextProcessor.exportToTxt(self.#finalText, prefix);
        if (!result.success) self.#ui.showToast(result.error);
      });
    }

    _setupRecognizerCallbacks() {
      var self = this;

      this.#recognizer.onResult = function (result) {
        if (result.final) {
          var lang = self.#ui.getLanguage();
          self.#finalText += TextProcessor.fixPunctuation(result.final, lang);
        }
        self.#ui.updateText(self.#finalText, result.interim);
      };

      this.#recognizer.onError = function (err) {
        self.#ui.setRecordingState(false);
        self.#ui.setStatus('ready', '就绪');
        var messages = {
          'not-allowed': '麦克风权限被拒绝',
          'no-speech': '未检测到语音',
          'audio-capture': '未找到麦克风设备',
          'network': '网络连接异常',
          'aborted': '录音被中断',
          'language-not-supported': '当前语言不支持',
          'service-not-allowed': '语音服务不可用',
          'bad-grammar': '语法错误'
        };
        self.#ui.showToast(messages[err.error] || '识别错误: ' + err.error, 3000);
      };

      this.#recognizer.onEnd = function () {
        self.#ui.setRecordingState(false);
        self.#ui.setStatus('ready', '就绪');
        if (self.#finalText.trim()) {
          self.#storage.add(self.#finalText);
          self.#ui.renderHistory(self.#storage.getAll(), function (id) { self._deleteHistory(id); });
        }
      };
    }

    _toggleRecording() {
      if (this.#recognizer.isListening) {
        this.#recognizer.stop();
      } else {
        var result = this.#recognizer.start();
        if (result.success) {
          this.#ui.setRecordingState(true);
          this.#ui.setStatus('listening', '录音中');
        } else {
          this.#ui.showToast(result.error, 3000);
        }
      }
    }

    _deleteHistory(id) {
      var self = this;
      this.#storage.remove(id);
      this.#ui.renderHistory(this.#storage.getAll(), function (i) { self._deleteHistory(i); });
    }
  }

  // ==================== 启动 ====================
  document.addEventListener('DOMContentLoaded', function () {
    new VoiceInputApp();
  });
})();

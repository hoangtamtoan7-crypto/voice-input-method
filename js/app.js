/**
 * 语音输入法 v2 — 面向用户的完整语音输入产品
 * 纯前端，兼容 file:// 协议直接打开
 */
(function () {
  'use strict';

  // ==================== SpeechRecognizer ====================
  class SpeechRecognizer {
    #recognition = null;
    #isSupported = false;
    #isListening = false;
    #lastResultTimestamp = 0;

    constructor() {
      var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
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

    // result callback
    set onResult(cb) {
      if (!this.#recognition) return;
      var self = this;
      this.#recognition.onresult = function (event) {
        self.#lastResultTimestamp = Date.now();
        var interim = '';
        var final = '';
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var t = event.results[i][0].transcript;
          if (event.results[i].isFinal) final += t;
          else interim += t;
        }
        cb({ final: final, interim: interim });
      };
    }

    // Speech event callbacks for visual feedback
    set onSpeechStart(cb) { if (this.#recognition) this.#recognition.onspeechstart = cb; }
    set onSpeechEnd(cb) { if (this.#recognition) this.#recognition.onspeechend = cb; }
    set onAudioStart(cb) { if (this.#recognition) this.#recognition.onaudiostart = cb; }
    set onAudioEnd(cb) { if (this.#recognition) this.#recognition.onaudioend = cb; }
    set onSoundStart(cb) { if (this.#recognition) this.#recognition.onsoundstart = cb; }
    set onSoundEnd(cb) { if (this.#recognition) this.#recognition.onsoundend = cb; }
    set onNoMatch(cb) { if (this.#recognition) this.#recognition.onnomatch = cb; }

    set onError(cb) {
      if (!this.#recognition) return;
      var self = this;
      this.#recognition.onerror = function (event) {
        self.#isListening = false;
        cb({ error: event.error, message: event.message });
      };
    }

    set onEnd(cb) {
      if (!this.#recognition) return;
      var self = this;
      this.#recognition.onend = function () {
        var wasListening = self.#isListening;
        self.#isListening = false;
        cb({ intentional: !wasListening });
      };
    }

    start() {
      if (!this.#recognition) return { success: false, error: '浏览器不支持语音识别' };
      if (this.#isListening) return { success: false, error: '已经在录音中' };
      try {
        this.#recognition.start();
        this.#isListening = true;
        this.#lastResultTimestamp = Date.now();
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

    destroy() { this.stop(); this.#recognition = null; }
  }

  // ==================== TextProcessor ====================
  var TextProcessor = {
    fixChinesePunctuation: function (text) {
      var result = text;
      result = result.replace(/\?/g, '？').replace(/!/g, '！');
      result = result.replace(/\s*(。|，|？|！|；|：)\s*/g, '$1');
      result = result.replace(/([^\x00-\xff])\s+([^\x00-\xff])/g, '$1$2');
      return result;
    },

    fixEnglishPunctuation: function (text) {
      var result = text;
      result = result.replace(/(?:^|[.!?]\s+)([a-z])/g, function (m) { return m.toUpperCase(); });
      result = result.replace(/\bi\b(?=[\s.,!?']|$)/g, 'I');
      result = result.replace(/([.,!?;:])([^\s\d])/g, '$1 $2');
      return result;
    },

    fixPunctuation: function (text, lang) {
      if (!text) return text;
      lang = lang || 'zh-CN';
      return lang.startsWith('en') ? TextProcessor.fixEnglishPunctuation(text) : TextProcessor.fixChinesePunctuation(text);
    },

    copyToClipboard: async function (text) {
      if (!text) return { success: false, error: '没有可复制的文本' };
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return { success: true };
        }
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return { success: true };
      } catch (err) {
        return { success: false, error: '复制失败：' + (err.message || '') };
      }
    },

    exportToTxt: function (text, filename) {
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
  };

  // ==================== HistoryStorage ====================
  function HistoryStorage(key, maxItems) {
    key = key || 'voice_input_history';
    maxItems = maxItems || 50;

    this.getAll = function () {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : [];
      } catch (_) { return []; }
    };

    this.add = function (text) {
      if (!text || !text.trim()) return;
      var records = this.getAll();
      if (records.length > 0 && records[0].text === text.trim()) return;
      records.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: text.trim(), time: Date.now() });
      if (records.length > maxItems) records.length = maxItems;
      save(records);
    };

    this.remove = function (id) {
      var records = this.getAll().filter(function (r) { return r.id !== id; });
      save(records);
    };

    this.clearAll = function () { localStorage.removeItem(key); };

    function save(records) {
      try { localStorage.setItem(key, JSON.stringify(records)); }
      catch (_) { localStorage.setItem(key, JSON.stringify(records.slice(0, Math.floor(records.length / 2)))); }
    }
  }

  // ==================== UIController ====================
  function UIController() {
    // DOM refs
    var els = {
      recordBtn:      document.getElementById('recordBtn'),
      recordHint:     document.getElementById('recordHint'),
      statusIndicator: document.getElementById('statusIndicator'),
      statusText:     document.getElementById('statusText'),
      statusTime:     document.getElementById('statusTime'),
      audioVisualizer: document.getElementById('audioVisualizer'),
      langSelect:     document.getElementById('langSelect'),
      copyBtn:        document.getElementById('copyBtn'),
      clearBtn:       document.getElementById('clearBtn'),
      exportBtn:      document.getElementById('exportBtn'),
      undoBtn:        document.getElementById('undoBtn'),
      textOutput:     document.getElementById('textOutput'),
      interimPreview: document.getElementById('interimPreview'),
      charCount:      document.getElementById('charCount'),
      wordCount:      document.getElementById('wordCount'),
      readTime:       document.getElementById('readTime'),
      themeToggle:    document.getElementById('themeToggle'),
      historyList:    document.getElementById('historyList'),
      historyCount:   document.getElementById('historyCount'),
      historyDetails: document.getElementById('historyDetails'),
      tipsBtn:        document.getElementById('tipsBtn'),
      tipsModal:      document.getElementById('tipsModal'),
      tipsCloseBtn:   document.getElementById('tipsCloseBtn'),
      clearHistoryBtn: document.getElementById('clearHistoryBtn'),
      punctBar:       document.getElementById('punctBar')
    };

    // init theme
    var saved = localStorage.getItem('voice_input_theme');
    if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else {
      document.documentElement.setAttribute('data-theme',
        window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }

    els.themeToggle.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('voice_input_theme', next);
    });

    // tips modal
    els.tipsBtn.addEventListener('click', function () { els.tipsModal.classList.add('show'); });
    els.tipsCloseBtn.addEventListener('click', function () { els.tipsModal.classList.remove('show'); });
    els.tipsModal.addEventListener('click', function (e) {
      if (e.target === els.tipsModal) els.tipsModal.classList.remove('show');
    });

    // Recording timer
    var timerInterval = null;
    var timerSeconds = 0;

    this.startTimer = function () {
      timerSeconds = 0;
      els.statusTime.textContent = '00:00';
      timerInterval = setInterval(function () {
        timerSeconds++;
        var m = Math.floor(timerSeconds / 60);
        var s = timerSeconds % 60;
        els.statusTime.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
      }, 1000);
    };

    this.stopTimer = function () {
      clearInterval(timerInterval);
      timerInterval = null;
    };

    // Recording state
    this.setRecordingState = function (isRecording) {
      if (isRecording) {
        els.recordBtn.classList.add('recording');
        els.recordBtn.setAttribute('aria-label', '停止录音');
        els.recordHint.innerHTML = '<kbd>Space</kbd> 正在录音...点击停止';
      } else {
        els.recordBtn.classList.remove('recording');
        els.recordBtn.setAttribute('aria-label', '开始录音');
        els.recordHint.innerHTML = '<kbd>Space</kbd> 开始录音';
        els.audioVisualizer.classList.remove('active', 'speech-active');
        els.interimPreview.textContent = '';
      }
    };

    this.setStatus = function (state, text) {
      els.statusIndicator.className = 'status-indicator ' + state;
      els.statusText.textContent = text;
    };

    this.setAudioActive = function (active) { els.audioVisualizer.classList.toggle('active', active); };
    this.setSpeechActive = function (active) { els.audioVisualizer.classList.toggle('speech-active', active); };

    // Update text display
    this.updateText = function (finalText, interimText) {
      els.textOutput.value = finalText;
      els.interimPreview.textContent = interimText || '';
      els.textOutput.scrollTop = els.textOutput.scrollHeight;

      var full = finalText + (interimText ? interimText : '');
      var charTotal = full.replace(/\s/g, '').length;
      els.charCount.textContent = charTotal;

      // word count
      var words = full.trim() ? full.trim().split(/[\s，。？！；：、]+/).filter(function (w) { return w.length > 0; }).length : 0;
      els.wordCount.textContent = words;
      // reading time (Chinese ~4 chars/sec, English ~3 words/sec)
      var lang = els.langSelect.value;
      var seconds = lang.startsWith('en') ? Math.ceil((words || 0) / 3) : Math.ceil(charTotal / 4);
      els.readTime.textContent = seconds;

      // button states
      var hasText = finalText.length > 0;
      els.copyBtn.disabled = !hasText;
      els.clearBtn.disabled = !hasText;
      els.exportBtn.disabled = !hasText;
      els.undoBtn.disabled = !hasText;
    };

    this.getText = function () { return els.textOutput.value; };
    this.setEditable = function (editable) {
      if (editable) els.textOutput.removeAttribute('readonly');
      else els.textOutput.setAttribute('readonly', '');
    };
    this.isEditable = function () { return !els.textOutput.hasAttribute('readonly'); };

    this.getLanguage = function () { return els.langSelect.value; };

    this.getEls = function () { return els; };

    this.renderHistory = function (records, onDelete) {
      var self = this;
      els.historyCount.textContent = (records ? records.length : 0) + '条';
      if (!records || records.length === 0) {
        els.historyList.innerHTML = '<li class="history-empty">暂无历史记录</li>';
        return;
      }
      els.historyList.innerHTML = records.map(function (r) {
        return '<li class="history-item" data-id="' + r.id + '">'
          + '<span class="history-text" title="' + escapeHtml(r.text) + '">'
          + escapeHtml(r.text.slice(0, 50)) + (r.text.length > 50 ? '...' : '')
          + '</span><span class="history-time">' + formatTime(r.time) + '</span>'
          + '<button class="history-delete" data-id="' + r.id + '" title="删除">'
          + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
          + '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></li>';
      }).join('');

      els.historyList.querySelectorAll('.history-item').forEach(function (item) {
        item.addEventListener('click', function (e) {
          if (e.target.closest('.history-delete')) return;
          var found = records.find(function (r) { return r.id === item.dataset.id; });
          if (found) { els.textOutput.value = found.text; self.updateText(found.text); }
        });
      });
      els.historyList.querySelectorAll('.history-delete').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); onDelete(btn.dataset.id); });
      });
    };

    this.showToast = function (message, duration, isError) {
      duration = duration || 2000;
      var toast = document.querySelector('.toast');
      if (!toast) { toast = document.createElement('div'); toast.className = 'toast'; document.body.appendChild(toast); }
      toast.textContent = message;
      toast.className = 'toast' + (isError ? ' error' : '');
      toast.classList.add('show');
      clearTimeout(toast._timeout);
      toast._timeout = setTimeout(function () { toast.classList.remove('show'); }, duration);
    };

    function formatTime(ts) {
      var d = new Date(ts);
      var p = function (n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function escapeHtml(s) { var div = document.createElement('div'); div.textContent = s; return div.innerHTML; }
  }

  // ==================== VoiceInputApp ====================
  function VoiceInputApp() {
    var storage = new HistoryStorage();
    var ui = new UIController();
    var els = ui.getEls();

    // --- 多引擎支持 ---
    var engines = {};         // { 'sherpa': SherpaEngine, 'webspeech': SpeechRecognizer }
    var activeEngine = null;  // 当前使用的引擎
    var activeEngineName = ''; // 'sherpa' | 'webspeech'
    var recognizer = null;    // 当前活跃的识别器引用（兼容旧代码）

    var finalText = '';
    var undoStack = [];
    var maxUndo = 30;
    var autoRestart = true;
    var draftSaveTimer = null;

    init();

    function init() {
      // 检测可用引擎（优先级：离线 > 百度国内 > 在线VPN）
      var sherpa = typeof SherpaEngine !== 'undefined' ? new SherpaEngine() : null;
      var baidu = typeof BaiduEngine !== 'undefined' ? new BaiduEngine() : null;
      var webspeech = new SpeechRecognizer();

      if (sherpa && sherpa.isSupported) {
        engines.sherpa = sherpa;
      }
      if (baidu && baidu.isConfigured) {
        engines.baidu = baidu;
      }
      if (webspeech.isSupported) {
        engines.webspeech = webspeech;
      }

      // 选择引擎：离线 > 百度API > 在线
      if (engines.sherpa) {
        setEngine('sherpa');
      } else if (engines.baidu) {
        setEngine('baidu');
      } else if (engines.webspeech) {
        setEngine('webspeech');
      } else {
        // 两个引擎都不可用
        ui.setStatus('error', '无可用引擎');
        els.recordBtn.disabled = true;
        els.recordHint.textContent = '语音识别不可用——请安装离线模型或使用Chrome';
        ui.showToast('请使用Chrome浏览器或安装离线语音模型', 5000, true);
        updateEngineBadge();
        return;
      }

      setupRecognizerCallbacks();
      bindEngineSwitch();

      // Load draft
      var draft = localStorage.getItem('voice_input_draft');
      if (draft) {
        finalText = draft;
        els.textOutput.value = finalText;
        ui.updateText(finalText);
        pushUndo(finalText);
      }

      recognizer.language = ui.getLanguage();
      ui.renderHistory(storage.getAll(), function (id) { deleteHistory(id); });
      bindEvents();
      ui.setEditable(true);
      updateEngineBadge();
    }

    function setEngine(name) {
      if (activeEngineName === name) return;
      var wasListening = recognizer && recognizer.isListening;
      if (wasListening) recognizer.stop();

      activeEngineName = name;
      recognizer = engines[name];
      activeEngine = engines[name];

      if (wasListening) {
        // 切换引擎后自动恢复录音
        setTimeout(function () {
          var result = recognizer.start();
          if (result.success || (result.then && result.then(function(r) { return r.success; }))) {
            ui.setRecordingState(true);
            ui.setStatus('listening', '录音中');
            ui.startTimer();
          }
        }, 300);
      }
      updateEngineBadge();
    }

    function bindEngineSwitch() {
      // 点击引擎徽章切换引擎
      if (els.engineBadge) {
        els.engineBadge.addEventListener('click', function () {
          var engineNames = Object.keys(engines);
          if (engineNames.length < 2) {
            ui.showToast('只有一个可用引擎', 1500);
            return;
          }
          var currentIdx = engineNames.indexOf(activeEngineName);
          var nextName = engineNames[(currentIdx + 1) % engineNames.length];
          setEngine(nextName);
          setupRecognizerCallbacks();
          var labels = { sherpa: '离线引擎 (sherpa-onnx)', baidu: '百度引擎 (国内直连)', webspeech: '在线引擎 (Web Speech)' };
          ui.showToast('已切换到' + (labels[nextName] || nextName), 2000);
        });
      }
    }

    function updateEngineBadge() {
      if (!els.engineBadge) return;
      var badge = els.engineBadge;
      badge.className = 'engine-badge';
      if (activeEngineName === 'sherpa') {
        badge.textContent = '离线引擎';
        badge.title = 'sherpa-onnx 本地识别，无需网络';
      } else if (activeEngineName === 'baidu') {
        badge.textContent = '百度引擎';
        badge.title = '百度实时语音识别，国内直连';
      } else if (activeEngineName === 'webspeech') {
        badge.textContent = '在线引擎';
        badge.classList.add('online');
        badge.title = 'Web Speech API，需VPN连接Google';
      } else if (Object.keys(engines).length === 0) {
        badge.textContent = '无可用引擎';
        badge.classList.add('unavailable');
        badge.title = '请安装离线模型、配置百度API或使用Chrome';
      }
    }

    function pushUndo(text) {
      undoStack.push(text);
      if (undoStack.length > maxUndo) undoStack.shift();
    }

    function bindEvents() {
      // Toggle recording
      els.recordBtn.addEventListener('click', toggleRecording);

      // Language change
      els.langSelect.addEventListener('change', function () {
        recognizer.language = ui.getLanguage();
      });

      // Copy
      els.copyBtn.addEventListener('click', async function () {
        var result = await TextProcessor.copyToClipboard(finalText);
        ui.showToast(result.success ? '已复制到剪贴板' : result.error, 2000, !result.success);
      });

      // Clear
      els.clearBtn.addEventListener('click', function () {
        if (finalText && !confirm('确定清空全部文本吗？')) return;
        pushUndo(finalText);
        finalText = '';
        ui.updateText('');
        ui.showToast('已清空');
        saveDraft();
      });

      // Export
      els.exportBtn.addEventListener('click', function () {
        var lang = ui.getLanguage();
        var prefix = lang.startsWith('en') ? 'transcript' : '语音转录';
        var result = TextProcessor.exportToTxt(finalText, prefix);
        if (!result.success) ui.showToast(result.error, 2000, true);
      });

      // Undo
      els.undoBtn.addEventListener('click', function () {
        if (undoStack.length > 1) {
          undoStack.pop(); // current state
          finalText = undoStack[undoStack.length - 1] || '';
          ui.updateText(finalText);
          ui.showToast('已撤销');
        } else if (undoStack.length === 1) {
          finalText = '';
          undoStack = [];
          ui.updateText('');
          ui.showToast('已撤销');
        }
        saveDraft();
      });

      // Punctuation bar
      els.punctBar.querySelectorAll('.punct-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var punct = this.dataset.punct;
          var ta = els.textOutput;
          if (punct === '\n') {
            // Insert newline at cursor
            var pos = ta.selectionStart;
            finalText = finalText.slice(0, pos) + '\n' + finalText.slice(ta.selectionEnd);
            ta.value = finalText;
            ta.selectionStart = ta.selectionEnd = pos + 1;
          } else {
            var pos2 = ta.selectionStart;
            finalText = finalText.slice(0, pos2) + punct + finalText.slice(ta.selectionEnd);
            ta.value = finalText;
            ta.selectionStart = ta.selectionEnd = pos2 + punct.length;
          }
          pushUndo(finalText);
          ui.updateText(finalText);
          saveDraft();
          ta.focus();
        });
      });

      // Textarea manual edit tracking
      els.textOutput.addEventListener('input', function () {
        finalText = els.textOutput.value;
        pushUndo(finalText);
        ui.updateText(finalText);
        saveDraft();
      });

      // Clear history
      els.clearHistoryBtn.addEventListener('click', function () {
        if (confirm('确定清空所有历史记录吗？')) {
          storage.clearAll();
          ui.renderHistory(storage.getAll(), function (id) { deleteHistory(id); });
          ui.showToast('历史记录已清空');
        }
      });

      // Keyboard shortcuts
      document.addEventListener('keydown', function (e) {
        // Space - toggle recording (when not typing in textarea)
        if (e.code === 'Space' && e.target !== els.textOutput && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
          e.preventDefault();
          toggleRecording();
          return;
        }
        // Ctrl shortcuts
        if (e.ctrlKey || e.metaKey) {
          switch (e.key.toLowerCase()) {
            case 'z':
              e.preventDefault();
              els.undoBtn.click();
              break;
            case 'c':
              if (e.target !== els.textOutput) {
                e.preventDefault();
                els.copyBtn.click();
              }
              break;
            case 's':
              e.preventDefault();
              els.exportBtn.click();
              break;
          }
          if (e.key === 'Delete') {
            e.preventDefault();
            els.clearBtn.click();
          }
        }
        // Escape - close modal
        if (e.key === 'Escape') {
          els.tipsModal.classList.remove('show');
        }
      });
    }

    function setupRecognizerCallbacks() {
      var self = this;
      // Reset old engine callbacks
      if (activeEngine) {
        setupResultsAndErrors();
        setupSpeechEvents();
      }

      function setupResultsAndErrors() {
        // Results
        recognizer.onResult = function (result) {
          if (result.final) {
            var lang = ui.getLanguage();
            finalText += TextProcessor.fixPunctuation(result.final, lang);
            pushUndo(finalText);
            saveDraft();
          }
          ui.updateText(finalText, result.interim);
        };

        // Errors
        recognizer.onError = function (err) {
          ui.setRecordingState(false);
          ui.stopTimer();
          ui.setStatus('ready', '就绪');
          var messages = {
            'not-allowed': '麦克风权限被拒绝，请在浏览器设置中允许',
            'no-speech': '未检测到语音，请检查麦克风',
            'audio-capture': '未找到麦克风设备',
            'network': '网络连接异常，语音识别需要联网',
            'aborted': '录音被中断',
            'language-not-supported': '当前语言不支持，请切换语言',
            'service-not-allowed': '语音服务不可用',
            'bad-grammar': '语法配置错误',
            'engine-not-ready': (activeEngine.getInitError ? activeEngine.getInitError() : '引擎未就绪')
          };
          var msg = messages[err.error] || '识别错误: ' + (err.message || err.error);
          ui.showToast(msg, 3500, true);
        };

        // End
        recognizer.onEnd = function (info) {
          ui.setRecordingState(false);
          ui.stopTimer();
          ui.setStatus('ready', '就绪');

          if (finalText.trim()) {
            storage.add(finalText);
            ui.renderHistory(storage.getAll(), function (id) { deleteHistory(id); });
          }

          // Auto-restart (only for online engines that might time out)
          if (autoRestart && info && !info.intentional && activeEngineName === 'webspeech' && finalText.length > 0) {
            setTimeout(function () {
              if (!recognizer.isListening) {
                var r = recognizer.start();
                if (r.success) {
                  ui.setRecordingState(true);
                  ui.setStatus('listening', '录音中(自动恢复)');
                  ui.startTimer();
                }
              }
            }, 300);
          }
        };
      }

      function setupSpeechEvents() {
        // sherpa-onnx 和 Web Speech 都支持这些事件
        if (recognizer.onSpeechStart) {
          recognizer.onSpeechStart = function () { ui.setStatus('speech', '检测到语音'); ui.setSpeechActive(true); };
        }
        if (recognizer.onSpeechEnd) {
          recognizer.onSpeechEnd = function () { ui.setStatus('listening', '聆听中...'); ui.setSpeechActive(false); };
        }
        if (recognizer.onAudioStart) {
          recognizer.onAudioStart = function () { ui.setAudioActive(true); };
        }
        if (recognizer.onAudioEnd) {
          recognizer.onAudioEnd = function () { ui.setAudioActive(false); };
        }
        if (recognizer.onSoundStart) {
          recognizer.onSoundStart = function () { ui.setSpeechActive(true); };
        }
        if (recognizer.onSoundEnd) {
          recognizer.onSoundEnd = function () { ui.setSpeechActive(false); };
        }
      }
    }

    function toggleRecording() {
      if (recognizer.isListening) {
        autoRestart = false;
        recognizer.stop();
      } else {
        autoRestart = true;
        var result = recognizer.start();

        // 处理同步和异步（Promise）两种返回
        function handleStart(r) {
          if (r.success) {
            ui.setRecordingState(true);
            ui.setStatus('listening', '录音中');
            ui.startTimer();
          } else {
            ui.showToast(r.error, 3000, true);
          }
        }

        if (result && result.then) {
          result.then(handleStart).catch(function (err) {
            ui.showToast(err.message || '启动失败', 3000, true);
          });
        } else {
          handleStart(result);
        }
      }
    }

    function deleteHistory(id) {
      storage.remove(id);
      ui.renderHistory(storage.getAll(), function (i) { deleteHistory(i); });
    }

    function saveDraft() {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = setTimeout(function () {
        if (finalText.trim()) {
          localStorage.setItem('voice_input_draft', finalText);
        } else {
          localStorage.removeItem('voice_input_draft');
        }
      }, 500);
    }
  }

  // ==================== Boot ====================
  document.addEventListener('DOMContentLoaded', function () {
    new VoiceInputApp();
  });
})();

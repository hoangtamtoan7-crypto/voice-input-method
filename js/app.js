/**
 * 语音输入法 — 应用入口
 * 串联语音识别、文本处理、存储和UI模块
 */
import { SpeechRecognizer } from './speechRecognizer.js';
import { TextProcessor } from './textProcessor.js';
import { HistoryStorage } from './storage.js';
import { UIController } from './ui.js';

class VoiceInputApp {
  #recognizer;
  #storage;
  #ui;
  #finalText = '';

  constructor() {
    this.#recognizer = new SpeechRecognizer();
    this.#storage = new HistoryStorage();
    this.#ui = new UIController();
    this.#init();
  }

  #init() {
    // 浏览器不支持
    if (!this.#recognizer.isSupported) {
      this.#ui.setStatus('error', '浏览器不支持语音识别');
      this.#ui.recordBtn.disabled = true;
      this.#ui.recordHint.textContent = '请使用Chrome或Edge浏览器';
      this.#ui.showToast('当前浏览器不支持语音识别，请使用Chrome或Edge', 4000);
      return;
    }

    // 初始语言
    this.#recognizer.language = this.#ui.getLanguage();

    // 初始历史渲染
    this.#ui.renderHistory(this.#storage.getAll(), (id) => this.#deleteHistory(id));

    this.#bindEvents();
    this.#setupRecognizerCallbacks();
  }

  #bindEvents() {
    // 录音按钮
    this.#ui.recordBtn.addEventListener('click', () => this.#toggleRecording());

    // 语言切换
    this.#ui.langSelect.addEventListener('change', () => {
      this.#recognizer.language = this.#ui.getLanguage();
    });

    // 复制
    this.#ui.copyBtn.addEventListener('click', async () => {
      const result = await TextProcessor.copyToClipboard(this.#finalText);
      this.#ui.showToast(result.success ? '已复制到剪贴板' : result.error);
    });

    // 清空
    this.#ui.clearBtn.addEventListener('click', () => {
      this.#finalText = '';
      this.#ui.updateText('');
      this.#ui.showToast('已清空');
    });

    // 导出
    this.#ui.exportBtn.addEventListener('click', () => {
      const lang = this.#ui.getLanguage();
      const prefix = lang.startsWith('en') ? 'transcript' : '语音转录';
      const result = TextProcessor.exportToTxt(this.#finalText, prefix);
      if (!result.success) {
        this.#ui.showToast(result.error);
      }
    });
  }

  #setupRecognizerCallbacks() {
    this.#recognizer.onResult = ({ final, interim }) => {
      if (final) {
        const lang = this.#ui.getLanguage();
        this.#finalText += TextProcessor.fixPunctuation(final, lang);
      }
      this.#ui.updateText(this.#finalText, interim);
    };

    this.#recognizer.onError = ({ error }) => {
      this.#ui.setRecordingState(false);
      this.#ui.setStatus('ready', '就绪');
      const messages = {
        'not-allowed': '麦克风权限被拒绝',
        'no-speech': '未检测到语音',
        'audio-capture': '未找到麦克风设备',
        'network': '网络连接异常',
        'aborted': '录音被中断',
        'language-not-supported': '当前语言不支持',
        'service-not-allowed': '语音服务不可用',
        'bad-grammar': '语法错误',
      };
      const msg = messages[error] || `识别错误: ${error}`;
      this.#ui.showToast(msg, 3000);
    };

    this.#recognizer.onEnd = () => {
      this.#ui.setRecordingState(false);
      this.#ui.setStatus('ready', '就绪');
      // 录音结束后保存历史
      if (this.#finalText.trim()) {
        this.#storage.add(this.#finalText);
        this.#ui.renderHistory(this.#storage.getAll(), (id) => this.#deleteHistory(id));
      }
    };
  }

  #toggleRecording() {
    if (this.#recognizer.isListening) {
      this.#recognizer.stop();
    } else {
      const result = this.#recognizer.start();
      if (result.success) {
        this.#ui.setRecordingState(true);
        this.#ui.setStatus('listening', '录音中');
      } else {
        this.#ui.showToast(result.error, 3000);
      }
    }
  }

  #deleteHistory(id) {
    this.#storage.remove(id);
    this.#ui.renderHistory(this.#storage.getAll(), (i) => this.#deleteHistory(i));
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  new VoiceInputApp();
});

/**
 * 语音识别核心模块
 * 封装 Web Speech API，提供连续语音识别、多语言切换和错误处理
 */
export class SpeechRecognizer {
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

  get isSupported() {
    return this.#isSupported;
  }

  get isListening() {
    return this.#isListening;
  }

  set language(lang) {
    if (this.#recognition) {
      this.#recognition.lang = lang;
    }
  }

  set onResult(callback) {
    if (!this.#recognition) return;
    this.#recognition.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
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
    if (!this.#recognition) {
      return { success: false, error: '浏览器不支持语音识别' };
    }
    if (this.#isListening) {
      return { success: false, error: '已经在录音中' };
    }
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
    try {
      this.#recognition.stop();
    } catch (_) {
      // 忽略stop时的错误
    }
    this.#isListening = false;
  }

  destroy() {
    this.stop();
    this.#recognition = null;
  }
}

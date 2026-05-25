/**
 * sherpa-onnx 离线语音识别引擎
 * 纯本地识别，无需网络，无需VPN
 *
 * 使用前需下载 WASM 模型包到 js/sherpa/ 目录：
 * - sherpa-onnx-wasm-main-asr.js (Emscripten glue)
 * - sherpa-onnx-wasm-main-asr.wasm (WebAssembly SIMD)
 * - sherpa-onnx-wasm-main-asr.data (zh-en Zipformer 模型)
 * - sherpa-onnx-asr.js (ASR wrapper)
 */
var SherpaEngine = (function () {
  'use strict';

  // ==================== SherpaEngine ====================
  function SherpaEngine() {
    var isListening = false;
    var audioCapture = AudioCapture();
    var recognizer = null;
    var sherpaStream = null;
    var initPromise = null;
    var initError = null;
    var _isSupported = false;

    // Callbacks
    var resultCallback = null;
    var errorCallback = null;
    var endCallback = null;
    var speechStartCallback = null;
    var speechEndCallback = null;

    var currentLanguage = 'zh-CN';

    function loadScript(src) {
      return new Promise(function (resolve, reject) {
        var existing = document.querySelector('script[src="' + src + '"]');
        if (existing) { resolve(); return; }
        var script = document.createElement('script');
        script.src = src;
        script.onload = function () { resolve(); };
        script.onerror = function () { reject(new Error('Failed to load: ' + src)); };
        document.head.appendChild(script);
      });
    }

    function setupModule() {
      // Module MUST be configured before loading the WASM glue script
      if (typeof Module === 'undefined') {
        window.Module = {};
      }
      Module.locateFile = function (path) {
        return 'js/sherpa/' + path;
      };
      Module.setStatus = function (status) {
        console.log('[sherpa-onnx] ' + status);
      };
    }

    function init() {
      if (initPromise) return initPromise;

      var dbg = window._debugLog || function(){};
      dbg('[离线] 开始初始化...');

      initPromise = new Promise(function (resolve) {
        var resolved = false;
        var timeoutId = null;

        function finish(ok, err) {
          if (resolved) return;
          resolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          if (err) { initError = err; dbg('[离线] 初始化失败: ' + err); }
          else dbg('[离线] 初始化成功');
          resolve(ok);
        }

        // 超时保护：30 秒后若仍未初始化则报错
        timeoutId = setTimeout(function () {
          finish(false, '离线引擎加载超时。请使用 HTTP 服务器打开页面，或切换到百度引擎。');
        }, 30000);

        setupModule();

        var onReady = function () {
          try {
            if (typeof createOnlineRecognizer === 'undefined') {
              finish(false, 'ASR wrapper 未加载(createOnlineRecognizer未定义)');
              return;
            }
            recognizer = createOnlineRecognizer(Module);
            _isSupported = true;
            dbg('[离线] createOnlineRecognizer 成功');
            finish(true);
          } catch (e) {
            finish(false, '识别器初始化失败: ' + e.message);
          }
        };

        // Check if WASM already initialized
        if (Module.calledRun) {
          dbg('[离线] WASM 已初始化(复用)，直接创建识别器');
          onReady();
          return;
        }

        Module.onRuntimeInitialized = onReady;

        // Load WASM glue → ASR wrapper
        dbg('[离线] 加载 WASM glue...');
        loadScript('js/sherpa/sherpa-onnx-wasm-main-asr.js').then(function () {
          dbg('[离线] WASM glue 加载完成，加载 ASR wrapper...');
          return loadScript('js/sherpa/sherpa-onnx-asr.js');
        }).then(function () {
          dbg('[离线] ASR wrapper 加载完成，等待 WASM 初始化...');
        }).catch(function (err) {
          dbg('[离线] 脚本加载失败: ' + err.message);
          finish(false, 'sherpa-onnx 模型未安装。请运行: bash scripts/download-sherpa-models.sh');
        });
      });

      return initPromise;
    }

    // ========== Public API ==========

    return {
      get isSupported() { return _isSupported; },
      get isListening() { return isListening; },

      set language(lang) {
        currentLanguage = lang;
      },

      set onResult(cb) { resultCallback = cb; },
      set onError(cb) { errorCallback = cb; },
      set onEnd(cb) { endCallback = cb; },
      set onSpeechStart(cb) { speechStartCallback = cb; },
      set onSpeechEnd(cb) { speechEndCallback = cb; },

      start: function () {
        if (!_isSupported) {
          return init().then(function (ok) {
            if (!ok) {
              if (errorCallback) errorCallback({ error: 'engine-not-ready', message: initError });
              return { success: false, error: initError };
            }
            return startRecognition();
          });
        }
        return startRecognition();
      },

      stop: function () {
        if (!isListening) return;
        audioCapture.stop();

        if (sherpaStream && recognizer) {
          try {
            // Process any remaining audio
            sherpaStream.inputFinished();
            while (recognizer.isReady(sherpaStream)) {
              recognizer.decode(sherpaStream);
            }
            var result = recognizer.getResult(sherpaStream);
            if (result && result.text && resultCallback) {
              resultCallback({ final: result.text, interim: '' });
            }
          } catch (_) {}
          sherpaStream.free();
          sherpaStream = null;
        }
        isListening = false;
        if (endCallback) endCallback();
      },

      destroy: function () {
        this.stop();
        if (recognizer) { recognizer.free(); recognizer = null; }
      },

      getInitError: function () { return initError; }
    };

    function startRecognition() {
      if (isListening) return { success: false, error: '已经在录音中' };

      try {
        sherpaStream = recognizer.createStream();
      } catch (e) {
        if (errorCallback) errorCallback({ error: 'recognizer', message: e.message });
        return { success: false, error: e.message };
      }

      var speechStarted = false;

      return audioCapture.start(function (samples) {
        if (!sherpaStream || !recognizer) return;

        try {
          sherpaStream.acceptWaveform(16000, samples);

          while (recognizer.isReady(sherpaStream)) {
            recognizer.decode(sherpaStream);
          }

          var result = recognizer.getResult(sherpaStream);
          var isEndpoint = recognizer.isEndpoint(sherpaStream);

          if (result && result.text && resultCallback) {
            resultCallback({ final: result.text, interim: '' });
          }

          if (result && result.text && !speechStarted && speechStartCallback) {
            speechStarted = true;
            speechStartCallback();
          }

          if (isEndpoint) {
            if (speechStarted && speechEndCallback) {
              speechEndCallback();
            }
            speechStarted = false;
            recognizer.reset(sherpaStream);
          }
        } catch (_) {}
      }).then(function () {
        isListening = true;
        return { success: true };
      }).catch(function (err) {
        if (sherpaStream) { sherpaStream.free(); sherpaStream = null; }
        if (errorCallback) errorCallback({ error: 'audio-capture', message: err.message });
        return { success: false, error: err.message };
      });
    }
  }

  return SherpaEngine;
})();

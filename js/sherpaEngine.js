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

  // ==================== AudioCapture ====================
  function AudioCapture() {
    var audioContext = null;
    var source = null;
    var processor = null;
    var stream = null;
    var onSamples = null;
    var sampleRate = 16000;
    var isCapturing = false;

    var AudioContextClass = window.AudioContext || window.webkitAudioContext;

    function init() {
      if (!AudioContextClass) return Promise.reject(new Error('浏览器不支持AudioContext'));
      audioContext = new AudioContextClass({ sampleRate: sampleRate });
      if (audioContext.state === 'suspended') audioContext.resume();
      return navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1,
        sampleRate: sampleRate,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }}).then(function (mediaStream) {
        stream = mediaStream;
        source = audioContext.createMediaStreamSource(stream);
        var actualRate = audioContext.sampleRate;
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        source.connect(processor);
        // 零音量输出避免回声（ScriptProcessor 需要连接到 destination 才能触发 onaudioprocess）
        var zeroGain = audioContext.createGain();
        zeroGain.gain.value = 0;
        processor.connect(zeroGain);
        zeroGain.connect(audioContext.destination);

        processor.onaudioprocess = function (event) {
          if (!isCapturing || !onSamples) return;
          var input = event.inputBuffer.getChannelData(0);
          var samples;
          if (actualRate !== sampleRate) {
            var ratio = actualRate / sampleRate;
            var outLen = Math.floor(input.length / ratio);
            samples = new Float32Array(outLen);
            for (var i = 0; i < outLen; i++) {
              samples[i] = input[Math.floor(i * ratio)];
            }
          } else {
            samples = new Float32Array(input);
          }
          onSamples(samples);
        };
      });
    }

    return {
      start: function (callback) {
        if (isCapturing) return Promise.resolve();
        if (!audioContext) {
          return init().then(function () {
            isCapturing = true;
            onSamples = callback;
          });
        }
        isCapturing = true;
        onSamples = callback;
        return Promise.resolve();
      },
      stop: function () {
        isCapturing = false;
        onSamples = null;
        if (processor) { processor.disconnect(); processor = null; }
        if (source) { source.disconnect(); source = null; }
        if (stream) {
          stream.getTracks().forEach(function (t) { t.stop(); });
          stream = null;
        }
        if (audioContext && audioContext.state !== 'closed') {
          audioContext.close().catch(function () {});
        }
        audioContext = null;
      }
    };
  }

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

      initPromise = new Promise(function (resolve) {
        var resolved = false;
        var timeoutId = null;

        function finish(ok, err) {
          if (resolved) return;
          resolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          if (err) initError = err;
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
              finish(false, 'ASR wrapper 未加载');
              return;
            }
            recognizer = createOnlineRecognizer(Module);
            _isSupported = true;
            console.log('[sherpa-onnx] 离线引擎就绪');
            finish(true);
          } catch (e) {
            finish(false, '识别器初始化失败: ' + e.message);
          }
        };

        // Check if WASM already initialized
        if (Module.calledRun) {
          onReady();
          return;
        }

        Module.onRuntimeInitialized = onReady;

        // Load WASM glue → ASR wrapper
        loadScript('js/sherpa/sherpa-onnx-wasm-main-asr.js').then(function () {
          return loadScript('js/sherpa/sherpa-onnx-asr.js');
        }).catch(function (err) {
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

/**
 * sherpa-onnx 离线语音识别引擎
 * 纯本地识别，无需网络，无需VPN
 *
 * 使用方法：
 * 1. 运行 scripts/download-sherpa-models.sh 下载模型和WASM文件
 * 2. 此引擎自动检测文件是否存在，存在则使用离线引擎，否则回退到Web Speech API
 *
 * 接口与 SpeechRecognizer 完全一致，可无缝替换
 */
var SherpaEngine = (function () {
  'use strict';

  // ==================== AudioCapture ====================
  // 从浏览器麦克风捕获音频，重采样到 16kHz
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
      return navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1,
        sampleRate: sampleRate,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }}).then(function (mediaStream) {
        stream = mediaStream;
        source = audioContext.createMediaStreamSource(stream);

        // 如果需要重采样，创建离线处理
        var actualRate = audioContext.sampleRate;
        if (actualRate !== sampleRate) {
          // 使用 ScriptProcessorNode 进行降采样
          processor = audioContext.createScriptProcessor(4096, 1, 1);
          source.connect(processor);
          processor.connect(audioContext.destination);
        } else {
          processor = audioContext.createScriptProcessor(4096, 1, 1);
          source.connect(processor);
          processor.connect(audioContext.destination);
        }

        processor.onaudioprocess = function (event) {
          if (!isCapturing || !onSamples) return;
          var input = event.inputBuffer.getChannelData(0);
          var samples;

          if (actualRate !== sampleRate) {
            // 简单线性降采样
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
        if (isCapturing) return;
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
        if (processor) processor.disconnect();
        if (source) source.disconnect();
        if (stream) {
          stream.getTracks().forEach(function (t) { t.stop(); });
          stream = null;
        }
        if (audioContext && audioContext.state !== 'closed') {
          audioContext.close().catch(function () {});
        }
        audioContext = null;
        source = null;
        processor = null;
      },
      isCapturing: function () { return isCapturing; }
    };
  }

  // ==================== SherpaEngine ====================
  function SherpaEngine() {
    var isSupported = false;
    var isListening = false;
    var audioCapture = AudioCapture();

    // 回调
    var resultCallback = null;
    var errorCallback = null;
    var endCallback = null;
    var speechStartCallback = null;
    var speechEndCallback = null;

    // sherpa-onnx 对象
    var recognizer = null;
    var sherpaStream = null;
    var wasmModule = null;
    var initError = null;
    var initPromise = null;

    // 语言映射：Web Speech API BCP47 → sherpa model
    var supportedLanguages = ['zh-CN', 'en-US'];
    var currentLanguage = 'zh-CN';

    function init() {
      if (initPromise) return initPromise;

      initPromise = new Promise(function (resolve) {
        // 检查必需的 sherpa-onnx 文件是否存在
        var basePath = 'js/sherpa/';
        var requiredFiles = [
          basePath + 'sherpa-onnx-asr.js',
          basePath + 'model/encoder.onnx',
          basePath + 'model/decoder.onnx',
          basePath + 'model/joiner.onnx',
          basePath + 'model/tokens.txt'
        ];

        checkFiles(requiredFiles).then(function (allExist) {
          if (!allExist) {
            initError = 'sherpa-onnx 模型文件未安装。请运行 scripts/download-sherpa-models.sh 下载';
            isSupported = false;
            resolve(false);
            return;
          }

          // 加载 sherpa-onnx ASR wrapper
          loadScript(basePath + 'sherpa-onnx-asr.js').then(function () {
            // sherpa-onnx-asr.js 暴露全局 sherpa_onnx_asr 对象
            if (typeof sherpa_onnx_asr === 'undefined') {
              initError = 'sherpa-onnx ASR wrapper 加载失败';
              isSupported = false;
              resolve(false);
              return;
            }

            // 加载 WASM 运行时
            loadScript(basePath + 'sherpa-onnx-wasm-main-asr.js').then(function () {
              // WASM 胶水脚本会创建全局 Module
              if (typeof Module === 'undefined') {
                initError = 'sherpa-onnx WASM 运行时加载失败';
                isSupported = false;
                resolve(false);
                return;
              }

              wasmModule = Module;

              // 创建在线识别器配置
              try {
                var config = buildConfig(wasmModule, basePath + 'model/');
                recognizer = sherpa_onnx_asr.createOnlineRecognizer(wasmModule, config);
                isSupported = true;
                initError = null;
                resolve(true);
              } catch (e) {
                initError = 'sherpa-onnx 识别器初始化失败: ' + e.message;
                isSupported = false;
                resolve(false);
              }
            }).catch(function () {
              initError = 'sherpa-onnx WASM 运行时加载失败';
              isSupported = false;
              resolve(false);
            });
          }).catch(function () {
            initError = 'sherpa-onnx ASR wrapper 加载失败';
            isSupported = false;
            resolve(false);
          });
        });
      });

      return initPromise;
    }

    function buildConfig(Module, modelDir) {
      // 在 Emscripten 虚拟文件系统中创建模型文件
      var encoderData = loadModelData(modelDir + 'encoder.onnx');
      var decoderData = loadModelData(modelDir + 'decoder.onnx');
      var joinerData = loadModelData(modelDir + 'joiner.onnx');
      var tokensData = loadModelData(modelDir + 'tokens.txt');

      // 构建配置对象 - 参数与 sherpa-onnx-asr.js 兼容
      // 使用 transducer (Zipformer) 类型
      var config = {
        feat: {
          sampleRate: 16000,
          featureDim: 80
        },
        model: {
          transducer: {
            encoder: encoderData,
            decoder: decoderData,
            joiner: joinerData
          },
          tokens: new TextDecoder().decode(tokensData),
          numThreads: 2,
          provider: 'cpu',
          modelType: ''  // 空字符串表示 transducer
        },
        // 端点检测配置
        enableEndpoint: 1,
        rule1MinTrailingSilence: 1.2,
        rule2MinTrailingSilence: 0.5,
        rule3MinUtteranceLength: 20.0
      };
      return config;
    }

    // 同步读取文件（用于 Emscripten FS 预加载）
    // 注意：实际使用中模型文件通过 Emscripten --preload-file 预加载到虚拟 FS
    // 这里的 loadModelData 是占位 - 实际路径会被 WASM 胶水代码处理
    function loadModelData(path) {
      // 在浏览器中通过 fetch 同步不可行
      // 实际方法：模型文件在 WASM 编译时通过 --preload-file 打包进 .data 文件
      // Emscripten 在 Module.preRun 中自动将文件加载到虚拟 FS
      // 这里返回路径字符串，由 sherpa-onnx-asr 内部通过 FS 读取
      return path;
    }

    function checkFiles(files) {
      return Promise.all(files.map(function (f) {
        return fetch(f, { method: 'HEAD' }).then(function (r) {
          return r.ok;
        }).catch(function () {
          return false;
        });
      })).then(function (results) {
        return results.every(function (r) { return r; });
      });
    }

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

    // ========== Public API (与 SpeechRecognizer 接口一致) ==========

    return {
      get isSupported() { return isSupported; },
      get isListening() { return isListening; },

      set language(lang) {
        // sherpa-onnx 模型固定语言，运行时不可切换
        // SenseVoice 支持多语言自动检测
        currentLanguage = lang;
      },

      set onResult(cb) { resultCallback = cb; },
      set onError(cb) { errorCallback = cb; },
      set onEnd(cb) { endCallback = cb; },
      set onSpeechStart(cb) { speechStartCallback = cb; },
      set onSpeechEnd(cb) { speechEndCallback = cb; },

      start: function () {
        if (!isSupported) {
          // 首次调用时尝试初始化
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
          // 处理剩余音频
          if (recognizer.isReady(sherpaStream)) {
            recognizer.decode(sherpaStream);
            var result = recognizer.getResult(sherpaStream);
            if (result && resultCallback) {
              resultCallback({ final: result, interim: '' });
            }
          }
          recognizer.reset(sherpaStream);
        }
        isListening = false;
        if (endCallback) endCallback();
      },

      destroy: function () {
        this.stop();
        recognizer = null;
        wasmModule = null;
      },

      getInitError: function () { return initError; }
    };

    function startRecognition() {
      if (isListening) return { success: false, error: '已经在录音中' };

      var startPromise = audioCapture.start(function (samples) {
        if (!sherpaStream || !recognizer) return;
        sherpaStream.acceptWaveform(16000, samples);

        while (recognizer.isReady(sherpaStream)) {
          recognizer.decode(sherpaStream);
        }

        var result = recognizer.getResult(sherpaStream);
        var isEndpoint = recognizer.isEndpoint(sherpaStream);

        if (result && resultCallback) {
          resultCallback({ final: result, interim: '' });
        }

        if (isEndpoint) {
          recognizer.reset(sherpaStream);
        }
      });

      return startPromise.then(function () {
        if (recognizer) {
          sherpaStream = recognizer.createStream();
        }
        isListening = true;
        return { success: true };
      }).catch(function (err) {
        if (errorCallback) errorCallback({ error: 'audio-capture', message: err.message });
        return { success: false, error: err.message };
      });
    }
  }

  return SherpaEngine;
})();

/**
 * 百度实时语音识别引擎
 * WebSocket 流式识别，国内直连，免费5万次/天
 *
 * 使用前需在 https://console.bce.baidu.com/ 注册应用获取 API Key
 * 然后将凭据填入下面的 BAIDU_CONFIG
 *
 * 接口与 SpeechRecognizer / SherpaEngine 完全一致
 */
var BaiduEngine = (function () {
  'use strict';

  // ========== 配置（在此填入百度API凭据） ==========
  var BAIDU_CONFIG = {
    appid: '123422897',       // 百度智能云 AppID
    appkey: '63jFK1A0I83WeUGQcbuOmJDY',      // 百度智能云 API Key
    secret: 'xPr3Z7v4NGNdeL3qfOOirv5JdEo3HgkM',      // 百度智能云 Secret Key
    dev_pid: 15372,  // 识别模型: 1537=普通话(弱标点) 15372=普通话(加强标点) 1737=英语
    wsUrl: 'wss://vop.baidu.com/realtime_asr'
  };

  // 语言 → dev_pid 映射
  var LANG_TO_PID = {
    'zh-CN': 15372,
    'cmn-Hans-CN': 15372,
    'en-US': 1737,
    'yue-Hant-HK': 15376  // 多方言模型，支持粤语
  };

  // ========== 音频捕获 ==========
  function AudioCapture() {
    var audioContext = null;
    var source = null;
    var processor = null;
    var stream = null;
    var onSamples = null;
    var sampleRate = 16000;
    var isCapturing = false;

    function init() {
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return Promise.reject(new Error('浏览器不支持AudioContext'));
      audioContext = new AudioContextClass({ sampleRate: sampleRate });

      return navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: sampleRate, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      }).then(function (mediaStream) {
        stream = mediaStream;
        source = audioContext.createMediaStreamSource(stream);
        var actualRate = audioContext.sampleRate;
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        source.connect(processor);
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
            for (var i = 0; i < outLen; i++) samples[i] = input[Math.floor(i * ratio)];
          } else {
            samples = new Float32Array(input);
          }
          onSamples(samples);
        };
      });
    }

    return {
      start: function (cb) {
        if (isCapturing) return Promise.resolve();
        if (!audioContext) {
          return init().then(function () { isCapturing = true; onSamples = cb; });
        }
        isCapturing = true;
        onSamples = cb;
        return Promise.resolve();
      },
      stop: function () {
        isCapturing = false; onSamples = null;
        if (processor) { processor.disconnect(); processor = null; }
        if (source) { source.disconnect(); source = null; }
        if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
        if (audioContext && audioContext.state !== 'closed') { audioContext.close().catch(function () {}); audioContext = null; }
      }
    };
  }

  // ========== Float32 PCM → Int16 PCM（小端） ==========
  function float32ToInt16(float32) {
    var int16 = new Int16Array(float32.length);
    for (var i = 0; i < float32.length; i++) {
      var s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

  // ========== 生成 access token（若需要） ==========
  // 百度 WebSocket API 可直接使用 appkey，不一定需要 access token
  // 如需 token 方式鉴权，参考: https://ai.baidu.com/ai-doc/REFERENCE/Ck3dwjhha

  // ========== BaiduEngine ==========
  function BaiduEngine() {
    var isListening = false;
    var audioCapture = AudioCapture();
    var ws = null;
    var sn = ''; // 会话ID

    // 回调
    var resultCallback = null;
    var errorCallback = null;
    var endCallback = null;
    var speechStartCallback = null;
    var speechEndCallback = null;

    var currentLanguage = 'zh-CN';
    var currentPid = BAIDU_CONFIG.dev_pid;

    function getSn() {
      return 'ws-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    }

    function isConfigured() {
      return !!(BAIDU_CONFIG.appid && BAIDU_CONFIG.appkey);
    }

    return {
      get isSupported() { return true; }, // 百度云国内直连
      get isListening() { return isListening; },
      get isConfigured() { return isConfigured(); },

      set language(lang) {
        currentLanguage = lang;
        currentPid = LANG_TO_PID[lang] || BAIDU_CONFIG.dev_pid;
      },

      set onResult(cb) { resultCallback = cb; },
      set onError(cb) { errorCallback = cb; },
      set onEnd(cb) { endCallback = cb; },
      set onSpeechStart(cb) { speechStartCallback = cb; },
      set onSpeechEnd(cb) { speechEndCallback = cb; },

      start: function () {
        if (isListening) return { success: false, error: '已经在录音中' };
        if (!isConfigured()) return { success: false, error: '百度API未配置，请在 js/baiduEngine.js 中填入 appid/appkey' };

        sn = getSn();
        var url = BAIDU_CONFIG.wsUrl + '?sn=' + sn;

        try {
          ws = new WebSocket(url);
        } catch (e) {
          return { success: false, error: 'WebSocket连接失败: ' + e.message };
        }

        ws.binaryType = 'arraybuffer';
        var self = this;
        var connected = false;

        ws.onopen = function () {
          // 发送 START 帧
          ws.send(JSON.stringify({
            type: 'START',
            data: {
              appid: parseInt(BAIDU_CONFIG.appid),
              appkey: BAIDU_CONFIG.appkey,
              dev_pid: currentPid,
              cuid: 'voice-input-' + (BAIDU_CONFIG.appid),
              format: 'pcm',
              sample: 16000
            }
          }));
        };

        var speechStarted = false;

        ws.onmessage = function (event) {
          try {
            var msg = JSON.parse(event.data);
          } catch (_) { return; }

          if (msg.err_no !== 0 && msg.err_no !== undefined) {
            if (errorCallback) errorCallback({ error: 'baidu-api', message: msg.err_msg || '百度API错误 ' + msg.err_no });
            return;
          }

          if (msg.type === 'MID_TEXT') {
            if (!speechStarted && speechStartCallback) { speechStarted = true; speechStartCallback(); }
            if (resultCallback) resultCallback({ final: '', interim: msg.result || '' });
          } else if (msg.type === 'FIN_TEXT') {
            if (speechStarted && speechEndCallback) { speechEndCallback(); speechStarted = false; }
            if (resultCallback) resultCallback({ final: msg.result || '', interim: '' });
          }
        };

        ws.onerror = function (e) {
          if (errorCallback) errorCallback({ error: 'network', message: '百度服务连接失败' });
        };

        ws.onclose = function () {
          isListening = false;
          audioCapture.stop();
          if (endCallback) endCallback();
        };

        // 开始音频捕获
        return audioCapture.start(function (samples) {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          var int16Data = float32ToInt16(samples);
          var chunkSize = 2560; // ~80ms per chunk (16000 * 0.08 * 2 bytes)
          for (var offset = 0; offset < int16Data.length; offset += chunkSize) {
            var chunk = int16Data.slice(offset, offset + chunkSize);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(chunk.buffer);
            }
          }
        }).then(function () {
          isListening = true;
          connected = true;
          return { success: true };
        }).catch(function (err) {
          if (ws) { ws.close(); ws = null; }
          return { success: false, error: err.message };
        });
      },

      stop: function () {
        if (!isListening) return;
        audioCapture.stop();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'FINISH' }));
        }
        isListening = false;
        // onclose 会触发 endCallback
      },

      destroy: function () {
        this.stop();
        if (ws) { ws.close(); ws = null; }
      }
    };
  }

  return BaiduEngine;
})();

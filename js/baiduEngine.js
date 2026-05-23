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
    appid: '123427753',       // 百度智能云 AppID
    appkey: '7XY6mrmLuUxvpEM6bhuGGF7a',      // 百度智能云 API Key
    secret: 'AmWWRC68o1Gxz9vjtk98iKmUG0lcSr0E',      // 百度智能云 Secret Key
    dev_pid: 1537,   // 识别模型: 1537=普通话(通用) 15372=普通话(加强标点) 1737=英语
    wsUrl: 'wss://vop.baidu.com/realtime_asr'
  };

  // 语言 → dev_pid 映射
  var LANG_TO_PID = {
    'zh-CN': 1537,
    'cmn-Hans-CN': 1537,
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
      if (audioContext.state === 'suspended') audioContext.resume();

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

  // ========== OAuth Token 管理 ==========
  var tokenCache = null;
  var tokenExpiry = 0;

  function fetchToken() {
    var dbg = window._debugLog || function(){};
    if (tokenCache && Date.now() < tokenExpiry) {
      dbg('[百度] 使用缓存的 access token');
      return Promise.resolve(tokenCache);
    }
    var url = 'https://aip.baidubce.com/oauth/2.0/token'
      + '?grant_type=client_credentials'
      + '&client_id=' + encodeURIComponent(BAIDU_CONFIG.appkey)
      + '&client_secret=' + encodeURIComponent(BAIDU_CONFIG.secret);
    dbg('[百度] 获取 access token...');
    return fetch(url, { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.access_token) {
          tokenCache = data.access_token;
          tokenExpiry = Date.now() + (data.expires_in || 2592000) * 1000 - 60000;
          dbg('[百度] access token 已获取，有效期: ' + (data.expires_in || 2592000) + '秒');
          return tokenCache;
        }
        throw new Error(data.error_description || data.error || '获取access token失败');
      });
  }

  // ========== BaiduEngine ==========
  function BaiduEngine() {
    var isListening = false;
    var audioCapture = AudioCapture();
    var ws = null;
    var sn = ''; // 会话ID
    var tokenPromise = null; // 正在获取中的token

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
      return !!(BAIDU_CONFIG.appid && BAIDU_CONFIG.appkey && BAIDU_CONFIG.secret);
    }

    function doStart(token) {
      var dbg = window._debugLog || function(){};
      sn = getSn();
      var url = BAIDU_CONFIG.wsUrl + '?sn=' + sn;
      dbg('[百度] 连接: ' + url);

      try {
        ws = new WebSocket(url);
      } catch (e) {
        dbg('[百度] WebSocket创建失败: ' + e.message);
        return { success: false, error: 'WebSocket连接失败: ' + e.message };
      }

      ws.binaryType = 'arraybuffer';
      var wsOpened = false;
      var totalBytesSent = 0;
      var resultCount = 0;
      var audioBuffer = [];

      ws.onopen = function () {
        wsOpened = true;
        var startData = {
          appid: parseInt(BAIDU_CONFIG.appid),
          dev_pid: currentPid,
          cuid: 'voice-input-' + (BAIDU_CONFIG.appid),
          format: 'pcm',
          sample: 16000
        };
        if (token) {
          startData.token = token;
          dbg('[百度] WebSocket 已连接，发送 START 帧(token鉴权)');
        } else {
          startData.appkey = BAIDU_CONFIG.appkey;
          dbg('[百度] WebSocket 已连接，发送 START 帧(appkey鉴权)');
        }
        ws.send(JSON.stringify({ type: 'START', data: startData }));
        if (audioBuffer.length > 0) {
          dbg('[百度] 发送缓存音频: ' + audioBuffer.length + ' 块');
          for (var i = 0; i < audioBuffer.length; i++) {
            if (ws.readyState === WebSocket.OPEN) ws.send(audioBuffer[i]);
          }
          audioBuffer = [];
        }
      };

      var speechStarted = false;

      ws.onmessage = function (event) {
        var raw = '';
        if (typeof event.data === 'string') {
          raw = event.data;
          try {
            var msg = JSON.parse(event.data);
          } catch (_) { dbg('[百度] 收到文本(非JSON): ' + event.data.slice(0, 100)); return; }
        } else {
          dbg('[百度] 收到二进制: ' + event.data.byteLength + ' bytes');
          return;
        }

        dbg('[百度] 收到: ' + raw.slice(0, 200));

        if (msg.err_no !== 0 && msg.err_no !== undefined) {
          dbg('[百度] API错误: err_no=' + msg.err_no + ' msg=' + msg.err_msg);
          if (errorCallback) errorCallback({ error: 'baidu-api', message: msg.err_msg || '百度API错误 ' + msg.err_no });
          return;
        }

        if (msg.type === 'MID_TEXT') {
          resultCount++;
          if (!speechStarted && speechStartCallback) { speechStarted = true; speechStartCallback(); }
          if (resultCallback) resultCallback({ final: '', interim: msg.result || '' });
        } else if (msg.type === 'FIN_TEXT') {
          resultCount++;
          dbg('[百度] 识别结果(' + resultCount + '): ' + (msg.result || '').slice(0, 40));
          if (speechStarted && speechEndCallback) { speechEndCallback(); speechStarted = false; }
          if (resultCallback) resultCallback({ final: msg.result || '', interim: '' });
        }
      };

      ws.onerror = function (e) {
        dbg('[百度] WebSocket error');
        if (errorCallback) errorCallback({ error: 'network', message: '百度服务连接失败' });
      };

      ws.onclose = function (e) {
        dbg('[百度] WebSocket 关闭 code=' + e.code + ' sent=' + totalBytesSent + ' bytes results=' + resultCount);
        isListening = false;
        audioCapture.stop();
        audioBuffer = [];
        if (endCallback) endCallback();
      };

      // 开始音频捕获
      var audioLogCounter = 0;
      return audioCapture.start(function (samples) {
        if (!ws) return;
        // 每 50 次(约2秒)输出一次音量
        audioLogCounter++;
        if (audioLogCounter <= 3 || audioLogCounter % 20 === 0) {
          var rms = 0;
          for (var j = 0; j < samples.length; j++) rms += samples[j] * samples[j];
          rms = Math.sqrt(rms / samples.length);
          dbg('[百度] 音频音量: ' + (rms * 100).toFixed(1) + '% (0=静音, >5%=有声)');
        }
        var int16Data = float32ToInt16(samples);
        var chunkSize = 2560;
        for (var offset = 0; offset < int16Data.length; offset += chunkSize) {
          var chunk = int16Data.slice(offset, offset + chunkSize);
          var buf = chunk.buffer.slice(0);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(buf);
            totalBytesSent += buf.byteLength;
          } else if (!wsOpened) {
            audioBuffer.push(buf);
          }
        }
      }).then(function () {
        isListening = true;
        dbg('[百度] 音频捕获开始, wsOpen=' + wsOpened + ' buffered=' + audioBuffer.length);
        return { success: true };
      }).catch(function (err) {
        dbg('[百度] 音频捕获失败: ' + err.message);
        if (ws) { ws.close(); ws = null; }
        return { success: false, error: err.message };
      });
    }

    return {
      get isSupported() { return true; },
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
        if (!isConfigured()) return { success: false, error: '百度API未配置，请在 js/baiduEngine.js 中填入 appid/appkey/secret' };

        var dbg = window._debugLog || function(){};

        // 尝试获取 token，失败则降级为 appkey 直接鉴权
        if (!tokenPromise) tokenPromise = fetchToken();
        return tokenPromise.then(function (token) {
          tokenPromise = null;
          return doStart(token);
        }).catch(function (err) {
          tokenPromise = null;
          dbg('[百度] Token获取失败，降级使用 appkey 鉴权: ' + err.message);
          return doStart(null); // null → 使用 appkey 模式
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

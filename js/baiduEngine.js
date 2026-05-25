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
    dev_pid: 15373,  // 识别模型: 15373=普通话(输入法优化) 1537=普通话(通用) 15372=普通话(加强标点)
    wsUrl: 'wss://vop.baidu.com/realtime_asr'
  };

  // 语言 → dev_pid 映射
  var LANG_TO_PID = {
    'zh-CN': 15373,
    'cmn-Hans-CN': 15373,
    'en-US': 1737,
    'yue-Hant-HK': 15376  // 多方言模型，支持粤语
  };

  // ========== Float32 PCM → Int16 PCM（小端） ==========
  function float32ToInt16(float32) {
    var int16 = new Int16Array(float32.length);
    for (var i = 0; i < float32.length; i++) {
      var s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

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
      return !!(BAIDU_CONFIG.appid && BAIDU_CONFIG.appkey && BAIDU_CONFIG.secret);
    }

    function doStart() {
      var dbg = window._debugLog || function(){};
      sn = getSn();
      var url = BAIDU_CONFIG.wsUrl + '?sn=' + sn;

      dbg('[百度] 连接 WebSocket: ' + url);
      try {
        ws = new WebSocket(url);
      } catch (e) {
        dbg('[百度] WebSocket 创建失败: ' + e.message, 'error');
        return { success: false, error: 'WebSocket连接失败: ' + e.message };
      }

      ws.binaryType = 'arraybuffer';
      var wsOpened = false;
      var totalBytesSent = 0;
      var resultCount = 0;
      var audioBuffer = [];

      ws.onopen = function () {
        wsOpened = true;
        dbg('[百度] WebSocket 已连接');
        var startData = {
          appid: parseInt(BAIDU_CONFIG.appid),
          appkey: BAIDU_CONFIG.appkey,
          dev_pid: currentPid,
          cuid: 'voice-input-' + (BAIDU_CONFIG.appid),
          format: 'pcm',
          sample: 16000
        };
        dbg('[百度] 发送 START: dev_pid=' + currentPid + ' appkey鉴权');
        ws.send(JSON.stringify({ type: 'START', data: startData }));
        if (audioBuffer.length > 0) {
          dbg('[百度] 发送缓冲音频: ' + audioBuffer.length + ' 块');
          for (var i = 0; i < audioBuffer.length; i++) {
            if (ws.readyState === WebSocket.OPEN) ws.send(audioBuffer[i]);
          }
          audioBuffer = [];
        }
      };

      var speechStarted = false;

      ws.onmessage = function (event) {
        if (typeof event.data !== 'string') return;
        try {
          var msg = JSON.parse(event.data);
        } catch (_) { return; }

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
          if (speechStarted && speechEndCallback) { speechEndCallback(); speechStarted = false; }
          if (resultCallback) resultCallback({ final: msg.result || '', interim: '' });
        }
      };

      ws.onerror = function (e) {
        dbg('[百度] WebSocket error');
        if (errorCallback) errorCallback({ error: 'network', message: '百度服务连接失败' });
      };

      ws.onclose = function (e) {
        dbg('[百度] WebSocket 关闭: code=' + (e && e.code) + ' reason=' + (e && e.reason));
        isListening = false;
        audioCapture.stop();
        audioBuffer = [];
        if (endCallback) endCallback();
      };

      // 开始音频捕获
      dbg('[百度] 启动音频捕获...');
      return audioCapture.start(function (samples) {
        if (!ws) return;
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
        dbg('[百度] 开始启动 (appkey直接鉴权)...');
        return doStart();
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

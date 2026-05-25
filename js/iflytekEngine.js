/**
 * 讯飞实时语音识别引擎 (iFlytek IAT)
 * WebSocket 流式识别，国内直连，中文识别准确率业界领先
 *
 * 接口与 BaiduEngine / SherpaEngine 完全一致
 */
var IflytekEngine = (function () {
  'use strict';

  // ========== 配置 ==========
  var IFLYTEK_CONFIG = {
    appId: '974801dc',
    apiKey: '344a996e36e58d6f18c1b9e2afa5bfd0',
    apiSecret: 'MzBiZjFhZDg1ZjUyMjViNTRiYWZkMTc1',
    host: 'iat-api.xfyun.cn',
    path: '/v2/iat'
  };

  // 语言映射
  var LANG_MAP = {
    'zh-CN': 'zh_cn',
    'cmn-Hans-CN': 'zh_cn',
    'en-US': 'en_us',
    'yue-Hant-HK': 'zh_cn',  // 讯飞支持粤语，用相同语言代码
    'ja-JP': 'ja_jp',
    'ko-KR': 'ko_kr',
    'fr-FR': 'fr_fr',
    'de-DE': 'de_de',
    'es-ES': 'es_es',
    'pt-BR': 'pt_br'
  };

  // ========== 工具函数 ==========

  /** Float32 → Int16 PCM (小端) */
  function float32ToInt16(float32) {
    var int16 = new Int16Array(float32.length);
    for (var i = 0; i < float32.length; i++) {
      var s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

  /** Uint8Array → Base64 */
  function arrayToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /** Int16Array → Base64 (PCM) */
  function int16ToBase64(int16) {
    return arrayToBase64(new Uint8Array(int16.buffer));
  }

  /** Generate HMAC-SHA256 signed WebSocket URL */
  async function generateAuthUrl() {
    var date = new Date().toUTCString();
    var signatureOrigin = 'host: ' + IFLYTEK_CONFIG.host + '\ndate: ' + date + '\nGET ' + IFLYTEK_CONFIG.path + ' HTTP/1.1';

    var encoder = new TextEncoder();
    var key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(IFLYTEK_CONFIG.apiSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    var sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signatureOrigin));
    var sigBase64 = btoa(String.fromCharCode.apply(null, new Uint8Array(sig)));

    var authOrigin = 'api_key="' + IFLYTEK_CONFIG.apiKey + '", algorithm="hmac-sha256", headers="host date request-line", signature="' + sigBase64 + '"';
    var authorization = btoa(authOrigin);

    return 'wss://' + IFLYTEK_CONFIG.host + IFLYTEK_CONFIG.path
      + '?authorization=' + encodeURIComponent(authorization)
      + '&date=' + encodeURIComponent(date)
      + '&host=' + IFLYTEK_CONFIG.host;
  }

  // ========== IflytekEngine ==========
  function IflytekEngine() {
    var isListening = false;
    var audioCapture = AudioCapture();
    var ws = null;

    var resultCallback = null;
    var errorCallback = null;
    var endCallback = null;
    var speechStartCallback = null;
    var speechEndCallback = null;

    var currentLanguage = 'zh-CN';
    var allFinalText = '';
    var hasSpeechStarted = false;

    function doStart() {
      var dbg = window._debugLog || function(){};

      return generateAuthUrl().then(function (wsUrl) {
        dbg('[讯飞] 连接 WebSocket...');
        try {
          ws = new WebSocket(wsUrl);
        } catch (e) {
          dbg('[讯飞] WebSocket 创建失败: ' + e.message, 'error');
          return { success: false, error: 'WebSocket连接失败: ' + e.message };
        }

        ws.binaryType = 'arraybuffer';
        var wsOpened = false;
        var audioBuffer = [];
        allFinalText = '';
        hasSpeechStarted = false;

        ws.onopen = function () {
          wsOpened = true;
          dbg('[讯飞] WebSocket 已连接');
          // 发送缓冲音频
          if (audioBuffer.length > 0) {
            dbg('[讯飞] 发送缓冲音频: ' + audioBuffer.length + ' 帧');
            for (var i = 0; i < audioBuffer.length; i++) {
              if (ws.readyState === WebSocket.OPEN) ws.send(audioBuffer[i]);
            }
            audioBuffer = [];
          }
        };

        ws.onmessage = function (event) {
          var msg;
          try {
            msg = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data));
          } catch (_) { return; }

          if (msg.code !== 0 && msg.code !== undefined) {
            dbg('[讯飞] API错误: code=' + msg.code + ' msg=' + msg.message);
            if (errorCallback) errorCallback({ error: 'iflytek-api', message: msg.message || '讯飞API错误 ' + msg.code });
            return;
          }

          var data = msg.data;
          if (!data || !data.result) return;

          var wsResult = data.result.ws;
          if (!wsResult) return;

          var interimText = '';
          var finalChunk = '';

          for (var i = 0; i < wsResult.length; i++) {
            var seg = wsResult[i];
            var segText = '';
            if (seg.cw) {
              for (var j = 0; j < seg.cw.length; j++) {
                segText += seg.cw[j].w || '';
              }
            }
            if (seg.ls) {
              finalChunk += segText;
            } else {
              interimText += segText;
            }
          }

          if (finalChunk) {
            if (!hasSpeechStarted && speechStartCallback) {
              hasSpeechStarted = true;
              speechStartCallback();
            }
            allFinalText += finalChunk;
            if (speechEndCallback) speechEndCallback();
          }

          if (resultCallback) {
            resultCallback({ final: finalChunk, interim: interimText });
          }
        };

        ws.onerror = function () {
          dbg('[讯飞] WebSocket error');
          if (errorCallback) errorCallback({ error: 'network', message: '讯飞服务连接失败' });
        };

        ws.onclose = function () {
          dbg('[讯飞] WebSocket 关闭');
          isListening = false;
          audioCapture.stop();
          audioBuffer = [];
          if (hasSpeechStarted && speechEndCallback) speechEndCallback();
          if (endCallback) endCallback();
        };

        // 发送第一帧 (status=0)
        var firstFrame = JSON.stringify({
          common: { app_id: IFLYTEK_CONFIG.appId },
          business: {
            language: LANG_MAP[currentLanguage] || 'zh_cn',
            domain: 'iat',
            accent: 'mandarin',
            ptt: 0,       // 标点: 0=无 1=有
            rlang: 'zh-cn',
            vinfo: 1,
            nunum: 1,     // 数字转阿拉伯
            vad_eos: 3000 // VAD 尾端点检测 3s
          },
          data: {
            status: 0,
            format: 'audio/L16;rate=16000',
            encoding: 'raw',
            audio: ''
          }
        });
        ws.send(firstFrame);

        // 开始音频捕获
        dbg('[讯飞] 启动音频捕获...');
        return audioCapture.start(function (samples) {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          var int16 = float32ToInt16(samples);
          var chunkSize = 2560; // ~160ms @ 16kHz
          for (var offset = 0; offset < int16.length; offset += chunkSize) {
            var chunk = int16.slice(offset, offset + chunkSize);
            var base64 = int16ToBase64(chunk);
            var frame = JSON.stringify({
              data: {
                status: 1,
                format: 'audio/L16;rate=16000',
                encoding: 'raw',
                audio: base64
              }
            });
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(frame);
            } else if (!wsOpened) {
              audioBuffer.push(frame);
            }
          }
        }).then(function () {
          isListening = true;
          return { success: true };
        }).catch(function (err) {
          dbg('[讯飞] 音频捕获失败: ' + err.message);
          if (ws) { ws.close(); ws = null; }
          return { success: false, error: err.message };
        });
      }).catch(function (err) {
        return { success: false, error: '鉴权签名失败: ' + err.message };
      });
    }

    return {
      get isSupported() { return !!(window.crypto && window.crypto.subtle); },
      get isListening() { return isListening; },

      set language(lang) { currentLanguage = lang; },

      set onResult(cb) { resultCallback = cb; },
      set onError(cb) { errorCallback = cb; },
      set onEnd(cb) { endCallback = cb; },
      set onSpeechStart(cb) { speechStartCallback = cb; },
      set onSpeechEnd(cb) { speechEndCallback = cb; },

      start: function () {
        if (isListening) return { success: false, error: '已经在录音中' };
        return doStart();
      },

      stop: function () {
        if (!isListening) return;
        audioCapture.stop();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' }
          }));
        }
        isListening = false;
      },

      destroy: function () {
        this.stop();
        if (ws) { ws.close(); ws = null; }
      }
    };
  }

  return IflytekEngine;
})();

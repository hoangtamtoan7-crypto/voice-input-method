/**
 * 共享音频捕获模块
 * 供所有识别引擎复用，避免代码重复
 */
var AudioCapture = (function () {
  'use strict';

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
      return navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: sampleRate,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
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
      start: function (callback) {
        if (isCapturing) return Promise.resolve();
        if (!audioContext) {
          return init().then(function () { isCapturing = true; onSamples = callback; });
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
        if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
        if (audioContext && audioContext.state !== 'closed') { audioContext.close().catch(function () {}); }
        audioContext = null;
      },
      getSampleRate: function () { return sampleRate; }
    };
  }

  return AudioCapture;
})();

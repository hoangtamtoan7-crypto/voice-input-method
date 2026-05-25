/**
 * 语音输入法 - Preload 脚本
 *
 * 通过 contextBridge 安全暴露主进程 API 给渲染进程
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ========== 渲染进程 → 主进程 ==========

  /** 录音完成，发送识别文本到主进程 */
  recordingResult: (text) => ipcRenderer.invoke('recording-result', text),

  /** 取消录音 */
  cancelRecording: () => ipcRenderer.invoke('cancel-recording'),

  /** 流式发送识别文本（录音过程中实时调用） */
  streamText: (text) => ipcRenderer.invoke('stream-text', text),

  // ========== 主进程 → 渲染进程 ==========

  /** 监听开始录音指令 */
  onStartRecording: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('start-recording', handler);
    return () => ipcRenderer.removeListener('start-recording', handler);
  },

  /** 监听停止录音指令 */
  onStopRecording: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('stop-recording', handler);
    return () => ipcRenderer.removeListener('stop-recording', handler);
  },

  /** 监听引擎切换指令 */
  onSetEngine: (callback) => {
    const handler = (_event, engine) => callback(engine);
    ipcRenderer.on('set-engine', handler);
    return () => ipcRenderer.removeListener('set-engine', handler);
  },

  // ========== 工具 ==========

  /** 获取当前窗口模式 */
  getMode: () => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') || 'full';
  },

  /** 是否在 Electron 环境中 */
  isElectron: true
});

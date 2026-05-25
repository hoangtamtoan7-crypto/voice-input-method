# 语音输入法 (Voice Input Method)

Electron 桌面语音输入应用，三引擎智能路由架构。**全局热键唤起，语音转文字自动粘贴到任意应用**——离线、国内直连、云端全覆盖。

> 七牛云 XEngineer 暑期实训营 · 题目一

## Demo 视频

> [待上传至 B站/网盘后放置链接]

## 解决的问题

- **网页输入法无法在系统全局使用**——Electron 桌面应用 + 全局快捷键 + 自动粘贴
- **国内用户无法使用 Google Web Speech API**（需 VPN）
- **网络不稳定导致识别中断**——自动降级切换引擎
- **隐私场景**需要纯本地识别，不上传音频到服务器

## 使用方式

```bash
npm install   # 首次需要安装依赖（Electron 约 150MB）
npm start     # 启动应用
```

1. 应用启动后，系统托盘出现麦克风图标
2. 在**任意应用**（记事本、Word、微信、浏览器…）中按 `Ctrl+Shift+Space`
3. 屏幕中央弹出录音窗口，开始说话
4. 再按一次 `Ctrl+Shift+Space` 停止，**文字自动粘贴到光标位置**

## 功能特性

| 特性 | 说明 |
|------|------|
| **全局热键** | Ctrl+Shift+Space 在任意应用中唤起语音输入 |
| **自动粘贴** | 识别完成后自动粘贴到当前光标位置 |
| **三引擎智能路由** | 离线(sherpa-onnx) → 百度实时ASR(国内直连) → Web Speech(在线降级) |
| **一键切换引擎** | 托盘菜单或点击引擎徽章手动切换 |
| **实时流式识别** | 边说边出字，支持 interim(临时) + final(最终) 结果 |
| **端点检测** | 内置 VAD，自动断句，长句不丢失 |
| **多语言** | 中文普通话、粤语、英语、日语、韩语等 10+ 语言 |
| **音频可视化** | 7段波形，区分 sound/speech 状态 |
| **标点快捷栏** | 11个常用标点一键插入，支持换行 |
| **撤销历史** | 最多30步，Ctrl+Z 撤销 |
| **键盘快捷键** | Space 录音、Ctrl+Z 撤销、Ctrl+C 复制、Ctrl+S 导出 TXT |
| **草稿自动保存** | localStorage 自动保存，刷新不丢失 |
| **历史记录** | 转录历史，点击回填，单条删除 |
| **深色/浅色主题** | 跟随系统或手动切换 |
| **响应式设计** | 桌面 + 移动端适配 |

## 技术架构

```
┌──────────────────────────────────────────┐
│           Electron Main Process          │
│  系统托盘 · 全局快捷键 · 窗口管理 · 自动粘贴  │
├──────────────────────────────────────────┤
│         Renderer (Chromium)              │
│           VoiceInputApp                  │
│         (引擎编排 & UI管理)                │
├──────────────────────────────────────────┤
│  SherpaEngine    BaiduEngine   Web Speech│
│  (sherpa-onnx)   (百度实时ASR)   API      │
│  WASM离线识别    WebSocket国内直连  在线降级 │
├──────────────────────────────────────────┤
│  AudioCapture  → Float32 → Int16 PCM    │
│  (16kHz mono)    音频格式转换             │
└──────────────────────────────────────────┘
```

### 引擎对比

| 引擎 | 类型 | 网络 | 延迟 | 识别率 | 适用场景 |
|------|------|------|------|--------|----------|
| **sherpa-onnx** | 离线本地 | 无需 | 低 | ★★★★ | 隐私敏感、无网络 |
| **百度实时ASR** | 在线国内 | 国内直连 | 低 | ★★★★★ | 日常使用(推荐) |
| **Web Speech** | 在线云端 | 需VPN | 中 | ★★★ | 降级兜底 |

## 项目结构

```
voice-input-method/
├── package.json                # Electron 项目配置
├── main.js                     # Electron 主进程
├── preload.js                  # IPC 桥接 (contextBridge)
├── index.html                  # 渲染进程页面
├── css/
│   └── style.css               # 样式（含弹出窗口样式）
├── js/
│   ├── app.js                  # 应用入口，引擎编排 & UI管理
│   ├── baiduEngine.js          # 百度实时ASR引擎 (WebSocket + OAuth)
│   ├── sherpaEngine.js         # sherpa-onnx 离线引擎 (WASM)
│   └── sherpa/                 # 离线模型文件
│       ├── sherpa-onnx-asr.js
│       ├── sherpa-onnx-wasm-main-asr.js
│       ├── sherpa-onnx-wasm-main-asr.wasm
│       └── sherpa-onnx-wasm-main-asr.data  (190MB, gitignored)
├── scripts/
│   └── download-sherpa-models.sh
└── .gitignore
```

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/hoangtamtoan7-crypto/voice-input-method.git
cd voice-input-method
```

### 2. 安装依赖

需要 [Node.js](https://nodejs.org/) 18+：

```bash
npm install
```

### 3. 下载离线模型（可选，约190MB）

```bash
bash scripts/download-sherpa-models.sh
```

将 `sherpa-onnx-wasm-main-asr.data` 放入 `js/sherpa/` 目录。

### 4. 启动

```bash
npm start
```

### 5. 配置百度引擎（可选，推荐）

1. [百度智能云控制台](https://console.bce.baidu.com/) → 人工智能 → 语音技术 → 实时语音识别 → 开通服务
2. 创建应用获取 AppID / API Key / Secret Key
3. 填入 `js/baiduEngine.js` 的 `BAIDU_CONFIG`

```javascript
var BAIDU_CONFIG = {
  appid: 'YOUR_APPID',
  appkey: 'YOUR_API_KEY',
  secret: 'YOUR_SECRET_KEY',
  dev_pid: 1537,  // 普通话(通用)
};
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+Space` | **全局热键**：开始/停止录音（任意应用中可用） |
| `Space` | 应用内开始/停止录音 |
| `Ctrl + Z` | 撤销 |
| `Ctrl + C` | 复制全部 |
| `Ctrl + S` | 导出 TXT |
| `Ctrl + Delete` | 清空 |
| `Esc` | 关闭弹窗 |
| `Ctrl + Shift + D` | 调试面板（浏览器模式） |

## 浏览器兼容性

| 模式 | 支持 |
|------|------|
| **Electron 桌面应用** | Windows (推荐使用方式) |
| **网页模式** | Chrome/Edge 90+（通过 HTTP 服务器打开 `index.html`） |

## 许可证

MIT License

---

七牛云 XEngineer 暑期实训营 · 题目一 · 2025

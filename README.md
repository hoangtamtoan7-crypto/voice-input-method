# 语音输入法 (Voice Input Method)

纯前端语音输入工具，三引擎智能路由架构——离线、国内直连、云端全覆盖。解决用户在无 VPN 环境下高效语音转文字的需求。

> 七牛云 XEngineer 暑期实训营 · 题目一

## Demo 视频

> [待上传至 B站/网盘后放置链接]

## 解决的问题

- **国内用户无法使用 Google Web Speech API**（需 VPN）
- **网络不稳定导致识别中断**——自动降级切换引擎
- **隐私场景**需要纯本地识别，不上传音频到服务器

## 功能特性

| 特性 | 说明 |
|------|------|
| **三引擎智能路由** | 离线(sherpa-onnx) → 百度实时ASR(国内直连) → Web Speech(在线降级) |
| **一键切换引擎** | 点击状态栏引擎徽章，手动切换，录音中自动恢复 |
| **实时流式识别** | 边说边出字，支持 interim(临时) + final(最终) 结果 |
| **端点检测** | 内置 VAD，自动断句，长句不丢失 |
| **多语言** | 中文普通话、粤语、英语、日语、韩语等 10+ 语言 |
| **音频可视化** | 7段波形，区分 sound/speech 状态（离线+百度引擎） |
| **标点快捷栏** | 11个常用标点一键插入，支持换行 |
| **撤销历史** | 最多30步，Ctrl+Z 撤销 |
| **键盘快捷键** | Space 录音、Ctrl+Z 撤销、Ctrl+C 复制、Ctrl+S 导出 TXT、Ctrl+Delete 清空 |
| **草稿自动保存** | localStorage 自动保存，刷新不丢失 |
| **历史记录** | 转录历史，点击回填，单条删除 |
| **深色/浅色主题** | 跟随系统或手动切换 |
| **响应式设计** | 桌面 + 移动端适配 |

## 技术架构

```
┌─────────────────────────────────────┐
│           VoiceInputApp             │
│         (引擎编排 & UI管理)          │
├─────────────────────────────────────┤
│  SherpaEngine    BaiduEngine   Web  │
│  (sherpa-onnx)   (百度实时ASR) Speech│
│  WASM离线识别    WebSocket国内直连   │
├─────────────────────────────────────┤
│  AudioCapture  → Float32→Int16 PCM │
│  (16kHz mono)    音频格式转换      │
└─────────────────────────────────────┘
```

### 引擎对比

| 引擎 | 类型 | 网络 | 延迟 | 识别率 | 适用场景 |
|------|------|------|------|--------|----------|
| **sherpa-onnx** | 离线本地 | 无需 | 低 | ★★★★ | 隐私敏感、无网络 |
| **百度实时ASR** | 在线国内 | 国内直连 | 低 | ★★★★★ | 日常使用(推荐) |
| **Web Speech** | 在线云端 | 需VPN | 中 | ★★★ | 降级兜底 |

### 识别引擎原理

**sherpa-onnx (离线引擎)**
- 基于 sherpa-onnx WASM SIMD 运行时，在浏览器中加载 Zipformer 模型
- 使用 OnlineRecognizer API 进行流式识别
- 模型文件约 190MB，首次加载后浏览器缓存

**百度实时 ASR (在线引擎)**
- WebSocket 连接 `wss://vop.baidu.com/realtime_asr`
- OAuth token 鉴权（自动降级为 appkey 模式）
- 音频缓冲机制，WebSocket 连接建立前不丢失数据

**Web Speech API (在线引擎)**
- 浏览器内置语音识别，Chrome/Edge 支持
- 自动重启机制（最多3次），连接断开后恢复

## 项目结构

```
voice-input-method/
├── index.html                  # 主页面
├── css/
│   └── style.css               # 样式（CSS变量主题系统）
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
│   └── download-sherpa-models.sh  # 模型下载脚本
└── .gitignore
```

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/hoangtamtoan7-crypto/voice-input-method.git
cd voice-input-method
```

### 2. 下载离线模型（可选，约190MB）

```bash
bash scripts/download-sherpa-models.sh
```

将 `sherpa-onnx-wasm-main-asr.data` 放入 `js/sherpa/` 目录。

### 3. 启动

通过任意 HTTP 服务器打开（Chrome 不支持 `file://` 下使用麦克风）：

```bash
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```

### 4. 配置百度引擎（可选，推荐）

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
| `Space` | 开始/停止录音 |
| `Ctrl + Z` | 撤销 |
| `Ctrl + C` | 复制全部 |
| `Ctrl + S` | 导出 TXT |
| `Ctrl + Delete` | 清空 |
| `Esc` | 关闭弹窗 |
| `Ctrl + Shift + D` | 调试面板 |

## 浏览器兼容性

- **离线引擎**：所有支持 WebAssembly SIMD 的浏览器（Chrome/Edge 90+）
- **百度引擎**：所有支持 WebSocket 的现代浏览器
- **在线引擎**：Chrome/Edge（Web Speech API）

## 许可证

MIT License

---

七牛云 XEngineer 暑期实训营 · 题目一 · 2025

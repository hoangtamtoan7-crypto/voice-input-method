# 语音输入法 (Voice Input Method)

纯前端语音输入工具，三引擎架构——离线、国内、在线全覆盖。

## 识别引擎

| 引擎 | 类型 | 网络需求 | 延迟 | 状态 |
|------|------|---------|------|------|
| **sherpa-onnx** | 离线本地 | 无需网络 | 低 | 推荐 |
| **百度语音** | 在线国内 | 国内直连 | 低 | 需配置API凭据 |
| **Web Speech API** | 在线云端 | 需VPN | 中 | 降级方案 |

> 优先级：离线 > 百度API > 在线。点击引擎徽章可手动切换。

## 功能

- **三引擎语音识别**：离线优先，国内直连兜底，在线备选
- **实时流式识别**：sherpa-onnx Zipformer 模型，中英双语
- **端点检测**：内置 VAD/Endpoint，自动断句
- **实时音频可视化**：7段波形动画，speech/sound 状态区分
- **多语言**：中文普通话、粤语、英文、日文、韩文等
- **标点快捷栏**：11个常用标点一键插入
- **键盘快捷键**：Space 录音、Ctrl+Z 撤销、Ctrl+C 复制、Ctrl+S 导出
- **撤销历史**：最多30步撤销
- **自动保存**：草稿自动保存到 localStorage，刷新不丢失
- **历史记录**：转录历史，点击回填，单条删除
- **主题切换**：深色/浅色，跟随系统或手动切换
- **响应式设计**：桌面 + 移动端适配

## 项目结构

```
voice-input-method/
├── index.html                  # 主页面
├── css/
│   └── style.css               # 样式与主题
├── js/
│   ├── app.js                  # 应用入口，三引擎编排
│   ├── sherpaEngine.js         # sherpa-onnx 离线引擎封装
│   ├── baiduEngine.js          # 百度 WebSocket ASR 引擎
│   └── sherpa/                 # 离线模型与WASM（需下载）
│       ├── sherpa-onnx-asr.js
│       ├── sherpa-onnx-wasm-main-asr.js
│       ├── sherpa-onnx-wasm-main-asr.wasm
│       └── sherpa-onnx-wasm-main-asr.data  (gitignored, 需下载)
├── scripts/
│   └── download-sherpa-models.sh  # 离线模型下载脚本
└── .gitignore
```

## 快速开始

### 1. 下载离线模型（推荐，一次性）

```bash
bash scripts/download-sherpa-models.sh
```

下载完成后将 `sherpa-onnx-wasm-main-asr.data` (约190MB) 放入 `js/sherpa/` 目录。

### 2. 打开应用

双击 `index.html` 或通过任意 HTTP 服务器打开。

### 3. 配置百度引擎（可选）

1. 在 [百度智能云](https://console.bce.baidu.com/) 注册应用
2. 获取 API Key、Secret Key、App ID
3. 填入 `js/baiduEngine.js` 的 `BAIDU_CONFIG`

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Space` | 开始/停止录音 |
| `Ctrl + Z` | 撤销最后识别内容 |
| `Ctrl + C` | 复制全部文本 |
| `Ctrl + S` | 导出TXT文件 |
| `Ctrl + Delete` | 清空文本 |
| `Esc` | 关闭弹窗 |

## 浏览器支持

- **离线引擎**：所有支持 WebAssembly SIMD 的浏览器（Chrome/Edge/Firefox/Safari）
- **在线引擎**：Chrome、Edge、Safari 14.1+

---

七牛云 XEngineer 暑期实训营 · 题目一

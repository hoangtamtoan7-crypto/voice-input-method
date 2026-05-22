# 语音输入法 (Voice Input Method)

纯前端语音输入工具，双引擎架构——**离线可用，无需VPN**。

## 识别引擎

| 引擎 | 类型 | 网络需求 | 状态 |
|------|------|---------|------|
| **sherpa-onnx** | 离线本地 | 无需网络 | 推荐（需下载模型） |
| **Web Speech API** | 在线云端 | 需VPN（Google） | 降级方案 |

> **离线引擎**：基于 sherpa-onnx WASM，中文+英文双语 Zipformer 模型，纯本地运算。
> **在线引擎**：浏览器内置 Web Speech API，识别效果好但需连接 Google 服务器。
>
> 点击引擎徽章可在两个引擎间切换。

## 功能

- **双引擎语音识别**：离线优先，在线兜底，一键切换
- **实时音频可视化**：7段波形动画，speech/sound 状态区分
- **连续语音转文字**：interim（临时）蓝色斜体预览 + final（最终）黑色文本
- **多语言**：中文普通话、粤语、英文、日文、韩文（在线引擎）
- **可编辑文本区**：支持手动修正识别结果
- **撤销**：Ctrl+Z 撤销识别内容（最多30步）
- **标点快捷栏**：11个常用标点一键插入
- **键盘快捷键**：Space 录音、Ctrl+Z 撤销、Ctrl+C 复制、Ctrl+S 导出
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
│   ├── app.js                  # 应用入口，双引擎编排
│   ├── sherpaEngine.js         # sherpa-onnx 离线引擎封装
│   ├── speechRecognizer.js     # Web Speech API 引擎封装
│   ├── textProcessor.js        # 文本处理（标点/复制/导出）
│   ├── storage.js              # 历史记录持久化
│   └── ui.js                   # DOM交互与UI控制
├── scripts/
│   └── download-sherpa-models.sh  # 离线模型下载脚本
└── .gitignore
```

## 快速开始

### 在线模式（无需额外配置）

1. Chrome 浏览器打开 `index.html`
2. 开启 VPN（Web Speech API 需连接 Google）
3. 点击麦克风开始使用

### 离线模式（推荐，无需VPN）

```bash
# 下载离线模型（需VPN仅此一次）
bash scripts/download-sherpa-models.sh

# 下载完成后即可离线使用
# 双击 index.html 打开
```

离线模型文件下载后放置在 `js/sherpa/model/` 目录：
- `encoder.onnx` (~70MB)
- `decoder.onnx` (~5MB)
- `joiner.onnx` (~3MB)
- `tokens.txt`

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

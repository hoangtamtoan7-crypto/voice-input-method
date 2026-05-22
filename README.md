# 语音输入法 (Voice Input Method)

基于 Web Speech API 的纯前端语音输入工具，帮助用户高效完成语音转文字。

## 功能

- **语音识别**：连续实时语音转文字，支持 interim（临时）和 final（最终）结果区分显示
- **多语言**：中文普通话、粤语、英文、日文、韩文
- **标点修正**：中英文自动标点规范化
- **主题切换**：深色/浅色主题，跟随系统或手动切换
- **历史记录**：自动保存转录历史，点击回填，支持单条删除（localStorage）
- **文本操作**：一键复制到剪贴板、导出TXT文件
- **响应式设计**：适配桌面和移动端

## 技术栈

- 纯 HTML/CSS/JavaScript，无框架依赖
- Web Speech API (SpeechRecognition)
- ES Modules 模块化架构
- CSS Custom Properties 主题系统

## 项目结构

```
voice-input-method/
├── index.html              # 主页面
├── css/
│   └── style.css           # 样式与主题
├── js/
│   ├── app.js              # 应用入口，模块编排
│   ├── speechRecognizer.js # 语音识别核心封装
│   ├── textProcessor.js    # 文本处理（标点/复制/导出）
│   ├── storage.js          # 历史记录持久化
│   └── ui.js               # DOM交互与UI控制
└── .gitignore
```

## 浏览器支持

需要支持 Web Speech API 的浏览器：

- Google Chrome（推荐）
- Microsoft Edge
- Safari 14.1+

Firefox 目前不支持 SpeechRecognition API。

## 使用方法

1. 用支持的浏览器打开 `index.html`
2. 选择识别语言
3. 点击麦克风按钮开始录音
4. 说话时文字实时显示
5. 再次点击麦克风停止录音
6. 使用复制/导出按钮保存文本

## 本地运行

```bash
# 任意静态文件服务器，例如：
npx serve .
# 或
python -m http.server 8080
```

> **注意**：Web Speech API 需要在 localhost 或 HTTPS 环境下使用（部分浏览器 file:// 协议下也可运行）。

---

七牛云 XEngineer 暑期实训营 · 题目一

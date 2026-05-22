#!/bin/bash
# 下载 sherpa-onnx 浏览器 WASM 离线语音识别所需文件
# 需要 VPN 或代理访问 GitHub
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$SCRIPT_DIR/../js/sherpa"
mkdir -p "$DEST_DIR"

echo "=== 1/4 从 npm 下载 sherpa-onnx ASR 封装代码 ==="
curl -sL -o "$DEST_DIR/sherpa-onnx-asr.js" \
  "https://cdn.jsdelivr.net/npm/sherpa-onnx@1.13.2/sherpa-onnx-asr.js"
echo "  ✓ sherpa-onnx-asr.js"

curl -sL -o "$DEST_DIR/sherpa-onnx-wasm-nodejs.wasm" \
  "https://cdn.jsdelivr.net/npm/sherpa-onnx@1.13.2/sherpa-onnx-wasm-nodejs.wasm"
echo "  ✓ sherpa-onnx-wasm-nodejs.wasm"

echo ""
echo "=== 2/4 下载中英双语 Zipformer 模型 (约 75MB) ==="
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2"
MODEL_DIR="$DEST_DIR/model"

mkdir -p "$MODEL_DIR"
curl -L -o "$MODEL_DIR/model.tar.bz2" "$MODEL_URL"
cd "$MODEL_DIR"
tar xf model.tar.bz2
rm model.tar.bz2

# 重命名为标准名称
mv sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/encoder-epoch-99-avg-1.int8.onnx encoder.onnx
mv sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/decoder-epoch-99-avg-1.onnx decoder.onnx
mv sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/joiner-epoch-99-avg-1.int8.onnx joiner.onnx
mv sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/tokens.txt ./
rm -rf sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20
cd "$SCRIPT_DIR/.."
echo "  ✓ 模型文件下载完成"

echo ""
echo "=== 3/4 下载浏览器 WASM 胶水代码 ==="
# 从 GitHub 仓库获取浏览器版本 (非 Node.js)
curl -sL -o "$DEST_DIR/sherpa-onnx-wasm-main-asr.js" \
  "https://cdn.jsdelivr.net/gh/k2-fsa/sherpa-onnx@1.13.2/wasm/asr/sherpa-onnx-wasm-main-asr.cc"
echo "  ⚠ sherpa-onnx-wasm-main-asr.cc 需要编译 (需要 Emscripten)"

# 说明：完整的浏览器 WASM 构建需要 Emscripten 编译环境
# 作为替代方案，你可以直接从 HuggingFace Space 下载预编译版本：
echo ""
echo "=== 替代方案 ==="
echo "HuggingFace 上有预编译的浏览器 DEMO，可以直接下载使用："
echo "  https://huggingface.co/spaces/k2-fsa/web-assembly-asr-sherpa-onnx-zh-en"
echo ""
echo "或使用我们提供的 npm 包 + 自行编写的浏览器加载器（推荐）"

echo ""
echo "=== 4/4 验证 ==="
echo "文件清单:"
ls -lh "$DEST_DIR/"
ls -lh "$MODEL_DIR/" 2>/dev/null || echo "  (模型文件请通过VPN下载)"
echo ""
echo "如需手动下载模型："
echo "  $MODEL_URL"
echo ""
echo "=== 完成 ==="

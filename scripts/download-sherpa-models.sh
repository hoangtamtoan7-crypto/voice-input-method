#!/bin/bash
# 下载 sherpa-onnx 浏览器 WASM 离线语音识别文件
# 中英双语 Zipformer 模型 (约 175MB)
# 需要访问 GitHub（国内可能需要代理）
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$SCRIPT_DIR/../js/sherpa"
TMP_DIR="$DEST_DIR/_dl"
mkdir -p "$DEST_DIR" "$TMP_DIR"

BASE_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.2"
BUNDLE="sherpa-onnx-wasm-simd-v1.13.2-zh-en-asr-zipformer"

echo "=== 下载 sherpa-onnx zh-en WASM 模型包 (约 175MB) ==="
echo "从 GitHub Releases 下载..."

curl -L --progress-bar -o "$TMP_DIR/bundle.tar.bz2" \
  "$BASE_URL/$BUNDLE.tar.bz2"

echo ""
echo "=== 解压 ==="
cd "$TMP_DIR"
tar xf bundle.tar.bz2
rm bundle.tar.bz2

echo "=== 安装文件 ==="
cp "$BUNDLE/sherpa-onnx-asr.js" "$DEST_DIR/"
cp "$BUNDLE/sherpa-onnx-wasm-main-asr.js" "$DEST_DIR/"
cp "$BUNDLE/sherpa-onnx-wasm-main-asr.wasm" "$DEST_DIR/"
cp "$BUNDLE/sherpa-onnx-wasm-main-asr.data" "$DEST_DIR/"

cd "$SCRIPT_DIR/.."
rm -rf "$TMP_DIR"

echo ""
echo "=== 验证 ==="
ls -lh "$DEST_DIR/"*.js "$DEST_DIR/"*.wasm "$DEST_DIR/"*.data 2>/dev/null
echo ""
echo "=== 完成 ==="
echo "离线引擎文件已就绪，打开 index.html 即可使用（无需网络）。"

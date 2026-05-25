#!/usr/bin/env python3
"""
语音输入法 - Voice Input Method
Windows 桌面托盘应用，全局热键语音转文字，自动输入到任意应用

使用方法：
    python voice_input.py

热键：Ctrl+Alt+V 开始/停止录音
"""

import sys
import os
import json
import time
import struct
import threading
import ctypes
from ctypes import wintypes
from io import BytesIO

# ==================== 百度配置（从环境变量读取） ====================
def _load_baidu_config():
    """从环境变量或 .env 文件加载百度API凭据"""
    # 尝试加载 .env 文件
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if os.path.exists(env_file):
        with open(env_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    val = val.strip().strip('"').strip("'")
                    if key.strip() not in os.environ:
                        os.environ[key.strip()] = val

    config = {
        'appid': os.environ.get('BAIDU_APPID', ''),
        'appkey': os.environ.get('BAIDU_APPKEY', ''),
        'secret': os.environ.get('BAIDU_SECRET', ''),
        'dev_pid': int(os.environ.get('BAIDU_DEV_PID', '15373')),
    }

    if not config['appid'] or not config['appkey'] or not config['secret']:
        print('[警告] 百度API凭据未配置！')
        print('  请设置环境变量: BAIDU_APPID, BAIDU_APPKEY, BAIDU_SECRET')
        print('  或在 voice_input.py 同目录创建 .env 文件')
        print('  详见: https://console.bce.baidu.com/ 创建语音技术应用')
        return None

    return config

BAIDU_CONFIG = _load_baidu_config()

HOTKEY = 'ctrl+alt+v'
SAMPLE_RATE = 16000
CHUNK_DURATION = 0.16     # 每次发送 160ms 音频
CHUNK_SIZE = int(SAMPLE_RATE * CHUNK_DURATION)

# ==================== 剪贴板 (ctypes, 无额外依赖) ====================
def _clipboard_get():
    ctypes.windll.user32.OpenClipboard(0)
    try:
        if ctypes.windll.user32.IsClipboardFormatAvailable(13):  # CF_UNICODETEXT
            h = ctypes.windll.user32.GetClipboardData(13)
            if h:
                p = ctypes.windll.kernel32.GlobalLock(h)
                text = ctypes.c_wchar_p(p).value
                ctypes.windll.kernel32.GlobalUnlock(h)
                return text or ''
    finally:
        ctypes.windll.user32.CloseClipboard()
    return ''

def _clipboard_set(text):
    ctypes.windll.user32.OpenClipboard(0)
    ctypes.windll.user32.EmptyClipboard()
    data = (text + '\x00').encode('utf-16-le')
    hmem = ctypes.windll.kernel32.GlobalAlloc(0x0002, len(data))
    p = ctypes.windll.kernel32.GlobalLock(hmem)
    ctypes.memmove(p, data, len(data))
    ctypes.windll.kernel32.GlobalUnlock(hmem)
    ctypes.windll.user32.SetClipboardData(13, hmem)
    ctypes.windll.user32.CloseClipboard()

def _simulate_ctrl_v():
    """模拟 Ctrl+V 按键"""
    import keyboard
    keyboard.send('ctrl+v')

# ==================== 百度语音识别 WebSocket ====================
class BaiduRecognizer:
    def __init__(self):
        self.ws = None
        self.ws_opened = False
        self.final_text = ''
        self.interim_text = ''
        self.is_running = False
        self.error = None
        self._token = None
        self._audio_buffer = []

    def start(self):
        """启动 WebSocket 连接并开始识别"""
        if BAIDU_CONFIG is None:
            raise RuntimeError('百度API凭据未配置')

        import websocket

        self.final_text = ''
        self.interim_text = ''
        self.error = None
        self._audio_buffer = []

        # 建立 WebSocket
        sn = f'py-{int(time.time() * 1000)}-{id(self) % 10000}'
        url = f'wss://vop.baidu.com/realtime_asr?sn={sn}'

        self.ws = websocket.WebSocket()
        self.ws.connect(url)

        # 发送 START 帧
        start_data = {
            'appid': int(BAIDU_CONFIG['appid']),
            'appkey': BAIDU_CONFIG['appkey'],
            'dev_pid': BAIDU_CONFIG['dev_pid'],
            'cuid': f'voice-input-python-{BAIDU_CONFIG["appid"]}',
            'format': 'pcm',
            'sample': SAMPLE_RATE
        }
        print(f'[百度] 发送 START: appid={start_data["appid"]}, dev_pid={start_data["dev_pid"]}')

        self.ws.send(json.dumps({'type': 'START', 'data': start_data}))
        self.ws_opened = True
        self.is_running = True

        print('[百度] WebSocket 已连接')

        # 发送缓冲的音频
        for chunk in self._audio_buffer:
            self.ws.send_binary(chunk)
        self._audio_buffer = []

    def send_audio(self, pcm_bytes):
        """发送 PCM 音频数据"""
        if not self.is_running or self.error:
            return
        if self.ws_opened:
            try:
                self.ws.send_binary(pcm_bytes)
            except Exception as e:
                print(f'[WebSocket] 发送失败: {e}')
                self.error = str(e)
                self.is_running = False
        else:
            self._audio_buffer.append(pcm_bytes)

    def recv(self):
        """非阻塞接收识别结果，返回 (final_text, interim_text)"""
        if not self.is_running or not self.ws:
            return ('', '')
        try:
            self.ws.settimeout(0.01)
            data = self.ws.recv()
            if isinstance(data, bytes):
                data = data.decode('utf-8', errors='ignore')
            msg = json.loads(data)

            if msg.get('err_no', 0) != 0:
                self.error = msg.get('err_msg', '百度API错误')
                self.is_running = False
                print(f'[百度] API错误: {msg}')
                return ('', '')

            if msg.get('type') == 'MID_TEXT':
                self.interim_text = msg.get('result', '')
                return ('', self.interim_text)
            elif msg.get('type') == 'FIN_TEXT':
                self.final_text += msg.get('result', '')
                self.interim_text = ''
                return (msg.get('result', ''), '')
        except Exception:
            pass
        return ('', '')

    def stop(self):
        """停止识别"""
        if not self.is_running:
            return self.final_text

        self.is_running = False
        if self.ws:
            try:
                self.ws.send(json.dumps({'type': 'FINISH'}))
            except Exception:
                pass
            try:
                self.ws.close()
            except Exception:
                pass

        print(f'[百度] 识别结束: {self.final_text[:60]}...' if len(self.final_text) > 60 else f'[百度] 识别结束: {self.final_text}')
        return self.final_text


# ==================== 音频录制 ====================
class AudioRecorder:
    def __init__(self):
        self.stream = None
        self.is_recording = False

    def start(self, on_audio_chunk):
        """开始录音，回调 on_audio_chunk(int16_bytes)"""
        if self.is_recording:
            return
        self.is_recording = True

        import sounddevice as sd
        import numpy as np

        self._on_chunk = on_audio_chunk
        self._sd = sd

        def callback(indata, frames, time_info, status):
            if status:
                print(f'[音频] {status}')
            if self.is_recording and self._on_chunk:
                self._on_chunk(indata.tobytes())

        self.stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype='int16',
            blocksize=CHUNK_SIZE,
            callback=callback
        )
        self.stream.start()
        print(f'[音频] 开始录音 {SAMPLE_RATE}Hz mono')

    def stop(self):
        self.is_recording = False
        if self.stream:
            self.stream.stop()
            self.stream.close()
            self.stream = None
            print('[音频] 停止录音')


# ==================== 托盘图标 ====================
def _create_icon_image(size=32, color=(255, 255, 255, 255)):
    """用 Pillow 画麦克风图标"""
    from PIL import Image, ImageDraw
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    s = size
    # 麦克风头部 (圆形)
    cx, cy = s // 2, int(s * 0.32)
    r = int(s * 0.2)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    # 身体 (矩形)
    bw = max(2, int(s * 0.22))
    draw.rectangle([cx - bw, cy + r, cx + bw, int(s * 0.65)], fill=color)
    # 底座
    base_y = int(s * 0.65)
    draw.rectangle([int(s * 0.15), base_y, int(s * 0.85), base_y + max(2, s // 16)], fill=color)
    # 支架
    stand_w = max(1, s // 16)
    draw.rectangle([cx - stand_w, base_y, cx + stand_w, int(s * 0.98)], fill=color)
    return img


# ==================== 主应用 ====================
class VoiceInputApp:
    def __init__(self):
        self.recorder = AudioRecorder()
        self.recognizer = None
        self.recording = False
        self.tray = None
        self.icon_normal = _create_icon_image(color=(255, 255, 255, 255))
        self.icon_recording = _create_icon_image(color=(255, 60, 60, 255))

    def run(self):
        """启动托盘应用"""
        import pystray
        import keyboard

        # 创建托盘
        self.tray = pystray.Icon(
            'voice_input',
            icon=self.icon_normal,
            title='语音输入法 - 就绪',
            menu=pystray.Menu(
                pystray.MenuItem('开始录音', self.on_hotkey, default=True),
                pystray.MenuItem('—', lambda: None, enabled=False),
                pystray.MenuItem('退出', self.quit_app),
            )
        )

        # 注册全局热键
        try:
            keyboard.add_hotkey(HOTKEY, self.on_hotkey)
            print(f'全局热键已注册: {HOTKEY}')
            print('语音输入法已就绪，托盘图标在系统栏')
        except Exception as e:
            print(f'热键注册失败: {e}')
            print('可以使用托盘菜单中的"开始录音"')

        # 运行托盘
        self.tray.run()

    def on_hotkey(self):
        """热键/托盘菜单 触发（在 hook 线程中，需尽快返回）"""
        if self.recording:
            self.stop_recording()
        else:
            threading.Thread(target=self.start_recording, daemon=True).start()

    def start_recording(self):
        if self.recording:
            return

        if BAIDU_CONFIG is None:
            print('[错误] 百度API凭据未配置，无法开始录音')
            print('  请设置环境变量: BAIDU_APPID, BAIDU_APPKEY, BAIDU_SECRET')
            return

        self.recording = True
        self._update_tray(recording=True)
        print('===== 开始录音 =====')

        # 启动识别器
        self.recognizer = BaiduRecognizer()
        try:
            self.recognizer.start()
        except Exception as e:
            print(f'识别器启动失败: {e}')
            self.recording = False
            self._update_tray(recording=False)
            return

        # 启动录音
        def on_audio(data):
            if self.recognizer and self.recognizer.is_running:
                self.recognizer.send_audio(data)

        try:
            self.recorder.start(on_audio)
        except Exception as e:
            print(f'麦克风启动失败: {e}')
            self.recognizer.stop()
            self.recognizer = None
            self.recording = False
            self._update_tray(recording=False)
            return

        # 后台线程：轮询识别结果
        def poll_results():
            while self.recording and self.recognizer and self.recognizer.is_running:
                final, interim = self.recognizer.recv()
                if final:
                    print(f'[结果] {final}')
                if interim:
                    print(f'[临时] {interim}', end='\r')
                time.sleep(0.05)

        self._poll_thread = threading.Thread(target=poll_results, daemon=True)
        self._poll_thread.start()

    def stop_recording(self):
        if not self.recording:
            return

        self.recording = False
        print('===== 停止录音 =====')

        # 停止录音
        self.recorder.stop()

        # 等待识别结果
        time.sleep(0.3)

        # 停止识别器
        final_text = ''
        if self.recognizer:
            # 再收一次结果
            for _ in range(10):
                f, _ = self.recognizer.recv()
                if f:
                    final_text += f
                time.sleep(0.05)
            final_text += self.recognizer.stop()
            self.recognizer = None

        self._update_tray(recording=False)

        if final_text.strip():
            print(f'最终文本: {final_text}')
            self._type_text(final_text)
        else:
            print('无识别文本')

    def _type_text(self, text):
        """将文本粘贴到当前光标位置"""
        try:
            original = _clipboard_get()
            _clipboard_set(text)
            # 等待剪贴板更新 + 热键释放
            time.sleep(0.35)

            _simulate_ctrl_v()

            # 恢复原剪贴板（延迟确保粘贴完成）
            threading.Thread(target=self._restore_clipboard, args=(original,), daemon=True).start()

            print(f'已粘贴: {text[:50]}...' if len(text) > 50 else f'已粘贴: {text}')
        except Exception as e:
            print(f'粘贴失败: {e}')

    def _restore_clipboard(self, original):
        time.sleep(0.5)
        try:
            if original:
                _clipboard_set(original)
        except Exception:
            pass

    def _update_tray(self, recording=False):
        if self.tray:
            self.tray.icon = self.icon_recording if recording else self.icon_normal
            self.tray.title = '语音输入法 - 正在录音...' if recording else '语音输入法 - 就绪'

    def quit_app(self):
        if self.recording:
            self.stop_recording()
        if self.tray:
            self.tray.stop()
        print('应用已退出')


# ==================== 入口 ====================
if __name__ == '__main__':
    print('=' * 50)
    print('  语音输入法 - Voice Input Method')
    print(f'  热键: {HOTKEY.upper()}  开始/停止录音')
    print('  右击托盘图标可退出')
    print('=' * 50)

    app = VoiceInputApp()
    try:
        app.run()
    except KeyboardInterrupt:
        app.quit_app()

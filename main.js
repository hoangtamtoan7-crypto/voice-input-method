/**
 * 语音输入法 - Electron 主进程
 */

const {
  app, BrowserWindow, Tray, globalShortcut,
  clipboard, ipcMain, Menu, nativeImage, screen, session
} = require('electron');
const path = require('path');
const { exec } = require('child_process');

// 允许 file:// 协议使用 getUserMedia（麦克风）
app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', 'file://');
// 禁用 GPU 沙箱以避免 Windows 权限问题
app.commandLine.appendSwitch('disable-gpu-sandbox');
// 设置用户数据目录到项目文件夹下（避免中文路径权限问题）
app.setPath('userData', path.join(__dirname, '.electron-data'));

// ========== 状态 ==========
let mainWindow = null;
let popupWindow = null;
let tray = null;
let isRecording = false;
let currentEngine = 'baidu';

// ========== 托盘图标（程序化生成麦克风图标，BGRA 像素格式） ==========
function createTrayIcon(recording) {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const cx = 8, cy = 5, r = 4;
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const inHead = d <= r;
      const inBody = y >= 8 && y <= 12 && x >= 4 && x <= 11;
      const inBase = y === 13 && x >= 2 && x <= 13;
      const inStand = x === 8 && y >= 13 && y <= 15;
      if (inHead || inBody || inBase || inStand) {
        if (recording) {
          buf[i] = 80; buf[i + 1] = 80; buf[i + 2] = 255; buf[i + 3] = 255;
        } else {
          buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255; buf[i + 3] = 255;
        }
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

// ========== 托盘菜单模板 ==========
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: '打开主窗口', click: () => {
        showMainWindow();
      }
    },
    { type: 'separator' },
    {
      label: '默认引擎',
      submenu: [
        {
          label: '讯飞引擎 (高精度)', type: 'radio', checked: currentEngine === 'iflytek',
          click: () => setEngine('iflytek')
        },
        {
          label: '百度引擎 (通用)', type: 'radio', checked: currentEngine === 'baidu',
          click: () => setEngine('baidu')
        },
        {
          label: '离线引擎 (sherpa-onnx)', type: 'radio', checked: currentEngine === 'sherpa',
          click: () => setEngine('sherpa')
        },
        {
          label: '在线引擎 (Web Speech)', type: 'radio', checked: currentEngine === 'webspeech',
          click: () => setEngine('webspeech')
        }
      ]
    },
    { type: 'separator' },
    {
      label: '退出', click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function updateTrayMenu() {
  if (tray) {
    tray.setContextMenu(buildTrayMenu());
  }
}

// ========== 托盘 ==========
function createTray() {
  tray = new Tray(createTrayIcon(false));
  tray.setToolTip('语音输入法 - Ctrl+Alt+Space 开始录音');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      showMainWindow();
    }
  });
}

// ========== 弹出窗口（录音状态，不抢焦点） ==========
function createPopupWindow() {
  popupWindow = new BrowserWindow({
    width: 340,
    height: 240,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    focusable: false,       // 不抢夺键盘焦点，用户可继续在聊天框输入
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  popupWindow.loadFile('index.html', { query: { mode: 'popup' } });

  popupWindow.on('close', (e) => {
    e.preventDefault();
    popupWindow.hide();
  });
}

// ========== 主窗口 ==========
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 420,
    minHeight: 500,
    title: '语音输入法 - Voice Input Method',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showMainWindow() {
  if (!mainWindow) createMainWindow();
  mainWindow.show();
  mainWindow.focus();
}

// ========== 弹出窗口管理 ==========
function showPopup() {
  if (!popupWindow) createPopupWindow();

  function doShow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    popupWindow.setPosition(
      Math.round((width - 340) / 2),
      Math.round(height - 300)
    );
    popupWindow.show();
    // 不抢夺焦点，用户继续在聊天框中
    popupWindow.webContents.send('start-recording');
    isRecording = true;
    updateTrayRecordingState(true);
  }

  if (!popupWindow.webContents.isLoading()) {
    doShow();
  } else {
    popupWindow.webContents.once('did-finish-load', doShow);
    popupWindow.show();
  }
}

function hidePopup() {
  if (popupWindow) {
    popupWindow.hide();
  }
  isRecording = false;
  updateTrayRecordingState(false);
}

function updateTrayRecordingState(recording) {
  if (tray) {
    tray.setImage(createTrayIcon(recording));
    tray.setToolTip(recording ? '语音输入法 - 正在录音...' : '语音输入法 - Ctrl+Alt+Space 开始录音');
  }
}

// ========== 粘贴文本（增量流式） ==========
let streamedText = ''; // 已发送的文本，用于计算增量

function doPaste() {
  const psCmd = 'powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^v\')"';
  exec(psCmd, (err) => {
    if (err) console.error('粘贴失败:', err.message);
  });
}

function streamText(text) {
  if (!text) return;

  // 计算新增部分
  let newPart;
  if (text.startsWith(streamedText)) {
    newPart = text.slice(streamedText.length);
  } else {
    // 文本被重置，全部发送
    newPart = text;
  }
  streamedText = text;

  if (!newPart) return;

  clipboard.writeText(newPart);
  setTimeout(doPaste, 50);
}

function resetStreamedText() {
  streamedText = '';
}

// ========== 引擎切换（不重建托盘） ==========
function setEngine(engine) {
  currentEngine = engine;
  updateTrayMenu();
  if (mainWindow) mainWindow.webContents.send('set-engine', engine);
  if (popupWindow) popupWindow.webContents.send('set-engine', engine);
}

// ========== IPC 处理 ==========
ipcMain.handle('recording-result', (_event, text) => {
  hidePopup();
  if (text && text.trim()) {
    streamText(text);
    resetStreamedText();
  }
});

ipcMain.handle('cancel-recording', () => {
  resetStreamedText();
  hidePopup();
});

ipcMain.handle('stream-text', (_event, text) => {
  if (text && text.trim()) {
    streamText(text);
  }
});

ipcMain.handle('get-app-mode', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win === popupWindow ? 'popup' : 'full';
});

// ========== 应用生命周期 ==========
app.whenReady().then(() => {
  // 自动授权所有媒体权限
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'audioCapture', 'videoCapture', 'microphone', 'camera', 'notifications'];
    callback(allowed.includes(permission));
  });

  createTray();
  createPopupWindow();

  // 首次启动自动显示主窗口
  showMainWindow();

  // 尝试注册 Ctrl+Alt+Space，失败则尝试 Ctrl+Shift+.
  let registered = globalShortcut.register('CommandOrControl+Alt+Space', () => {
    if (isRecording) {
      if (popupWindow) popupWindow.webContents.send('stop-recording');
    } else {
      showPopup();
    }
  });

  if (!registered) {
    registered = globalShortcut.register('CommandOrControl+Shift+.', () => {
      if (isRecording) {
        if (popupWindow) popupWindow.webContents.send('stop-recording');
      } else {
        showPopup();
      }
    });
  }

  if (!registered) {
    console.error('全局快捷键注册失败，请在主窗口中使用 Space 键开始录音');
  } else {
    console.log('全局快捷键已注册');
  }
});

app.on('window-all-closed', () => {
  // Windows 上保持托盘运行，不退出
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

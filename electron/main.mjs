// HelpMyDoc 데스크톱 앱 (Electron).
// 앱 안에서 127.0.0.1 로컬 서버(dist 서비스 + Claude Code 브리지)를 띄우고 그 주소를 창에 로드한다.
// 브라우저 버전과 코드가 완전히 같고, 로컬 Claude Code 브리지도 그대로 동작한다.
import { app, BrowserWindow, session, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAppServer } from "../server/app-server.mjs";
import { fixPath } from "./path-fix.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// localStorage(설정, API 키)는 주소(포트 포함)별로 분리되므로, 매번 같은 포트를 쓰도록 우선 시도한다.
const PREFERRED_PORT = 47821;

// 자식 프로세스(claude)가 찾을 수 있도록 서버를 띄우기 전에 PATH 를 보정한다.
process.env.PATH = fixPath();

let server = null;
let mainWindow = null;

function listen(port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

async function startServer() {
  server = createAppServer({ root: join(here, "..", "dist") });
  try {
    return await listen(PREFERRED_PORT);
  } catch (e) {
    if (e?.code !== "EADDRINUSE") throw e;
    return await listen(0); // 사용 중이면 임의 포트 (이 경우 설정이 유지되지 않을 수 있음)
  }
}

function createWindow(origin) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "HelpMyDoc",
    backgroundColor: "#16181b",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });

  const openExternal = (url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  };
  // 외부 링크(Anthropic Console 등)는 앱 창이 아니라 기본 브라우저로 연다.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin) {
      event.preventDefault();
      openExternal(url);
    }
  });
  mainWindow.on("closed", () => (mainWindow = null));
  mainWindow.loadURL(process.env.HELPMYDOC_DEV_URL || `${origin}/`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // 카메라·마이크·위치 등 이 앱에 필요 없는 권한은 모두 거절한다.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

    const port = await startServer();
    const origin = `http://127.0.0.1:${port}`;
    createWindow(origin);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(origin);
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => server?.close());
}

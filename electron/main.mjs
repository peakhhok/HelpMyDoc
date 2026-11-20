// HelpMyDoc 데스크톱 앱 (Electron).
// 앱 안에서 127.0.0.1 로컬 서버(dist 서비스 + Claude Code 브리지)를 띄우고 그 주소를 창에 로드한다.
// 브라우저 버전과 코드가 완전히 같고, 로컬 Claude Code 브리지도 그대로 동작한다.
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import electronUpdater from "electron-updater";
import { createAppServer } from "../server/app-server.mjs";
import { createRecentDocuments } from "./last-document.mjs";
import { buildMenuTemplate, updateDialogFor } from "./menu.mjs";
import { fixPath } from "./path-fix.mjs";
import { createUpdater } from "./updater.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// localStorage(설정, API 키)는 주소(포트 포함)별로 분리되므로, 매번 같은 포트를 쓰도록 우선 시도한다.
const PREFERRED_PORT = 47821;

// 자식 프로세스(claude)가 찾을 수 있도록 서버를 띄우기 전에 PATH 를 보정한다.
process.env.PATH = fixPath();

// 자동 업데이트: 설치된(패키징된) 앱에서만 켜고, 개발 실행이나 HELPMYDOC_NO_UPDATE=1 이면 끈다.
//  - 맥은 코드 서명이 있어야 자동 업데이트가 되므로(서명 없는 빌드는 불가) 켜지 않는다.
//  - 리눅스는 AppImage 로 실행한 경우에만 가능하다.
// (electron-updater 는 CommonJS 라 기본 내보내기로 불러온다)
const updatable = process.platform === "win32" || (process.platform === "linux" && !!process.env.APPIMAGE);
const updater = createUpdater({
  autoUpdater: electronUpdater.autoUpdater,
  currentVersion: app.getVersion(),
  enabled: app.isPackaged && updatable && !process.env.HELPMYDOC_NO_UPDATE,
  checkDelayMs: Number(process.env.HELPMYDOC_UPDATE_CHECK_DELAY_MS) || 10_000,
});

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
  server = createAppServer({ root: join(here, "..", "dist"), updater });
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: join(here, "preload.cjs"),
    },
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

    // 상단 메뉴: 도움말 > 업데이트 확인…
    const showUpdateResult = async (result) => {
      const d = updateDialogFor(result);
      const win = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
      const r = await dialog.showMessageBox(win, {
        type: result.outcome === "error" ? "warning" : "info",
        title: "HelpMyDoc",
        message: d.message,
        detail: d.detail,
        buttons: d.install ? ["지금 다시 시작", "나중에"] : ["확인"],
        defaultId: 0,
        cancelId: d.install ? 1 : 0,
      });
      if (d.install && r.response === 0) updater.install();
    };
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        buildMenuTemplate({
          version: app.getVersion(),
          isMac: process.platform === "darwin",
          onCheckUpdate: async () => showUpdateResult(await updater.checkNow()),
          onOpenRepo: () => shell.openExternal("https://github.com/peakhhok/HelpMyDoc"),
          onAbout: () =>
            dialog.showMessageBox(mainWindow ?? undefined, {
              type: "info",
              title: "HelpMyDoc",
              message: `HelpMyDoc v${app.getVersion()}`,
              detail:
                "PDF·PowerPoint를 보면서 AI에게 질문하는 오픈소스 리더예요.\nhttps://github.com/peakhhok/HelpMyDoc",
              buttons: ["확인"],
            }),
        }),
      ),
    );

    // 최근에 연 문서(경로만 기억). 이 앱의 화면이 보낸 요청만 받는다.
    const recent = createRecentDocuments({ dir: app.getPath("userData") });
    const fromApp = (e) => {
      try {
        return new URL(e.senderFrame?.url ?? "").origin === origin || !!process.env.HELPMYDOC_DEV_URL;
      } catch {
        return false;
      }
    };
    ipcMain.on("doc:seen", (e, p) => fromApp(e) && recent.seen(p));
    ipcMain.handle("doc:remember", (e, p) => fromApp(e) && recent.remember(p));
    ipcMain.handle("doc:recent", (e) => (fromApp(e) ? recent.list() : []));
    ipcMain.handle("doc:read", (e, p) => (fromApp(e) ? recent.read(p) : { ok: false, reason: "unknown" }));
    createWindow(origin);
    updater.start();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(origin);
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => server?.close());
}

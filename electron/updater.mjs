// 자동 업데이트 상태 관리. electron-updater 의 autoUpdater 를 주입받아 테스트할 수 있게 분리했다.
//
// 흐름: 시작 직후와 6시간마다 GitHub Release 를 확인 → 새 버전이 있으면 백그라운드로 내려받음 →
//       받기가 끝나면 화면에 "다시 시작해서 업데이트" 를 보여주고, 사용자가 누르면 설치 후 다시 시작한다.
//       (누르지 않아도 앱을 종료할 때 자동으로 설치된다: autoInstallOnAppQuit)
//
// 상태: disabled(개발 실행·사용자가 끔) / idle / checking / downloading / ready / error
const SIX_HOURS = 6 * 60 * 60 * 1000;

/**
 * @param {{
 *   autoUpdater: import("node:events").EventEmitter & Record<string, any>,
 *   currentVersion: string,
 *   enabled: boolean,
 *   checkDelayMs?: number,
 *   intervalMs?: number,
 * }} opts
 */
export function createUpdater({ autoUpdater, currentVersion, enabled, checkDelayMs = 10_000, intervalMs = SIX_HOURS }) {
  /** @type {{ state: string, version?: string, percent?: number, error?: string }} */
  let state = { state: enabled ? "idle" : "disabled" };
  const set = (next) => {
    state = next;
  };
  const message = (e) => String(e?.message ?? e ?? "알 수 없는 오류").slice(0, 200);

  if (enabled) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = null;

    autoUpdater.on("checking-for-update", () => state.state !== "ready" && set({ state: "checking" }));
    autoUpdater.on("update-available", (info) => set({ state: "downloading", version: info?.version, percent: 0 }));
    autoUpdater.on("update-not-available", () => state.state !== "ready" && set({ state: "idle" }));
    autoUpdater.on("download-progress", (p) =>
      set({
        state: "downloading",
        version: state.version,
        percent: Math.max(0, Math.min(100, Math.round(p?.percent ?? 0))),
      }),
    );
    autoUpdater.on("update-downloaded", (info) => set({ state: "ready", version: info?.version ?? state.version }));
    // 이미 받아 둔 업데이트가 있다면 확인 중 오류가 나도 "준비됨"을 유지한다.
    autoUpdater.on("error", (e) => state.state !== "ready" && set({ state: "error", error: message(e) }));
  }

  const busy = () => ["checking", "downloading", "ready"].includes(state.state);

  return {
    getState: () => ({ ...state, currentVersion }),

    /** 새 버전을 확인한다. (진행 중이거나 이미 받아 둔 경우에는 하지 않는다) */
    async check() {
      if (!enabled || busy()) return;
      try {
        await autoUpdater.checkForUpdates();
      } catch (e) {
        if (state.state !== "ready") set({ state: "error", error: message(e) });
      }
    },

    /** 앱을 시작할 때 한 번 부른다. 잠시 뒤 확인하고, 이후 주기적으로 확인한다. */
    start(timers = { setTimeout, setInterval }) {
      if (!enabled) return () => {};
      const t1 = timers.setTimeout(() => this.check(), checkDelayMs);
      const t2 = timers.setInterval(() => this.check(), intervalMs);
      t1?.unref?.();
      t2?.unref?.();
      return () => {
        clearTimeout(t1);
        clearInterval(t2);
      };
    },

    /** 받아 둔 업데이트를 설치하고 앱을 다시 시작한다. 준비되지 않았으면 false. */
    install() {
      if (state.state !== "ready") return false;
      autoUpdater.quitAndInstall(true, true); // 조용히 설치 + 설치 후 다시 실행
      return true;
    },
  };
}

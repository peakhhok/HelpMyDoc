import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUpdater } from "./updater.mjs";

function fakeAutoUpdater(overrides: Record<string, unknown> = {}) {
  const au = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn(),
    ...overrides,
  }) as EventEmitter & Record<string, any>;
  return au;
}
const make = (au = fakeAutoUpdater(), over: Record<string, unknown> = {}) => ({
  au,
  up: createUpdater({
    autoUpdater: au,
    currentVersion: "0.1.0",
    enabled: true,
    checkDelayMs: 1000,
    intervalMs: 5000,
    ...over,
  }),
});

afterEach(() => vi.useRealTimers());

describe("createUpdater", () => {
  it("꺼져 있으면(개발 실행 등) 아무것도 하지 않는다", async () => {
    const au = fakeAutoUpdater();
    const up = createUpdater({ autoUpdater: au, currentVersion: "0.1.0", enabled: false });
    expect(up.getState()).toEqual({ state: "disabled", currentVersion: "0.1.0" });
    await up.check();
    expect(au.checkForUpdates).not.toHaveBeenCalled();
    expect(up.install()).toBe(false);
    expect(au.quitAndInstall).not.toHaveBeenCalled();
    expect(au.autoDownload).toBeUndefined(); // 설정도 건드리지 않는다
    up.start()();
  });

  it("안전한 기본 설정: 자동으로 받고, 종료할 때 설치하고, 낮은 버전/시험판으로는 가지 않는다", () => {
    const { au } = make();
    expect(au).toMatchObject({
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowDowngrade: false,
      allowPrerelease: false,
    });
  });

  it("확인 → 받는 중 → 준비됨 흐름을 따라간다", () => {
    const { au, up } = make();
    expect(up.getState().state).toBe("idle");
    au.emit("checking-for-update");
    expect(up.getState().state).toBe("checking");
    au.emit("update-available", { version: "0.2.0" });
    expect(up.getState()).toMatchObject({
      state: "downloading",
      version: "0.2.0",
      percent: 0,
      currentVersion: "0.1.0",
    });
    au.emit("download-progress", { percent: 42.6 });
    expect(up.getState()).toMatchObject({ state: "downloading", version: "0.2.0", percent: 43 });
    au.emit("download-progress", { percent: 250 }); // 범위를 벗어난 값은 잘라낸다
    expect(up.getState().percent).toBe(100);
    au.emit("update-downloaded", { version: "0.2.0" });
    expect(up.getState()).toMatchObject({ state: "ready", version: "0.2.0" });
  });

  it("최신 버전이면 idle 로 돌아간다", () => {
    const { au, up } = make();
    au.emit("checking-for-update");
    au.emit("update-not-available", {});
    expect(up.getState().state).toBe("idle");
  });

  it("준비됨일 때만 설치하고, 조용히 설치 + 설치 후 다시 실행으로 호출한다", () => {
    const { au, up } = make();
    expect(up.install()).toBe(false);
    au.emit("update-available", { version: "0.2.0" });
    expect(up.install()).toBe(false); // 아직 받는 중
    au.emit("update-downloaded", { version: "0.2.0" });
    expect(up.install()).toBe(true);
    expect(au.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(au.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it("오류는 메시지(200자까지)와 함께 error 상태가 되고, 이미 받아 둔 업데이트는 오류로 잃지 않는다", () => {
    const { au, up } = make();
    au.emit("error", new Error("x".repeat(500)));
    expect(up.getState().state).toBe("error");
    expect(up.getState().error).toHaveLength(200);

    au.emit("update-downloaded", { version: "0.2.0" });
    au.emit("error", new Error("다음 확인 실패"));
    expect(up.getState()).toMatchObject({ state: "ready", version: "0.2.0" });
    au.emit("checking-for-update");
    au.emit("update-not-available", {});
    expect(up.getState().state).toBe("ready"); // 준비된 상태를 덮어쓰지 않는다
  });

  it("확인 자체가 예외로 실패해도 앱은 멀쩡하고 error 상태가 된다", async () => {
    const { up } = make(fakeAutoUpdater({ checkForUpdates: vi.fn().mockRejectedValue(new Error("네트워크 없음")) }));
    await up.check();
    expect(up.getState()).toMatchObject({ state: "error", error: "네트워크 없음" });
  });

  it("확인 중·받는 중·준비됨일 때는 다시 확인하지 않고, 오류 뒤에는 다시 시도한다", async () => {
    const { au, up } = make();
    au.emit("checking-for-update");
    await up.check();
    au.emit("update-available", { version: "0.2.0" });
    await up.check();
    au.emit("update-downloaded", { version: "0.2.0" });
    await up.check();
    expect(au.checkForUpdates).not.toHaveBeenCalled();

    const b = make();
    b.au.emit("error", new Error("일시적 오류"));
    await b.up.check();
    expect(b.au.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("시작하면 잠시 뒤 한 번 확인하고 이후 주기적으로 확인하며, 정리하면 멈춘다", async () => {
    vi.useFakeTimers();
    const { au, up } = make();
    const stop = up.start();
    expect(au.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1); // 시작 직후(지연 후)
    await vi.advanceTimersByTimeAsync(5000);
    expect(au.checkForUpdates).toHaveBeenCalledTimes(2); // 주기
    stop();
    await vi.advanceTimersByTimeAsync(20000);
    expect(au.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});

describe("checkNow (업데이트 확인 버튼)", () => {
  it("꺼져 있으면 disabled", async () => {
    const au = fakeAutoUpdater();
    const up = createUpdater({ autoUpdater: au, currentVersion: "0.1.0", enabled: false });
    expect(await up.checkNow()).toEqual({ outcome: "disabled", currentVersion: "0.1.0" });
    expect(au.checkForUpdates).not.toHaveBeenCalled();
  });

  it("최신이면 up-to-date", async () => {
    const au = fakeAutoUpdater();
    au.checkForUpdates = vi.fn(async () => {
      au.emit("checking-for-update");
      au.emit("update-not-available", { version: "0.1.0" });
    });
    const { up } = make(au);
    expect(await up.checkNow()).toEqual({ outcome: "up-to-date", currentVersion: "0.1.0" });
    expect(up.getState().state).toBe("idle");
  });

  it("새 버전을 찾으면 available (받기는 계속되고 상태는 downloading)", async () => {
    const au = fakeAutoUpdater();
    au.checkForUpdates = vi.fn(async () => {
      au.emit("checking-for-update");
      au.emit("update-available", { version: "0.2.0" });
    });
    const { up } = make(au);
    expect(await up.checkNow()).toEqual({ outcome: "available", version: "0.2.0", currentVersion: "0.1.0" });
    expect(up.getState()).toMatchObject({ state: "downloading", version: "0.2.0" });
    // 받는 중에 또 누르면 다시 확인하지 않고 같은 답
    expect((await up.checkNow()).outcome).toBe("available");
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("이미 받아 둔 업데이트가 있으면 ready (다시 확인하지 않음)", async () => {
    const au = fakeAutoUpdater();
    const { up } = make(au);
    au.emit("update-downloaded", { version: "0.2.0" });
    expect(await up.checkNow()).toEqual({ outcome: "ready", version: "0.2.0", currentVersion: "0.1.0" });
    expect(au.checkForUpdates).not.toHaveBeenCalled();
  });

  it("확인 중이면 busy", async () => {
    const au = fakeAutoUpdater();
    const { up } = make(au);
    au.emit("checking-for-update");
    expect((await up.checkNow()).outcome).toBe("busy");
  });

  it("오류가 나면 error 와 메시지 (던지지 않음)", async () => {
    const au = fakeAutoUpdater({
      checkForUpdates: vi.fn().mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED")),
    });
    const { up } = make(au);
    expect(await up.checkNow()).toMatchObject({ outcome: "error", error: expect.stringContaining("INTERNET") });
  });
});

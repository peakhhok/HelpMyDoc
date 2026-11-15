import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";

const fakeStorage = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
    data,
  };
};

afterEach(() => vi.unstubAllGlobals());

describe("settings", () => {
  it("localStorage 를 쓸 수 없으면 기본값", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });

  it("저장한 값을 불러오고, 없는 필드는 기본값으로 채운다 (구버전 설정 호환)", () => {
    const st = fakeStorage();
    vi.stubGlobal("localStorage", st);
    saveSettings({ ...DEFAULT_SETTINGS, apiKey: "sk-x", radius: 2 });
    expect(loadSettings()).toMatchObject({ apiKey: "sk-x", radius: 2, provider: "api" });

    const old = fakeStorage({ "helpmydoc.settings.v1": JSON.stringify({ apiKey: "old" }) });
    vi.stubGlobal("localStorage", old);
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, apiKey: "old" });
  });

  it("깨진 JSON 이면 기본값", () => {
    vi.stubGlobal("localStorage", fakeStorage({ "helpmydoc.settings.v1": "{oops" }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

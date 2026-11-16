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
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, apiKey: "old", onboarded: true });
  });

  it("onboarded 필드가 생기기 전부터 쓰던 사용자는 첫 실행 화면을 건너뛴다", () => {
    vi.stubGlobal("localStorage", fakeStorage({ "helpmydoc.settings.v1": JSON.stringify({ apiKey: "old" }) }));
    expect(loadSettings().onboarded).toBe(true);
    // 저장된 설정이 전혀 없는 새 사용자는 첫 실행 화면을 본다
    vi.stubGlobal("localStorage", fakeStorage());
    expect(loadSettings().onboarded).toBe(false);
    // 명시적으로 저장된 값은 존중한다
    vi.stubGlobal("localStorage", fakeStorage({ "helpmydoc.settings.v1": JSON.stringify({ onboarded: false }) }));
    expect(loadSettings().onboarded).toBe(false);
  });

  it("Claude Code 모델은 새 설정에서 Sonnet 이 기본이고, 이미 저장된 선택은 그대로 둔다", () => {
    expect(DEFAULT_SETTINGS.ccModel).toBe("sonnet");
    vi.stubGlobal("localStorage", fakeStorage({ "helpmydoc.settings.v1": JSON.stringify({ ccModel: "" }) }));
    expect(loadSettings().ccModel).toBe(""); // 'Claude Code 기본값'을 골라 둔 사용자
    vi.stubGlobal("localStorage", fakeStorage({ "helpmydoc.settings.v1": JSON.stringify({ apiKey: "x" }) }));
    expect(loadSettings().ccModel).toBe("sonnet"); // 모델을 고른 적 없는 사용자
  });

  it("여러 AI 연결 설정의 기본값: Codex 는 꺼짐, 키와 모델은 비어 있음", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      enableCodex: false,
      codexModel: "",
      openaiKey: "",
      openaiModel: "",
      geminiKey: "",
      geminiModel: "",
    });
  });

  it("예전 설정(새 필드 없음)을 불러와도 새 필드는 기본값으로 채워진다", () => {
    vi.stubGlobal(
      "localStorage",
      fakeStorage({ "helpmydoc.settings.v1": JSON.stringify({ apiKey: "k", provider: "api" }) }),
    );
    expect(loadSettings()).toMatchObject({ apiKey: "k", provider: "api", enableCodex: false, openaiKey: "" });
  });

  it("깨진 JSON 이면 기본값", () => {
    vi.stubGlobal("localStorage", fakeStorage({ "helpmydoc.settings.v1": "{oops" }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

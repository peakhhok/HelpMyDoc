import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../settings";
import { PROVIDERS, getProvider } from "./index";
import { toTranscript } from "./claudeCode";

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

describe("provider registry", () => {
  it("id 로 provider 를 찾고, 알 수 없는 값은 api 로 대체한다", () => {
    expect(getProvider("claude-code").id).toBe("claude-code");
    expect(getProvider("api").id).toBe("api");
    expect(getProvider("nope" as never).id).toBe("api");
  });

  it("레지스트리의 키와 provider.id 가 일치한다", () => {
    for (const [key, p] of Object.entries(PROVIDERS)) expect(p.id).toBe(key);
  });
});

describe("api provider", () => {
  const p = PROVIDERS.api;
  it("키가 없으면 사용 불가", () => {
    expect(p.unavailableReason({ settings: settings({ apiKey: "" }), bridge: null })).toMatch(/API 키/);
    expect(p.unavailableReason({ settings: settings({ apiKey: "sk-x" }), bridge: null })).toBeNull();
  });
});

describe("claude-code provider", () => {
  const p = PROVIDERS["claude-code"];
  const env = (bridge: Parameters<typeof p.unavailableReason>[0]["bridge"]) => ({
    settings: settings({ provider: "claude-code" }),
    bridge,
  });

  it("브리지가 없거나 아직 확인 전이면 사용 불가", () => {
    expect(p.unavailableReason(env(null))).not.toBeNull();
    expect(p.unavailableReason(env({ available: false }))).not.toBeNull();
  });
  it("로그인되지 않았으면 사용 불가, 확인 불가(undefined)는 시도해 본다", () => {
    expect(p.unavailableReason(env({ available: true, loggedIn: false }))).not.toBeNull();
    expect(p.unavailableReason(env({ available: true, loggedIn: true }))).toBeNull();
    expect(p.unavailableReason(env({ available: true }))).toBeNull();
  });
  it("모델 별칭을 사람이 읽는 이름으로 보여준다", () => {
    expect(p.describe(settings({ ccModel: "haiku" }))).toBe("Claude Code · Haiku");
    expect(p.describe(settings({ ccModel: "" }))).toBe("Claude Code · Claude Code 기본값");
  });
});

describe("toTranscript", () => {
  it("이전 대화가 없으면 프롬프트 그대로", () => {
    expect(toTranscript([], "Q")).toBe("Q");
  });
  it("이전 대화를 앞에 붙이고 이번 프롬프트는 맨 뒤에 둔다", () => {
    const t = toTranscript(
      [
        { role: "user", content: "첫 질문" },
        { role: "assistant", content: "첫 답" },
      ],
      "NEXT",
    );
    expect(t).toContain("User: 첫 질문");
    expect(t).toContain("Assistant: 첫 답");
    expect(t.trim().endsWith("NEXT")).toBe(true);
    expect(t.indexOf("첫 질문")).toBeLessThan(t.indexOf("NEXT"));
  });
});

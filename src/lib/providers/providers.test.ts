import { describe, expect, it } from "vitest";
import type { BridgeStatus } from "../bridgeClient";
import { DEFAULT_SETTINGS, type Settings } from "../settings";
import { PROVIDERS, PROVIDER_ORDER, getProvider, providerTitle } from "./index";
import { toTranscript } from "./claudeCode";
import type { ProviderEnv } from "./types";

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });
const env = (
  over: Partial<Settings> = {},
  bridge: BridgeStatus | null = null,
  codex: BridgeStatus | null = null,
): ProviderEnv => ({
  settings: settings(over),
  bridge,
  codex,
});
const ok = (over: Partial<BridgeStatus> = {}): BridgeStatus => ({ bridgeReachable: true, available: true, ...over });

describe("provider registry", () => {
  it("id 로 provider 를 찾고, 알 수 없는 값은 api 로 대체한다", () => {
    expect(getProvider("claude-code").id).toBe("claude-code");
    expect(getProvider("codex").id).toBe("codex");
    expect(getProvider("nope" as never).id).toBe("api");
  });

  it("레지스트리의 키와 provider.id 가 일치하고, 화면 순서가 모든 연결을 빠짐없이 담는다", () => {
    for (const [key, p] of Object.entries(PROVIDERS)) expect(p.id).toBe(key);
    expect([...PROVIDER_ORDER].sort()).toEqual(Object.keys(PROVIDERS).sort());
  });

  it("구독(내 PC의 프로그램)과 API 키로 나뉜다", () => {
    const groups = Object.fromEntries(Object.values(PROVIDERS).map((p) => [p.id, p.group]));
    expect(groups).toEqual({
      "claude-code": "subscription",
      codex: "subscription",
      api: "api",
      openai: "api",
      gemini: "api",
    });
  });

  it("전환 목록 이름", () => {
    expect(providerTitle(PROVIDERS["claude-code"])).toBe("Claude (구독)");
    expect(providerTitle(PROVIDERS.codex)).toBe("ChatGPT (구독)");
    expect(providerTitle(PROVIDERS.api)).toBe("Claude (API 키)");
    expect(providerTitle(PROVIDERS.openai)).toBe("ChatGPT (API 키)");
    expect(providerTitle(PROVIDERS.gemini)).toBe("Gemini (API 키)");
  });
});

describe("api provider (Anthropic)", () => {
  const p = PROVIDERS.api;
  it("키가 없으면 사용 불가", () => {
    expect(p.unavailableReason(env({ apiKey: "" }))).toMatch(/API 키/);
    expect(p.unavailableReason(env({ apiKey: "sk-x" }))).toBeNull();
  });
});

describe("openai / gemini provider", () => {
  for (const [id, keyField, modelField] of [
    ["openai", "openaiKey", "openaiModel"],
    ["gemini", "geminiKey", "geminiModel"],
  ] as const) {
    it(`${id}: 키 → 모델 순서로 요구하고, 둘 다 있어야 사용 가능`, () => {
      const p = PROVIDERS[id];
      expect(p.unavailableReason(env())).toMatch(/API 키가 필요/);
      expect(p.unavailableReason(env({ [keyField]: "k" }))).toMatch(/모델을 골라/);
      expect(p.unavailableReason(env({ [keyField]: "k", [modelField]: "m1" }))).toBeNull();
    });
    it(`${id}: 채팅창 머리말에는 모델 이름을 보여준다`, () => {
      const p = PROVIDERS[id];
      expect(p.describe(settings({ [modelField]: "m1" }))).toBe("m1");
      expect(p.describe(settings())).toBe("모델 미선택");
    });
  }
});

describe("claude-code provider", () => {
  const p = PROVIDERS["claude-code"];

  it("브리지가 없거나 아직 확인 전이면 사용 불가", () => {
    expect(p.unavailableReason(env({}, null))).not.toBeNull();
    expect(p.unavailableReason(env({}, ok({ available: false })))).not.toBeNull();
  });
  it("로그인되지 않았으면 사용 불가, 확인 불가(undefined)는 시도해 본다", () => {
    expect(p.unavailableReason(env({}, ok({ loggedIn: false })))).not.toBeNull();
    expect(p.unavailableReason(env({}, ok({ loggedIn: true })))).toBeNull();
    expect(p.unavailableReason(env({}, ok()))).toBeNull();
  });
  it("모델 별칭을 사람이 읽는 이름으로 보여준다", () => {
    expect(p.describe(settings({ ccModel: "haiku" }))).toBe("Haiku");
    expect(p.describe(settings({ ccModel: "" }))).toBe("Claude Code 기본값");
  });
});

describe("codex provider (ChatGPT 구독, 실험 기능)", () => {
  const p = PROVIDERS.codex;
  const on = { enableCodex: true };

  it("기본은 꺼져 있어 사용할 수 없고, 위험 안내를 확인하고 켜야 한다", () => {
    expect(DEFAULT_SETTINGS.enableCodex).toBe(false);
    expect(p.unavailableReason(env({}, null, ok({ loggedIn: true })))).toMatch(/꺼져 있습니다/);
  });

  it("켠 뒤에는 상태에 따라 안내가 달라진다", () => {
    expect(p.unavailableReason(env(on, null, null))).toMatch(/확인하는 중/);
    expect(p.unavailableReason(env(on, null, { bridgeReachable: false, available: false }))).toMatch(
      /연결할 수 없습니다/,
    );
    expect(p.unavailableReason(env(on, null, ok({ available: false })))).toMatch(/찾을 수 없습니다/);
    expect(p.unavailableReason(env(on, null, ok({ available: false, shimOnly: true })))).toMatch(/실행 파일을 찾지 못/);
    expect(p.unavailableReason(env(on, null, ok({ loggedIn: false })))).toMatch(/codex login/);
  });

  it("설치·로그인되어 있으면(또는 확인 불가면) 사용 가능", () => {
    expect(p.unavailableReason(env(on, null, ok({ loggedIn: true })))).toBeNull();
    expect(p.unavailableReason(env(on, null, ok()))).toBeNull();
  });

  it("Claude Code 상태와는 독립적이다", () => {
    expect(p.unavailableReason(env(on, ok({ loggedIn: false }), ok({ loggedIn: true })))).toBeNull();
    expect(
      PROVIDERS["claude-code"].unavailableReason(env(on, ok({ loggedIn: false }), ok({ loggedIn: true }))),
    ).not.toBeNull();
  });

  it("모델 표시", () => {
    expect(p.describe(settings({ codexModel: "" }))).toBe("기본 모델");
    expect(p.describe(settings({ codexModel: "gpt-x" }))).toBe("gpt-x");
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

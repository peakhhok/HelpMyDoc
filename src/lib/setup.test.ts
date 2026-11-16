import { describe, expect, it } from "vitest";
import type { BridgeStatus } from "./bridgeClient";
import { classifyAuth, describeAuth, evaluateSetup, guessPlatform, installCommands } from "./setup";

const status = (over: Partial<BridgeStatus> = {}): BridgeStatus => ({
  bridgeReachable: true,
  available: true,
  ...over,
});

describe("evaluateSetup", () => {
  it("아직 상태를 모르면 checking", () => {
    expect(evaluateSetup(null).step).toBe("checking");
  });

  it("브리지가 없으면 bridge (설치 여부는 판단하지 않는다)", () => {
    expect(evaluateSetup({ bridgeReachable: false, available: false }).step).toBe("bridge");
  });

  it("Claude Code 가 없으면 install", () => {
    expect(evaluateSetup(status({ available: false })).step).toBe("install");
  });

  it("설치됐지만 로그아웃 상태면 login", () => {
    expect(evaluateSetup(status({ loggedIn: false })).step).toBe("login");
  });

  it("로그인 여부를 알 수 없으면(undefined) 막지 않고 ready 로 본다", () => {
    expect(evaluateSetup(status({ loggedIn: undefined })).step).toBe("ready");
  });

  it("구독 로그인이면 경고 없이 ready", () => {
    expect(evaluateSetup(status({ loggedIn: true, authMethod: "oauth_token" }))).toEqual({
      step: "ready",
      authKind: "subscription",
      warnings: [],
    });
  });

  it("API 키 인증이면 구독이 아니라는 경고를 붙인다", () => {
    const r = evaluateSetup(status({ loggedIn: true, authMethod: "api_key" }));
    expect(r.step).toBe("ready");
    expect(r.authKind).toBe("api-key");
    expect(r.warnings[0]).toMatch(/구독이 아니라 API 키/);
  });

  it("환경변수 ANTHROPIC_API_KEY 가 있으면 과금 경고를 붙인다", () => {
    const r = evaluateSetup(status({ loggedIn: true, authMethod: "oauth_token", apiKeyEnv: true }));
    expect(r.step).toBe("ready");
    expect(r.warnings.join(" ")).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("단계 우선순위: 브리지 > 설치 > 로그인", () => {
    expect(evaluateSetup({ bridgeReachable: false, available: true, loggedIn: false }).step).toBe("bridge");
    expect(evaluateSetup(status({ available: false, loggedIn: false })).step).toBe("install");
  });
});

describe("classifyAuth", () => {
  it("인증 방식을 분류한다", () => {
    expect(classifyAuth("oauth_token")).toBe("subscription");
    expect(classifyAuth("api_key")).toBe("api-key");
    expect(classifyAuth("ANTHROPIC_API_KEY")).toBe("api-key");
    // 버전마다 표기가 다를 수 있다
    expect(classifyAuth("claude.ai")).toBe("subscription");
    expect(classifyAuth("claudeai")).toBe("subscription");
    expect(classifyAuth("OAuth")).toBe("subscription");
    expect(classifyAuth("chatgpt")).toBe("subscription"); // Codex 의 ChatGPT 로그인
    expect(classifyAuth("subscription")).toBe("subscription");
    expect(classifyAuth("something_new")).toBe("other");
    expect(classifyAuth(null)).toBeNull();
    expect(classifyAuth(undefined)).toBeNull();
  });
});

describe("describeAuth", () => {
  it("구독/API 키는 이름으로, 낯선 방식은 원래 값을 함께 보여준다", () => {
    expect(describeAuth("subscription")).toBe("구독 로그인");
    expect(describeAuth("api-key")).toBe("API 키 인증");
    expect(describeAuth("other", "mystery")).toBe("로그인됨 · mystery");
    expect(describeAuth("other")).toBe("로그인됨");
    expect(describeAuth(null)).toBe("로그인됨");
  });
});

describe("installCommands", () => {
  it("OS 별 공식 설치 명령을 돌려준다", () => {
    expect(installCommands("win32")[0].command).toBe("irm https://claude.ai/install.ps1 | iex");
    expect(installCommands("darwin")[0].command).toBe("curl -fsSL https://claude.ai/install.sh | bash");
    expect(installCommands("darwin").map((c) => c.label)).toContain("Homebrew");
    expect(installCommands("linux")[0].command).toBe("curl -fsSL https://claude.ai/install.sh | bash");
  });
  it("OS 를 모르면 리눅스/WSL 명령", () => {
    expect(installCommands(undefined)[0].label).toMatch(/Linux/);
  });
});

describe("guessPlatform", () => {
  it("브라우저 정보로 OS 를 추정한다", () => {
    expect(guessPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("win32");
    expect(guessPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("darwin");
    expect(guessPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });
});

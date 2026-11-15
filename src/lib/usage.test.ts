import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dropExpired,
  formatPercent,
  formatRemaining,
  formatTokens,
  limitLevel,
  loadLimits,
  mergeLimits,
  saveLimits,
} from "./usage";

describe("formatTokens", () => {
  it("읽기 쉬운 단위로 줄인다", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(9949)).toBe("9.9k");
    expect(formatTokens(12_345)).toBe("12k");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });
});

describe("formatPercent / limitLevel", () => {
  it("퍼센트로 표시하고 70%/90%에서 단계가 바뀐다", () => {
    expect(formatPercent(0.47)).toBe("47%");
    expect(formatPercent(1)).toBe("100%");
    expect(limitLevel(0.5)).toBe("ok");
    expect(limitLevel(0.7)).toBe("warn");
    expect(limitLevel(0.89)).toBe("warn");
    expect(limitLevel(0.9)).toBe("high");
  });
});

describe("formatRemaining", () => {
  const now = 1_000_000_000_000; // ms
  const at = (secFromNow: number) => now / 1000 + secFromNow;
  it("남은 시간을 한국어로 표시한다", () => {
    expect(formatRemaining(at(-5), now)).toBe("곧 초기화");
    expect(formatRemaining(at(30), now)).toBe("1분 이내");
    expect(formatRemaining(at(10 * 60), now)).toBe("10분 후");
    expect(formatRemaining(at(2 * 3600 + 13 * 60), now)).toBe("2시간 13분 후");
    expect(formatRemaining(at(3 * 3600), now)).toBe("3시간 후");
    expect(formatRemaining(at(2 * 86400 + 5 * 3600), now)).toBe("2일 5시간 후");
    expect(formatRemaining(at(3 * 86400), now)).toBe("3일 후");
  });
});

describe("mergeLimits", () => {
  it("새 값이 있는 창만 덮어쓰고 나머지는 유지한다", () => {
    const prev = { fiveHour: { utilization: 0.1 }, sevenDay: { utilization: 0.2 } };
    expect(mergeLimits(prev, { fiveHour: { utilization: 0.5 } })).toEqual({
      fiveHour: { utilization: 0.5 },
      sevenDay: { utilization: 0.2 },
    });
    expect(mergeLimits(null, { sevenDay: { utilization: 0.3 } })).toEqual({
      fiveHour: undefined,
      sevenDay: { utilization: 0.3 },
    });
  });
});

describe("dropExpired", () => {
  const now = 1_000_000_000_000;
  it("초기화 시각이 지난 창은 버리고, 남은 게 없으면 null", () => {
    const limits = {
      fiveHour: { utilization: 0.9, resetsAt: now / 1000 - 10 }, // 지남
      sevenDay: { utilization: 0.4, resetsAt: now / 1000 + 1000 },
    };
    expect(dropExpired(limits, now)).toEqual({ fiveHour: undefined, sevenDay: limits.sevenDay });
    expect(dropExpired({ fiveHour: limits.fiveHour }, now)).toBeNull();
    expect(dropExpired(null, now)).toBeNull();
  });
  it("초기화 시각을 모르는 창은 유지한다", () => {
    expect(dropExpired({ fiveHour: { utilization: 0.2 } }, now)?.fiveHour).toEqual({ utilization: 0.2 });
  });
});

describe("loadLimits / saveLimits", () => {
  afterEach(() => vi.unstubAllGlobals());
  const store = (init: Record<string, string> = {}) => {
    const data = { ...init };
    return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
  };

  it("저장한 값을 불러오되 이미 초기화된 창은 제외한다", () => {
    vi.stubGlobal("localStorage", store());
    const now = 2_000_000_000_000;
    saveLimits({
      fiveHour: { utilization: 0.9, resetsAt: now / 1000 - 1 },
      sevenDay: { utilization: 0.4, resetsAt: now / 1000 + 500 },
    });
    expect(loadLimits(now)).toEqual({
      fiveHour: undefined,
      sevenDay: { utilization: 0.4, resetsAt: now / 1000 + 500 },
    });
  });

  it("저장소를 못 쓰거나 깨졌으면 null", () => {
    expect(loadLimits()).toBeNull();
    vi.stubGlobal("localStorage", store({ "helpmydoc.limits.v1": "{oops" }));
    expect(loadLimits()).toBeNull();
  });
});

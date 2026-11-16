/** 답변 하나에 쓰인 토큰 수 (입력은 캐시된 분량 포함) */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
}

/** 구독 한도 창 하나. utilization 은 0~1, resetsAt 은 epoch 초 */
export interface LimitWindow {
  utilization: number;
  resetsAt?: number;
}

/** 구독 한도 상태. 사용률 숫자를 알려주지 않는 옛 버전도 이 값은 알려준다. */
export type LimitStatus = "ok" | "warning" | "rejected";

/** 구독 한도 사용률 (Claude Code 가 답변마다 알려준다) */
export interface UsageLimits {
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  /** 한도 상태 (정상/경고/초과). 저장하지 않는 일시적인 값 */
  status?: LimitStatus;
}

/** 1234 → "1.2k", 12345 → "12k", 1500000 → "1.5M" */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function formatPercent(utilization: number): string {
  return `${Math.round(utilization * 100)}%`;
}

export type LimitLevel = "ok" | "warn" | "high";

/** 70% 부터 주의, 90% 부터 경고 */
export function limitLevel(utilization: number): LimitLevel {
  return utilization >= 0.9 ? "high" : utilization >= 0.7 ? "warn" : "ok";
}

/** 초기화까지 남은 시간 ("2시간 13분 후") */
export function formatRemaining(resetsAtSec: number, nowMs: number): string {
  const sec = Math.round(resetsAtSec - nowMs / 1000);
  if (sec <= 0) return "곧 초기화";
  const min = Math.floor(sec / 60);
  if (min < 1) return "1분 이내";
  if (min < 60) return `${min}분 후`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h}시간 ${m}분 후` : `${h}시간 후`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d}일 ${hh}시간 후` : `${d}일 후`;
}

/** 새 값이 있는 창만 덮어쓴다. (한쪽 창만 오는 응답이 다른 쪽 값을 지우지 않도록) */
export function mergeLimits(prev: UsageLimits | null, next: UsageLimits): UsageLimits {
  return {
    fiveHour: next.fiveHour ?? prev?.fiveHour,
    sevenDay: next.sevenDay ?? prev?.sevenDay,
    status: next.status ?? prev?.status,
  };
}

/** 이미 초기화 시각이 지난 창은 값이 낡았으므로 버린다. 남은 게 없으면 null. */
export function dropExpired(limits: UsageLimits | null, nowMs: number): UsageLimits | null {
  if (!limits) return null;
  const alive = (w?: LimitWindow) => (w && (w.resetsAt === undefined || w.resetsAt * 1000 > nowMs) ? w : undefined);
  const out = { fiveHour: alive(limits.fiveHour), sevenDay: alive(limits.sevenDay) };
  return out.fiveHour || out.sevenDay ? out : null;
}

const KEY = "helpmydoc.limits.v1";

/** 앱을 다시 켜도 마지막으로 알려진 값을 보여주기 위해 저장한다. (사용률 숫자뿐, 개인정보 없음) */
export function loadLimits(nowMs = Date.now()): UsageLimits | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? dropExpired(JSON.parse(raw) as UsageLimits, nowMs) : null;
  } catch {
    return null;
  }
}

export function saveLimits(limits: UsageLimits): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(limits));
  } catch {
    /* ignore */
  }
}

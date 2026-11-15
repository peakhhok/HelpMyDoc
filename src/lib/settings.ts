export const MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (기본)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (빠르고 저렴)" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (고성능)" },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2" },
] as const;

export type ProviderId = "api" | "claude-code";

/** 로컬 Claude Code 에 넘길 모델 별칭 ("" = Claude Code 기본값) */
export const CC_MODELS = [
  { id: "", label: "Claude Code 기본값" },
  { id: "sonnet", label: "Sonnet" },
  { id: "opus", label: "Opus" },
  { id: "haiku", label: "Haiku" },
] as const;

export interface Settings {
  /** api: 내 API 키로 직접 호출 / claude-code: 내 PC의 Claude Code(구독 로그인) */
  provider: ProviderId;
  ccModel: string;
  apiKey: string;
  model: string;
  /** 현재 페이지 앞뒤로 함께 보낼 페이지 수 */
  radius: number;
}

const KEY = "helpmydoc.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  provider: "api",
  ccModel: "",
  apiKey: "",
  model: MODELS[0].id,
  radius: 1,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* localStorage 를 쓸 수 없는 환경이면 기본값 */
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

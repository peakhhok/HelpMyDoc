export const MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (기본)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (빠르고 저렴)" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (고성능)" },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2" },
] as const;

export type ProviderId = "api" | "claude-code";

/**
 * 로컬 Claude Code 에 넘길 모델 별칭.
 * "" 는 --model 을 넘기지 않고 Claude Code 자체 설정(계정·플랜에 따라 다름)을 따른다는 뜻이다.
 */
export const CC_MODELS = [
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
  { id: "opus", label: "Opus" },
  { id: "", label: "Claude Code 기본값" },
] as const;

export interface Settings {
  /** api: 내 API 키로 직접 호출 / claude-code: 내 PC의 Claude Code(구독 로그인) */
  provider: ProviderId;
  ccModel: string;
  apiKey: string;
  model: string;
  /** 현재 페이지 앞뒤로 함께 보낼 페이지 수 */
  radius: number;
  /** 문서별 대화와 마지막으로 본 페이지를 이 PC 에 저장 */
  saveHistory: boolean;
  /** 첫 실행 설정(연결 방식 선택)을 마쳤는가 */
  onboarded: boolean;
}

const KEY = "helpmydoc.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  provider: "api",
  ccModel: "sonnet",
  apiKey: "",
  model: MODELS[0].id,
  radius: 1,
  saveHistory: true,
  onboarded: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const merged: Settings = { ...DEFAULT_SETTINGS, ...saved };
      // 이 필드가 생기기 전부터 쓰던 사용자는 첫 실행 화면을 다시 보여주지 않는다.
      if (saved.onboarded === undefined) merged.onboarded = true;
      return merged;
    }
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

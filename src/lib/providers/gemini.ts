import { SYSTEM_PROMPT } from "../anthropicApi";
import { streamGemini } from "../geminiApi";
import type { Provider } from "./types";

/**
 * 사용자의 Gemini API 키로 브라우저에서 직접 호출한다.
 * Google 계정 로그인(구독) 방식은 Google 약관이 서드파티 도구의 접근을 금지해 지원하지 않는다.
 */
export const geminiProvider: Provider = {
  id: "gemini",
  label: "Gemini API 키",
  short: "Gemini",
  group: "api",
  describe: (s) => s.geminiModel || "모델 미선택",
  unavailableReason: ({ settings }) => {
    if (!settings.geminiKey) return "Gemini API 키가 필요합니다. 설정에서 키를 입력해 주세요.";
    if (!settings.geminiModel) return "사용할 모델을 골라 주세요. 설정에서 '모델 불러오기'를 누르면 목록이 나옵니다.";
    return null;
  },
  stream: (settings, req) =>
    streamGemini({
      apiKey: settings.geminiKey,
      model: settings.geminiModel,
      system: SYSTEM_PROMPT,
      messages: [...req.history, { role: "user", content: req.prompt }],
      signal: req.signal,
      onText: req.onText,
      onUsage: req.onUsage,
    }),
};

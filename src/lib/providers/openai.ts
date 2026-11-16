import { SYSTEM_PROMPT } from "../anthropicApi";
import { streamOpenAI } from "../openaiApi";
import type { Provider } from "./types";

/** 사용자의 OpenAI API 키로 브라우저에서 직접 호출한다. (ChatGPT 구독과는 별개의 종량제) */
export const openaiProvider: Provider = {
  id: "openai",
  label: "ChatGPT API 키",
  short: "ChatGPT",
  group: "api",
  describe: (s) => s.openaiModel || "모델 미선택",
  unavailableReason: ({ settings }) => {
    if (!settings.openaiKey) return "OpenAI API 키가 필요합니다. 설정에서 키를 입력해 주세요.";
    if (!settings.openaiModel) return "사용할 모델을 골라 주세요. 설정에서 '모델 불러오기'를 누르면 목록이 나옵니다.";
    return null;
  },
  stream: (settings, req) =>
    streamOpenAI({
      apiKey: settings.openaiKey,
      model: settings.openaiModel,
      system: SYSTEM_PROMPT,
      messages: [...req.history, { role: "user", content: req.prompt }],
      signal: req.signal,
      onText: req.onText,
      onUsage: req.onUsage,
    }),
};

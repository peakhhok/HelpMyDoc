import { streamClaude } from "../anthropicApi";
import type { Provider } from "./types";

/** 사용자의 Anthropic API 키로 브라우저에서 직접 호출한다. */
export const apiProvider: Provider = {
  id: "api",
  label: "API 키",
  describe: (s) => s.model,
  unavailableReason: ({ settings }) =>
    settings.apiKey
      ? null
      : "API 키가 필요합니다. 설정에서 Anthropic API 키를 입력하거나, '내 PC의 Claude Code'를 선택해 주세요.",
  stream: (settings, req) =>
    streamClaude({
      apiKey: settings.apiKey,
      model: settings.model,
      messages: [...req.history, { role: "user", content: req.prompt }],
      signal: req.signal,
      onText: req.onText,
      onUsage: req.onUsage,
    }),
};

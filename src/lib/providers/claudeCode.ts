import { SYSTEM_PROMPT, type ChatMessage } from "../anthropicApi";
import { streamClaudeCode } from "../bridgeClient";
import { CC_MODELS } from "../settings";
import type { Provider } from "./types";

/** Claude Code 는 매 호출이 독립적이므로(세션 저장 안 함) 이전 대화를 텍스트로 이어 붙인다. */
export function toTranscript(history: ChatMessage[], prompt: string): string {
  if (!history.length) return prompt;
  const past = history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
  return (
    `<conversation_so_far>\n${past}\n</conversation_so_far>\n` +
    `(Earlier turns omit their page context; only the latest message below carries the current <document_context>.)\n\n` +
    prompt
  );
}

/** 내 PC에 설치·로그인된 Claude Code 를 로컬 브리지로 실행한다. (구독 로그인은 Claude Code 가 직접 처리) */
export const claudeCodeProvider: Provider = {
  id: "claude-code",
  label: "Claude Code",
  short: "Claude",
  group: "subscription",
  describe: (s) => CC_MODELS.find((m) => m.id === s.ccModel)?.label ?? s.ccModel,
  unavailableReason: ({ bridge }) =>
    bridge?.available && bridge.loggedIn !== false
      ? null
      : "내 PC의 Claude Code에 연결할 수 없습니다. 설정에서 연결 상태를 확인해 주세요.",
  stream: (settings, req) =>
    streamClaudeCode({
      prompt: toTranscript(req.history, req.prompt),
      system: SYSTEM_PROMPT,
      model: settings.ccModel,
      signal: req.signal,
      onText: req.onText,
      onUsage: req.onUsage,
      onLimits: req.onLimits,
      onTool: req.onTool,
      project: req.project ?? undefined,
    }),
};

import { SYSTEM_PROMPT, streamClaude, type ChatMessage } from "./claude";
import { streamClaudeCode } from "./claudeCode";
import type { Settings } from "./settings";

export interface ProviderRequest {
  /** 이전 턴(질문 원문과 답변만; 문서 문맥은 포함하지 않음) */
  history: ChatMessage[];
  /** 이번 턴: 현재 페이지 문맥 + 질문 */
  prompt: string;
  signal: AbortSignal;
  onText: (delta: string) => void;
}

/** Claude Code 는 매 호출이 독립적이므로(세션 저장 안 함) 이전 대화를 텍스트로 이어 붙인다. */
function toTranscript(history: ChatMessage[], prompt: string): string {
  if (!history.length) return prompt;
  const past = history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
  return (
    `<conversation_so_far>\n${past}\n</conversation_so_far>\n` +
    `(Earlier turns omit their page context; only the latest message below carries the current <document_context>.)\n\n` +
    prompt
  );
}

export function runProvider(settings: Settings, req: ProviderRequest): Promise<void> {
  if (settings.provider === "claude-code") {
    return streamClaudeCode({
      prompt: toTranscript(req.history, req.prompt),
      system: SYSTEM_PROMPT,
      model: settings.ccModel,
      signal: req.signal,
      onText: req.onText,
    });
  }
  return streamClaude({
    apiKey: settings.apiKey,
    model: settings.model,
    messages: [...req.history, { role: "user", content: req.prompt }],
    signal: req.signal,
    onText: req.onText,
  });
}

import type { TurnUsage } from "./usage";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const SYSTEM_PROMPT = `You are an AI study assistant embedded in a PDF reader. The user reads a PDF on the left and chats with you on the right.

With each user message you receive a <document_context> block containing the text of the page the user is currently looking at (current_page, also marked current="true") and a few neighbouring pages. When the user says "this page", "here", "this part" or similar, they mean current_page. If a <selected_text> block is present, the user has highlighted that passage and the question is most likely about it.

Guidelines:
- Always reply in the language of the user's latest message (if they write Korean, answer in Korean), even when the page text is in another language.
- Ground your answers in the provided page text. Cite page numbers like (p.300) when it helps.
- If the page text is empty or garbled (e.g. a scanned page), say so instead of guessing.
- If the question needs content that is not in the provided pages, say what you can and cannot see rather than inventing it.
- Use Markdown; use LaTeX-free plain notation for formulas.`;

export interface StreamOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  onText: (delta: string) => void;
  /** 답변이 끝났을 때 토큰 사용량 */
  onUsage?: (usage: TurnUsage) => void;
}

export class ClaudeError extends Error {}

/** Anthropic Messages API 를 브라우저에서 직접 호출하고 SSE 스트림을 읽는다. */
export async function streamClaude({ apiKey, model, messages, signal, onText, onUsage }: StreamOptions): Promise<void> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // 브라우저에서 사용자 본인의 키로 직접 호출하는 용도임을 명시 (BYOK)
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages,
      stream: true,
    }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.error?.message ?? JSON.stringify(j);
    } catch {
      detail = await res.text().catch(() => "");
    }
    if (res.status === 401) throw new ClaudeError("API 키가 올바르지 않습니다. 설정에서 키를 확인해 주세요.");
    throw new ClaudeError(`요청 실패 (${res.status}) ${detail}`);
  }
  if (!res.body) throw new ClaudeError("응답 스트림을 읽을 수 없습니다.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let evt: any;
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
        onText(evt.delta.text as string);
      } else if (evt.type === "message_start" && evt.message?.usage) {
        const u = evt.message.usage;
        inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        outputTokens = u.output_tokens ?? 0;
        sawUsage = true;
      } else if (evt.type === "message_delta" && typeof evt.usage?.output_tokens === "number") {
        outputTokens = evt.usage.output_tokens; // 누적 값
        sawUsage = true;
      } else if (evt.type === "error") {
        throw new ClaudeError(evt.error?.message ?? "스트리밍 중 오류가 발생했습니다.");
      }
    }
  }

  if (sawUsage) onUsage?.({ inputTokens, outputTokens });
}

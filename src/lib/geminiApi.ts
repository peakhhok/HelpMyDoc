import type { ChatMessage } from "./anthropicApi";
import { sseData } from "./sse";
import type { TurnUsage } from "./usage";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiError extends Error {}

export interface GeminiStreamOptions {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  onText: (delta: string) => void;
  onUsage?: (usage: TurnUsage) => void;
}

async function httpError(res: Response): Promise<GeminiError> {
  let detail = "";
  try {
    detail = (await res.json())?.error?.message ?? "";
  } catch {
    /* ignore */
  }
  if (/api key not valid|API_KEY_INVALID/i.test(detail) || res.status === 401) {
    return new GeminiError("Gemini API 키가 올바르지 않습니다. 설정에서 키를 확인해 주세요.");
  }
  return new GeminiError(`요청 실패 (${res.status}) ${detail}`.trim());
}

/** Gemini generateContent 를 브라우저에서 사용자 본인의 키로 직접 호출하고 SSE 스트림을 읽는다. */
export async function streamGemini({ apiKey, model, system, messages, signal, onText, onUsage }: GeminiStreamOptions) {
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    }),
  });
  if (!res.ok) throw await httpError(res);
  if (!res.body) throw new GeminiError("응답 스트림을 읽을 수 없습니다.");

  let inputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;
  for await (const payload of sseData(res.body)) {
    let evt: any;
    try {
      evt = JSON.parse(payload);
    } catch {
      continue;
    }
    if (evt.error) throw new GeminiError(evt.error.message ?? "스트리밍 중 오류가 발생했습니다.");
    if (evt.promptFeedback?.blockReason)
      throw new GeminiError(`요청이 차단되었습니다 (${evt.promptFeedback.blockReason}).`);
    for (const part of evt.candidates?.[0]?.content?.parts ?? []) {
      // thought: true 는 모델의 내부 추론 요약이라 답변에 섞지 않는다.
      if (typeof part.text === "string" && part.text && !part.thought) onText(part.text);
    }
    const u = evt.usageMetadata;
    if (u) {
      inputTokens = u.promptTokenCount ?? inputTokens;
      outputTokens = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
      sawUsage = true;
    }
  }
  if (sawUsage) onUsage?.({ inputTokens, outputTokens });
}

/** 내 키로 대화에 쓸 수 있는 Gemini 모델 목록. 모델 이름을 하드코딩하지 않는다. */
export async function listGeminiModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${BASE}/models?pageSize=1000`, { signal, headers: { "x-goog-api-key": apiKey } });
  if (!res.ok) throw await httpError(res);
  const j = await res.json();
  const out: string[] = [];
  for (const m of (j?.models ?? []) as Array<{ name?: string; supportedGenerationMethods?: string[] }>) {
    const id = m.name?.replace(/^models\//, "");
    if (id && /^gemini/i.test(id) && m.supportedGenerationMethods?.includes("generateContent")) out.push(id);
  }
  return out.sort().reverse();
}

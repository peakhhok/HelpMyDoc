import type { ChatMessage } from "./anthropicApi";
import { sseData } from "./sse";
import type { TurnUsage } from "./usage";

const BASE = "https://api.openai.com/v1";

export class OpenAIError extends Error {}

export interface OpenAIStreamOptions {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  onText: (delta: string) => void;
  onUsage?: (usage: TurnUsage) => void;
}

async function httpError(res: Response): Promise<OpenAIError> {
  let detail = "";
  try {
    detail = (await res.json())?.error?.message ?? "";
  } catch {
    /* ignore */
  }
  if (res.status === 401) return new OpenAIError("OpenAI API 키가 올바르지 않습니다. 설정에서 키를 확인해 주세요.");
  return new OpenAIError(`요청 실패 (${res.status}) ${detail}`.trim());
}

/** OpenAI Chat Completions 를 브라우저에서 사용자 본인의 키로 직접 호출하고 SSE 스트림을 읽는다. */
export async function streamOpenAI({ apiKey, model, system, messages, signal, onText, onUsage }: OpenAIStreamOptions) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!res.ok) throw await httpError(res);
  if (!res.body) throw new OpenAIError("응답 스트림을 읽을 수 없습니다.");

  let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
  for await (const payload of sseData(res.body)) {
    let evt: any;
    try {
      evt = JSON.parse(payload);
    } catch {
      continue;
    }
    if (evt.error) throw new OpenAIError(evt.error.message ?? "스트리밍 중 오류가 발생했습니다.");
    const delta = evt.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) onText(delta);
    if (evt.usage) usage = evt.usage;
  }
  if (usage) onUsage?.({ inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 });
}

/** 채팅에 쓸 수 있는 모델만 남긴다. (임베딩, 음성, 이미지, 검색 전용 모델 등 제외) */
export function isChatModelId(id: string): boolean {
  return (
    /^(gpt|o\d|chatgpt)/i.test(id) &&
    !/(embedding|whisper|tts|dall-e|image|audio|realtime|transcribe|moderation|search|instruct|davinci|babbage)/i.test(
      id,
    )
  );
}

/** 내 키로 쓸 수 있는 모델 목록. 모델 이름을 하드코딩하지 않아 새 모델이 나와도 그대로 보인다. */
export async function listOpenAIModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${BASE}/models`, { signal, headers: { authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw await httpError(res);
  const j = await res.json();
  const ids: string[] = (j?.data ?? [])
    .map((m: { id?: string }) => m.id)
    .filter((x: unknown): x is string => typeof x === "string");
  return ids.filter(isChatModelId).sort().reverse();
}

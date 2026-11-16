import type { TurnUsage, UsageLimits } from "./usage";

/** 브리지가 실행해 주는 CLI */
export type CliId = "claude-code" | "codex";

/** 로컬 브리지(server/bridge.mjs)를 통해 내 PC의 CLI(Claude Code, Codex)를 호출한다. */
export interface BridgeStatus {
  /** 로컬 브리지에 연결됨. 정적 호스팅(GitHub Pages 등)이면 false */
  bridgeReachable: boolean;
  /** 브리지가 있고 CLI 가 설치되어 있음 */
  available: boolean;
  version?: string;
  /** undefined 면 확인 불가 */
  loggedIn?: boolean;
  authMethod?: string | null;
  /** 브리지가 실행 중인 OS (process.platform) */
  platform?: string;
  /** 환경변수 ANTHROPIC_API_KEY 가 설정돼 있음 (값은 알 수 없다) */
  apiKeyEnv?: boolean;
  /** 윈도우에서 npm 래퍼(.cmd)만 있고 실행할 방법을 찾지 못함 */
  shimOnly?: boolean;
}

export async function fetchBridgeStatus(id: CliId = "claude-code"): Promise<BridgeStatus> {
  try {
    const res = await fetch(`/api/${id}/status`, { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) {
      return { bridgeReachable: false, available: false };
    }
    return { ...(await res.json()), bridgeReachable: true } as BridgeStatus;
  } catch {
    return { bridgeReachable: false, available: false };
  }
}

export class ClaudeCodeError extends Error {}

export interface StreamCliOptions {
  prompt: string;
  system: string;
  model: string;
  signal: AbortSignal;
  onText: (delta: string) => void;
  /** 답변이 끝났을 때 이번 답변의 토큰 수 */
  onUsage?: (usage: TurnUsage) => void;
  /** 구독 한도 사용률 (5시간/7일) — Claude Code 만 알려준다 */
  onLimits?: (limits: UsageLimits) => void;
  /** 화면에 알릴 안내 (예: Codex 가 도구를 쓰려 했음) */
  onNotice?: (text: string) => void;
}

interface CliEvent {
  t: string;
  text?: string;
  message?: string;
  inputTokens?: number;
  outputTokens?: number;
  fiveHour?: UsageLimits["fiveHour"];
  sevenDay?: UsageLimits["sevenDay"];
}

/** 브리지가 NDJSON 으로 보내 주는 응답을 읽는다. */
export async function streamCli(id: CliId, opts: StreamCliOptions): Promise<void> {
  const res = await fetch(`/api/${id}/chat`, {
    method: "POST",
    signal: opts.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: opts.prompt, system: opts.system, model: opts.model || undefined }),
  });
  if (!res.ok || !res.body) {
    let msg = `브리지 요청 실패 (${res.status})`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new ClaudeCodeError(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let evt: CliEvent;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      if (evt.t === "text" && evt.text) opts.onText(evt.text);
      else if (evt.t === "usage")
        opts.onUsage?.({ inputTokens: evt.inputTokens ?? 0, outputTokens: evt.outputTokens ?? 0 });
      else if (evt.t === "limits") opts.onLimits?.({ fiveHour: evt.fiveHour, sevenDay: evt.sevenDay });
      else if (evt.t === "notice" && evt.text) opts.onNotice?.(evt.text);
      else if (evt.t === "error") throw new ClaudeCodeError(evt.message ?? "연결 오류");
    }
  }
}

/** 이전 이름 호환: Claude Code */
export const streamClaudeCode = (opts: StreamCliOptions) => streamCli("claude-code", opts);

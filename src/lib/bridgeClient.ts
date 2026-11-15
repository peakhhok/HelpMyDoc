/** 로컬 브리지(server/bridge.mjs)를 통해 내 PC의 Claude Code 를 호출한다. */
export interface BridgeStatus {
  /** 로컬 브리지에 연결됨. 정적 호스팅(GitHub Pages 등)이면 false */
  bridgeReachable: boolean;
  /** 브리지가 있고 `claude` 가 설치되어 있음 */
  available: boolean;
  version?: string;
  /** undefined 면 확인 불가 */
  loggedIn?: boolean;
  authMethod?: string | null;
  /** 브리지가 실행 중인 OS (process.platform) */
  platform?: string;
  /** 환경변수 ANTHROPIC_API_KEY 가 설정돼 있음 (값은 알 수 없다) */
  apiKeyEnv?: boolean;
}

export async function fetchBridgeStatus(): Promise<BridgeStatus> {
  try {
    const res = await fetch("/api/claude-code/status", { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) {
      return { bridgeReachable: false, available: false };
    }
    return { ...(await res.json()), bridgeReachable: true } as BridgeStatus;
  } catch {
    return { bridgeReachable: false, available: false };
  }
}

export class ClaudeCodeError extends Error {}

export async function streamClaudeCode(opts: {
  prompt: string;
  system: string;
  model: string;
  signal: AbortSignal;
  onText: (delta: string) => void;
}): Promise<void> {
  const res = await fetch("/api/claude-code/chat", {
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
      let evt: { t: string; text?: string; message?: string };
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      if (evt.t === "text" && evt.text) opts.onText(evt.text);
      else if (evt.t === "error") throw new ClaudeCodeError(evt.message ?? "Claude Code 오류");
    }
  }
}

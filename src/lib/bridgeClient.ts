/** 로컬 브리지(server/bridge.mjs)를 통해 내 PC의 Claude Code 를 호출한다. */
export interface BridgeStatus {
  /** 브리지가 있고 `claude` 가 설치되어 있음 */
  available: boolean;
  version?: string;
  /** undefined 면 확인 불가 */
  loggedIn?: boolean;
  authMethod?: string | null;
}

export async function fetchBridgeStatus(): Promise<BridgeStatus> {
  try {
    const res = await fetch("/api/claude-code/status", { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) return { available: false };
    return (await res.json()) as BridgeStatus;
  } catch {
    return { available: false };
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

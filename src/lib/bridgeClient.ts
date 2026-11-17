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
  /** 프로젝트 폴더 연결: 이 폴더에서 읽기 도구(와 허용한 경로의 쓰기)를 열어 실행한다 (Claude Code 만) */
  project?: { dir: string; allowWrite: string[]; git?: boolean; branch?: string };
  /** AI 가 도구로 파일을 읽거나 쓸 때(와 거부됐을 때) */
  onTool?: (tool: ToolEvent) => void;
}

/** 프로젝트 폴더 모드에서 AI 가 한 일. 같은 id 로 결과(오류)가 한 번 더 올 수 있다 */
export interface ToolEvent {
  id: string;
  name?: string;
  target?: string;
  error?: string;
}

interface CliEvent {
  t: string;
  text?: string;
  message?: string;
  inputTokens?: number;
  outputTokens?: number;
  id?: string;
  name?: string;
  target?: string;
  fiveHour?: UsageLimits["fiveHour"];
  sevenDay?: UsageLimits["sevenDay"];
  status?: UsageLimits["status"];
}

/** 브리지가 NDJSON 으로 보내 주는 응답을 읽는다. */
export async function streamCli(id: CliId, opts: StreamCliOptions): Promise<void> {
  const res = await fetch(`/api/${id}/chat`, {
    method: "POST",
    signal: opts.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: opts.prompt,
      system: opts.system,
      model: opts.model || undefined,
      project: opts.project || undefined,
    }),
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

  for await (const evt of ndjson<CliEvent>(res.body)) {
    if (evt.t === "text" && evt.text) opts.onText(evt.text);
    else if (evt.t === "usage")
      opts.onUsage?.({ inputTokens: evt.inputTokens ?? 0, outputTokens: evt.outputTokens ?? 0 });
    else if (evt.t === "limits")
      opts.onLimits?.({ fiveHour: evt.fiveHour, sevenDay: evt.sevenDay, status: evt.status });
    else if (evt.t === "notice" && evt.text) opts.onNotice?.(evt.text);
    else if (evt.t === "tool" && evt.id) opts.onTool?.({ id: evt.id, name: evt.name, target: evt.target });
    else if (evt.t === "tool_error" && evt.id) opts.onTool?.({ id: evt.id, error: evt.message || "거부됨" });
    else if (evt.t === "error") throw new ClaudeCodeError(evt.message ?? "연결 오류");
  }
}

/** 줄 단위 JSON(NDJSON) 응답을 이벤트로 읽는다. 청크가 줄 중간에서 끊겨도 이어 붙이고, 깨진 줄은 건너뛴다. */
async function* ndjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
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
      try {
        yield JSON.parse(line) as T;
      } catch {
        /* 깨진 줄은 건너뛴다 */
      }
    }
  }
}

export interface LoginResult {
  /** 0 이면 로그인 완료 */
  code: number;
  /** 실패했을 때 마지막 출력 (링크는 가려져 있다) */
  tail: string;
}

/**
 * "로그인 시도하기": 브리지가 내 PC의 `claude auth login` 을 실행한다. (고정된 명령 하나뿐)
 * 브라우저에서 로그인하면 Claude Code 가 직접 마무리하고, 이 함수는 끝날 때까지 기다린다.
 * signal 을 중단하면 로그인 프로세스도 종료된다.
 */
export async function startClaudeLogin(opts: { signal: AbortSignal; onOpened?: () => void }): Promise<LoginResult> {
  const res = await fetch("/api/claude-code/login", {
    method: "POST",
    signal: opts.signal,
    headers: { "content-type": "application/json" },
    body: "{}",
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
  for await (const evt of ndjson<{ t: string; code?: number; tail?: string; message?: string }>(res.body)) {
    if (evt.t === "opened") opts.onOpened?.();
    else if (evt.t === "error") throw new ClaudeCodeError(evt.message ?? "로그인 오류");
    else if (evt.t === "exit") return { code: evt.code ?? -1, tail: evt.tail ?? "" };
  }
  return { code: -1, tail: "" }; // 종료 이벤트 없이 연결이 끝남
}

export type ProjectInfo =
  { ok: true; name: string; entries: number; claudeMd: boolean; git: boolean } | { ok: false; error: string };

/** 설정에서 프로젝트 폴더를 확인한다. (브리지가 그 폴더가 있는지, CLAUDE.md 가 있는지 알려 준다) */
export async function fetchProjectInfo(dir: string): Promise<ProjectInfo> {
  try {
    const res = await fetch(`/api/claude-code/project?dir=${encodeURIComponent(dir)}`, { cache: "no-store" });
    const j = await res.json().catch(() => null);
    if (res.ok && j?.ok) return j as ProjectInfo;
    return { ok: false, error: j?.error ?? `확인하지 못했어요 (${res.status})` };
  } catch {
    return { ok: false, error: "앱 안의 브리지에 연결하지 못했어요. 앱을 다시 켜 보세요." };
  }
}

export interface GitStatusInfo {
  ok: true;
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  changed: Array<{ status: string; path: string }>;
  changedCount: number;
  clean: boolean;
  branchMatches: boolean | null;
}
export interface GitSyncResult {
  ok: boolean;
  steps: Array<{ label: string; ok: boolean; output: string }>;
}

/** 앱 버튼용 git: 상태 보기(status) / 동기화(sync: git pull → git push origin <브랜치>). AI 와 무관한 고정 명령이다. */
export async function gitAction(
  action: "status" | "sync",
  dir: string,
  branch: string,
): Promise<{ ok: true; data: GitStatusInfo | GitSyncResult } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/claude-code/git", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, dir, branch }),
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j) return { ok: true, data: j };
    return { ok: false, error: j?.error ?? `요청에 실패했어요 (${res.status})` };
  } catch {
    return { ok: false, error: "앱 안의 브리지에 연결하지 못했어요. 앱을 다시 켜 보세요." };
  }
}

/** 이전 이름 호환: Claude Code */
export const streamClaudeCode = (opts: StreamCliOptions) => streamCli("claude-code", opts);

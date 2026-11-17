import { useCallback, useEffect, useRef, useState } from "react";
import type { UsageLimits } from "./usage";
import { verifyClaudeCode } from "./verify";

export type VerifyPhase = "idle" | "checking" | "ok" | "auth" | "error";

export interface VerifyState {
  phase: VerifyPhase;
  message?: string;
}

/** 로그인이 풀린 동안 다시 확인하는 간격 (실패한 요청은 사용량을 쓰지 않는다). 처음 2분은 촘촘히, 그 뒤로는 드물게 */
const RETRY_FAST_MS = 10_000;
const RETRY_SLOW_MS = 60_000;
const FAST_TRIES = 12;
/** 창으로 돌아왔을 때 이 시간이 지났으면 다시 확인한다 */
const REVERIFY_AFTER_MS = 30 * 60_000;

/**
 * Claude Code 를 실행할 때(그리고 오래 비워 둔 뒤 돌아왔을 때) 실제로 쓸 수 있는지 확인한다.
 * 로그인이 풀린 것으로 확인되면 phase 가 "auth" 가 되고, 풀린 동안은 몇 초마다 조용히 다시 확인해서
 * 터미널이나 앱에서 다시 로그인하면 바로 알아챈다.
 */
export function useClaudeVerify(opts: { enabled: boolean; onLimits: (l: UsageLimits) => void }) {
  const { enabled, onLimits } = opts;
  const [state, setState] = useState<VerifyState>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const lastAt = useRef(0);
  const started = useRef(false);
  const phaseRef = useRef<VerifyPhase>("idle");
  phaseRef.current = state.phase;

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setState((s) => (s.phase === "auth" ? s : { phase: "checking" }));
    try {
      const r = await verifyClaudeCode(ac.signal);
      if (ac.signal.aborted) return;
      lastAt.current = Date.now();
      if (r.status === "ok") {
        if (r.limits) onLimits(r.limits);
        setState({ phase: "ok" });
      } else setState({ phase: r.status, message: r.message });
    } catch {
      /* 중단됨 */
    }
  }, [onLimits]);

  // 실행 직후 한 번
  useEffect(() => {
    if (enabled && !started.current) {
      started.current = true;
      void run();
    }
  }, [enabled, run]);

  // 오래 비워 둔 뒤 창으로 돌아오면 다시
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      if (phaseRef.current === "checking") return;
      if (Date.now() - lastAt.current > REVERIFY_AFTER_MS) void run();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [enabled, run]);

  // 로그인이 풀린 동안: 다시 로그인했는지 확인 (계속 실행하지 않도록 시간이 지나면 간격을 늘린다)
  const tries = useRef(0);
  useEffect(() => {
    if (!enabled || state.phase !== "auth") {
      tries.current = 0;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer = setTimeout(
        async () => {
          tries.current += 1;
          if (document.visibilityState === "visible") await run();
          schedule();
        },
        tries.current < FAST_TRIES ? RETRY_FAST_MS : RETRY_SLOW_MS,
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [enabled, state.phase, run]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /** 질문하다가 로그인 오류를 만났을 때 알린다. */
  const markAuthFailed = useCallback((message: string) => setState({ phase: "auth", message }), []);

  return { state, run, markAuthFailed };
}

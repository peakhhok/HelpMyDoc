// 실행할 때 "정말 쓸 수 있는지" 확인한다. `claude auth status` 는 PC 에 로그인 정보가 남아 있는지만 알려 줄 뿐
// 만료됐는지는 모르므로(재부팅 뒤에 풀린 경우 등), 아주 짧은 요청을 한 번 실제로 보내 본다.
import { streamCli } from "./bridgeClient";
import type { UsageLimits } from "./usage";

/** 오류 문구가 "로그인이 필요하다/풀렸다/만료됐다"는 뜻인지 (한도 초과, 네트워크 오류 등과 구분) */
const AUTH_ERROR =
  /not logged in|\/login|login required|please log ?in|authenticat|oauth token|token (has )?expired|expired token|unauthori[sz]ed|invalid (api )?key|invalid bearer|\b401\b|로그인/i;

export function isAuthError(message: string | null | undefined): boolean {
  return !!message && AUTH_ERROR.test(message);
}

export type VerifyResult =
  | { status: "ok"; limits?: UsageLimits }
  /** 로그인이 풀렸거나 만료됨 */
  | { status: "auth"; message: string }
  /** 그 밖의 이유로 확인하지 못함 (네트워크, 한도 등) — 로그인 문제로 단정하지 않는다 */
  | { status: "error"; message: string };

/** 가장 가볍게 확인하려고 작은 모델을 쓴다. 모델을 못 쓰는 계정이면 "error" 로 분류돼 로그인 문제로 오해하지 않는다. */
const PROBE_MODEL = "haiku";

export async function verifyClaudeCode(signal: AbortSignal): Promise<VerifyResult> {
  let limits: UsageLimits | undefined;
  let text = "";
  try {
    await streamCli("claude-code", {
      prompt: "Reply with exactly: OK",
      system: "This is a connection test. Reply with exactly: OK",
      model: PROBE_MODEL,
      signal,
      onText: (d) => (text += d),
      onLimits: (l) => (limits = l),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    const message = (e as Error).message || "연결을 확인하지 못했어요.";
    return isAuthError(message) ? { status: "auth", message } : { status: "error", message };
  }
  // 답이 왔다면 로그인은 유효하다. (내용이 "Invalid API key" 같은 안내 문구면 인증 문제)
  if (isAuthError(text) && text.length < 300) return { status: "auth", message: text.trim() };
  return { status: "ok", limits };
}

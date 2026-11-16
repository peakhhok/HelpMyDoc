/** 데스크톱 앱의 자동 업데이트 상태 (electron/updater.mjs 가 로컬 서버로 알려준다) */
export type UpdateStateName = "disabled" | "idle" | "checking" | "downloading" | "ready" | "error";

export interface UpdateState {
  state: UpdateStateName;
  /** 지금 실행 중인 버전 */
  currentVersion?: string;
  /** 받는 중이거나 받아 둔 새 버전 */
  version?: string;
  percent?: number;
  error?: string;
}

/** 브라우저 버전처럼 업데이트 API 가 없는 환경이면 null */
export async function fetchUpdateState(): Promise<UpdateState | null> {
  try {
    const res = await fetch("/api/app/update", { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) return null;
    return (await res.json()) as UpdateState;
  } catch {
    return null;
  }
}

/** 받아 둔 업데이트를 설치하고 앱을 다시 시작한다. */
export async function installUpdate(): Promise<boolean> {
  try {
    const res = await fetch("/api/app/update/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface UpdateNotice {
  text: string;
  /** 있으면 버튼을 보여준다 */
  action?: "install";
}

/** 화면에 알릴 만한 상태만 문구로 바꾼다. 평소(확인 중, 최신, 오류 등)에는 조용히 있는다. */
export function describeUpdate(s: UpdateState | null): UpdateNotice | null {
  if (!s) return null;
  const v = s.version ? `(v${s.version})` : "";
  if (s.state === "downloading") return { text: `새 버전${v}을 받는 중… ${s.percent ?? 0}%` };
  if (s.state === "ready") return { text: `새 버전${v}이 준비됐어요.`, action: "install" };
  return null;
}

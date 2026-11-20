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

export type CheckOutcome = "disabled" | "busy" | "ready" | "available" | "up-to-date" | "error";

export interface CheckResult {
  outcome: CheckOutcome;
  currentVersion?: string;
  version?: string;
  error?: string;
}

/** "업데이트 확인"을 눌렀을 때: 지금 확인하고 결과를 받는다. (업데이트 API 가 없는 브라우저 버전이면 null) */
export async function checkForUpdate(): Promise<CheckResult | null> {
  try {
    const res = await fetch("/api/app/update/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) return null;
    return (await res.json()) as CheckResult;
  } catch {
    return null;
  }
}

/** 확인 결과를 한 줄 안내로 */
export function describeCheck(r: CheckResult): string {
  const cur = r.currentVersion ? `v${r.currentVersion}` : "현재 버전";
  const v = r.version ? `v${r.version}` : "새 버전";
  switch (r.outcome) {
    case "up-to-date":
      return `최신 버전이에요 (${cur}).`;
    case "available":
      return `${v}을(를) 찾았어요. 백그라운드로 받는 중이고, 끝나면 화면 위에서 알려 드려요.`;
    case "ready":
      return `${v}이(가) 준비됐어요. 화면 위의 "다시 시작해서 업데이트"를 누르면 설치돼요.`;
    case "busy":
      return "이미 확인하는 중이에요. 잠시 뒤에 다시 눌러 주세요.";
    case "disabled":
      return "이 실행에서는 자동 업데이트가 꺼져 있어요. (설치형 앱에서만 동작하고, 개발 실행이나 업데이트를 끈 경우는 안 돼요) GitHub Releases에서 직접 내려받으세요.";
    default:
      return `업데이트를 확인하지 못했어요${r.error ? `: ${r.error}` : ""}. 인터넷 연결을 확인해 주세요.`;
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

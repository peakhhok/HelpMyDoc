// 데스크톱 앱(Electron)에서만 있는 기능: 파일의 실제 경로를 알고, 최근에 연 문서를 기억했다가 다시 연다.
// 브라우저 버전에는 이 객체가 없으므로 모든 함수는 없을 때 조용히 아무것도 하지 않는다.

export interface RecentDoc {
  path: string;
  name: string;
  at: number;
  /** 지금 그 경로에 파일이 있는가 */
  exists: boolean;
}

export type ReadResult =
  | { ok: true; name: string; data: Uint8Array }
  | { ok: false; reason: "unknown" | "missing" | "too-big" | "error"; name?: string };

interface DesktopApi {
  version: number;
  pathForFile(file: File): string;
  remember(path: string): Promise<boolean>;
  recent(): Promise<RecentDoc[]>;
  read(path: string): Promise<ReadResult>;
}

declare global {
  interface Window {
    helpmydocDesktop?: DesktopApi;
  }
}

export function desktop(): DesktopApi | null {
  return typeof window !== "undefined" ? (window.helpmydocDesktop ?? null) : null;
}

/** 방금 연 파일을 "최근 문서"로 기억한다. (경로를 알 수 없는 파일 — 메모리에서 만든 것 등 — 은 건너뛴다) */
export async function rememberOpened(file: File): Promise<void> {
  const d = desktop();
  if (!d) return;
  try {
    const path = d.pathForFile(file);
    if (path) await d.remember(path);
  } catch {
    /* 기억하지 못해도 문서는 열려 있다 */
  }
}

export async function listRecent(): Promise<RecentDoc[]> {
  try {
    return (await desktop()?.recent()) ?? [];
  } catch {
    return [];
  }
}

/** 최근 문서를 못 읽었을 때 보여줄 문구 */
export function readFailureMessage(r: Extract<ReadResult, { ok: false }>): string {
  const n = r.name ? `"${r.name}"` : "문서";
  if (r.reason === "missing") return `${n}을(를) 찾을 수 없어요. 옮기거나 지웠을 수 있어요.`;
  if (r.reason === "too-big") return `${n}이(가) 너무 커서 자동으로 열지 못했어요. 직접 열어 주세요.`;
  return `${n}을(를) 열지 못했어요.`;
}

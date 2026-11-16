// 문서 스캔: 사용자가 요청하면 AI 가 문서를 구간별로 한 번 훑어 구간 요약(개요)을 만든다.
// 만든 개요는 문서별로 저장하고, 이후 질문에는 "전체 목차 + 현재 구간 요약"만 덧붙인다.
// (질문할 때마다 문서 전체를 보내지 않는다.)

export interface ScanChunk {
  from: number;
  to: number;
  title: string;
  summary: string;
}

export interface ScanData {
  version: 1;
  /** 스캔에 쓴 AI (연결 방식 id) */
  provider: string;
  chunks: ScanChunk[];
  updatedAt: number;
}

export interface PlannedChunk {
  from: number;
  to: number;
  /** 이 구간의 글자 수 */
  chars: number;
  /** 텍스트가 있는 쪽 수 */
  textPages: number;
}

/** 한 번의 요청에 담는 글자 수와 쪽 수의 상한 */
export const CHUNK_MAX_CHARS = 24_000;
export const CHUNK_MAX_PAGES = 30;
/** 한 쪽에서 읽는 최대 글자 수 (질문 문맥과 같은 값) */
export const PAGE_MAX_CHARS = 12_000;
/** 질문에 덧붙이는 목차의 최대 글자 수 */
export const OUTLINE_MAX_CHARS = 6_000;
const SUMMARY_MAX_CHARS = 1_800;
const TITLE_MAX_CHARS = 100;

/** 쪽별 글자 수로 구간을 나눈다. 같은 입력이면 항상 같은 구간이 나온다(이어하기에 필요). */
export function planChunks(pageChars: number[]): PlannedChunk[] {
  const out: PlannedChunk[] = [];
  let cur: PlannedChunk | null = null;
  pageChars.forEach((raw, i) => {
    const page = i + 1;
    const chars = Math.min(raw, PAGE_MAX_CHARS);
    if (cur && (cur.chars + chars > CHUNK_MAX_CHARS || cur.to - cur.from + 1 >= CHUNK_MAX_PAGES)) {
      out.push(cur);
      cur = null;
    }
    if (!cur) cur = { from: page, to: page, chars: 0, textPages: 0 };
    cur.to = page;
    cur.chars += chars;
    if (raw > 0) cur.textPages += 1;
  });
  if (cur) out.push(cur);
  // 텍스트가 전혀 없는 구간(스캔본 등)은 읽을 수 없으므로 뺀다.
  return out.filter((c) => c.textPages > 0);
}

export interface ScanEstimate {
  chunks: number;
  /** 읽을 글자 수 */
  chars: number;
  /** 텍스트가 없어 읽을 수 없는 쪽 */
  emptyPages: number[];
  /** 대략의 입력 토큰 수 (한글 기준으로 넉넉하게 잡은 값) */
  approxTokens: number;
}

export function estimateScan(pageChars: number[]): ScanEstimate {
  const plan = planChunks(pageChars);
  const chars = plan.reduce((a, c) => a + c.chars, 0);
  const emptyPages = pageChars.flatMap((c, i) => (c === 0 ? [i + 1] : []));
  return { chunks: plan.length, chars, emptyPages, approxTokens: Math.round(chars / 2) };
}

export function chunkKey(c: { from: number; to: number }): string {
  return `${c.from}-${c.to}`;
}

/** 이미 끝난 구간을 뺀 남은 구간 */
export function remainingChunks(plan: PlannedChunk[], scan: ScanData | null | undefined): PlannedChunk[] {
  const done = new Set((scan?.chunks ?? []).map(chunkKey));
  return plan.filter((c) => !done.has(chunkKey(c)));
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const SCAN_INSTRUCTION =
  "이 구간은 문서 전체를 훑어 개요를 만드는 작업의 일부입니다. 위 내용만 근거로, 아래 형식으로만 한국어로 답하세요. 다른 말은 덧붙이지 마세요.\n" +
  "TITLE: <이 구간의 주제를 한 줄로>\n" +
  "SUMMARY:\n" +
  "- <핵심 내용, 정의, 용어, 수치를 불릿으로 (최대 8개). 어느 쪽 내용인지 (p.N) 로 표시>\n" +
  "- <공부할 때 놓치기 쉬운 포인트가 있으면 마지막에>";

/** 구간 하나를 읽히는 요청 본문 (질문 문맥과 같은 <document_context> 형식) */
export function buildScanPrompt(opts: {
  fileName: string;
  numPages: number;
  chunk: { from: number; to: number };
  pageTexts: Array<{ page: number; text: string }>;
}): string {
  const { fileName, numPages, chunk, pageTexts } = opts;
  const pages = pageTexts
    .map((p) => {
      let text = p.text;
      if (text.length > PAGE_MAX_CHARS) text = text.slice(0, PAGE_MAX_CHARS) + "\n…(truncated)";
      return `<page number="${p.page}">\n${text || "(no extractable text)"}\n</page>`;
    })
    .join("\n");
  return (
    `<document_context file="${escapeXml(fileName)}" total_pages="${numPages}" scan_range="${chunk.from}-${chunk.to}">\n` +
    pages +
    `\n</document_context>\n\n${SCAN_INSTRUCTION}`
  );
}

/** AI 의 답에서 제목과 요약을 꺼낸다. 형식을 안 지켰어도 답 전체를 요약으로 쓴다. */
export function parseScanReply(reply: string, chunk: { from: number; to: number }): ScanChunk {
  const text = reply.replace(/\r/g, "").trim();
  const fallbackTitle = chunk.from === chunk.to ? `p.${chunk.from}` : `p.${chunk.from}–${chunk.to}`;
  const t = text.match(/^\s*(?:\*\*)?TITLE(?:\*\*)?\s*[:：]\s*(.+)$/im);
  const s = text.match(/^\s*(?:\*\*)?SUMMARY(?:\*\*)?\s*[:：]\s*([\s\S]*)$/im);
  const title = (t?.[1] ?? "").replace(/\*\*/g, "").trim() || fallbackTitle;
  let summary = (s ? s[1] : t ? text.replace(t[0], "") : text).trim();
  if (summary.length > SUMMARY_MAX_CHARS) summary = summary.slice(0, SUMMARY_MAX_CHARS) + "…";
  return { from: chunk.from, to: chunk.to, title: title.slice(0, TITLE_MAX_CHARS), summary };
}

export interface ScanProgress {
  done: number;
  total: number;
  /** 지금 읽고 있는 구간 */
  current?: { from: number; to: number };
}

/**
 * 남은 구간을 차례로 읽힌다. 한 구간이 끝날 때마다 onChunk 로 알리므로
 * 중간에 중지하거나 오류가 나도 지금까지 한 것은 남는다.
 * 중지되면 AbortError 를 던지고, AI 오류는 그대로 던진다.
 */
export async function runScan(opts: {
  plan: PlannedChunk[];
  existing: ScanData | null | undefined;
  /** 한 구간의 요청 본문을 만든다 (쪽 텍스트 추출은 호출한 쪽이 한다) */
  buildPrompt: (chunk: PlannedChunk) => Promise<string>;
  /** AI 에게 물어 답 전체를 받는다 */
  ask: (prompt: string, signal: AbortSignal) => Promise<string>;
  signal: AbortSignal;
  onProgress: (p: ScanProgress) => void;
  onChunk: (chunk: ScanChunk) => void;
}): Promise<void> {
  const { plan, existing, signal } = opts;
  const todo = remainingChunks(plan, existing);
  const already = plan.length - todo.length;
  for (let i = 0; i < todo.length; i++) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    const c = todo[i];
    opts.onProgress({ done: already + i, total: plan.length, current: { from: c.from, to: c.to } });
    const prompt = await opts.buildPrompt(c);
    const reply = await opts.ask(prompt, signal);
    if (!reply.trim()) throw new Error(`AI 가 빈 답을 보냈어요 (p.${c.from}–${c.to}). 잠시 뒤 이어서 해 보세요.`);
    opts.onChunk(parseScanReply(reply, c));
  }
  opts.onProgress({ done: plan.length, total: plan.length });
}

/** 구간 목록에 새 결과를 넣는다 (같은 구간이면 교체, 쪽 순서로 정렬). */
export function upsertChunk(scan: ScanData | null | undefined, provider: string, chunk: ScanChunk): ScanData {
  const rest = (scan?.chunks ?? []).filter((c) => chunkKey(c) !== chunkKey(chunk));
  return {
    version: 1,
    provider,
    chunks: [...rest, chunk].sort((a, b) => a.from - b.from),
    updatedAt: Date.now(),
  };
}

export function sanitizeScan(raw: unknown): ScanData | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.chunks)) return null;
  const chunks: ScanChunk[] = [];
  for (const c of o.chunks) {
    if (!c || typeof c !== "object") continue;
    const x = c as Record<string, unknown>;
    if (typeof x.from !== "number" || typeof x.to !== "number" || typeof x.summary !== "string") continue;
    chunks.push({ from: x.from, to: x.to, title: typeof x.title === "string" ? x.title : "", summary: x.summary });
  }
  if (chunks.length === 0) return null;
  return {
    version: 1,
    provider: typeof o.provider === "string" ? o.provider : "",
    chunks: chunks.sort((a, b) => a.from - b.from),
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : 0,
  };
}

/**
 * 질문에 덧붙일 개요: 스캔한 구간의 목차 전체 + 지금 보는 쪽이 속한 구간의 요약.
 * 스캔 결과가 없으면 빈 문자열.
 */
export function buildOverview(scan: ScanData | null | undefined, currentPage: number): string {
  const chunks = scan?.chunks ?? [];
  if (chunks.length === 0) return "";
  const range = (c: { from: number; to: number }) => (c.from === c.to ? `p.${c.from}` : `p.${c.from}–${c.to}`);
  let outline = "";
  for (const c of chunks) {
    const line = `${range(c)}  ${c.title || "(제목 없음)"}\n`;
    if (outline.length + line.length > OUTLINE_MAX_CHARS) {
      outline += "…(이하 생략)\n";
      break;
    }
    outline += line;
  }
  const here = chunks.find((c) => currentPage >= c.from && currentPage <= c.to);
  const hereText = here ? `\n[지금 보는 구간 ${range(here)} 요약]\n${here.summary}\n` : "";
  return `<document_overview note="${escapeXml(
    "사용자가 요청해 문서를 미리 훑어 만든 구간별 요약입니다. 정확한 내용은 document_context 의 원문을 우선하세요.",
  )}">\n[목차]\n${outline}${hereText}</document_overview>`;
}

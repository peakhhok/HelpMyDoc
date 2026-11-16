// 비슷한 내용이 나온 다른 쪽 찾기. 전부 이 PC 안에서 계산하므로 AI 사용량을 쓰지 않는다.
// 쪽마다 용어(영문 단어, 한글 2글자 조각)를 세어 TF-IDF 코사인 유사도로 비교한다.

const STOP = new Set([
  "is",
  "on",
  "in",
  "to",
  "of",
  "or",
  "an",
  "as",
  "at",
  "be",
  "by",
  "it",
  "if",
  "we",
  "do",
  "no",
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "are",
  "was",
  "you",
  "your",
  "from",
  "have",
  "has",
  "not",
  "can",
  "will",
  "but",
  "all",
  "any",
  "use",
  "used",
  "using",
  "page",
  "when",
  "which",
  "such",
  "also",
  "into",
  "than",
  "then",
  "they",
  "their",
  "there",
  "these",
  "those",
  "each",
  "more",
  "other",
  "only",
  "must",
  "should",
  "would",
  "could",
  "may",
]);

/** 글을 비교용 조각으로 쪼갠다: 영문/숫자 단어(식별자의 -_. 포함)와 한글 2글자 조각. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/[a-z0-9]+(?:[-_.][a-z0-9]+)*/g)) {
    const w = m[0];
    if (/^\d+$/.test(w)) continue;
    if (w.length >= 2 && !STOP.has(w)) out.push(w);
    if (/[-_.]/.test(w)) {
      for (const part of w.split(/[-_.]/)) {
        if (part.length >= 3 && !STOP.has(part) && !/^\d+$/.test(part)) out.push(part);
      }
    }
  }
  for (const m of lower.matchAll(/[가-힣]+/g)) {
    const run = m[0];
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

export interface PageIndex {
  numPages: number;
  /** 쪽별 {용어 → 가중치(tf*idf)} (인덱스 0 이 1쪽) */
  vectors: Array<Map<string, number>>;
  norms: number[];
  idf: Map<string, number>;
  /** 발췌를 만들 원문 */
  texts: string[];
}

const MAX_INDEX_CHARS = 8000;

/** 쪽별 원문으로 색인을 만든다. extra 는 AI 가 스캔 때 적어 둔 핵심 용어 등 덧붙일 글 (두 번 센다). */
export function buildIndex(texts: string[], extra?: (page: number) => string): PageIndex {
  const n = texts.length;
  const counts: Array<Map<string, number>> = [];
  const df = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const c = new Map<string, number>();
    const add = (tokens: string[], w: number) => {
      for (const t of tokens) c.set(t, (c.get(t) ?? 0) + w);
    };
    add(tokenize(texts[i].slice(0, MAX_INDEX_CHARS)), 1);
    const more = extra?.(i + 1);
    if (more) add(tokenize(more), 2);
    counts.push(c);
    for (const t of c.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log((n + 1) / (d + 0.5)));
  const vectors: Array<Map<string, number>> = [];
  const norms: number[] = [];
  for (const c of counts) {
    const v = new Map<string, number>();
    let sum = 0;
    for (const [t, cnt] of c) {
      const w = (1 + Math.log(cnt)) * (idf.get(t) ?? 0);
      if (w > 0) {
        v.set(t, w);
        sum += w * w;
      }
    }
    vectors.push(v);
    norms.push(Math.sqrt(sum));
  }
  return { numPages: n, vectors, norms, idf, texts };
}

export interface RelatedPage {
  page: number;
  /** 0~1 (클수록 비슷) */
  score: number;
  /** 겹친 용어 (영문 위주, 사람이 읽을 수 있는 것만) */
  terms: string[];
  /** 발췌할 곳을 찾는 데 쓰는, 겹친 모든 조각 (한글 조각 포함) */
  matches: string[];
}

export interface FindOptions {
  /** 비교에서 뺄 쪽 (이미 질문에 포함된 쪽 등) */
  exclude?: (page: number) => boolean;
  k?: number;
  /** 이 점수 미만은 "비슷하지 않음"으로 본다 */
  minScore?: number;
}

const QUERY_TERMS = 60;

/**
 * 검색글(지금 보는 쪽 + 선택 + 질문)과 내용이 비슷한 쪽을 찾는다.
 * 검색글은 한 번만 나오는 용어보다 이 문서에서 드문 용어를 중요하게 본다.
 */
export function findRelated(
  index: PageIndex,
  query: Array<{ text: string; weight?: number }>,
  opts: FindOptions = {},
): RelatedPage[] {
  const { exclude, k = 4, minScore = 0.12 } = opts;
  const q = new Map<string, number>();
  for (const part of query) {
    for (const t of tokenize(part.text.slice(0, MAX_INDEX_CHARS))) q.set(t, (q.get(t) ?? 0) + (part.weight ?? 1));
  }
  const weighted: Array<[string, number]> = [];
  for (const [t, c] of q) {
    const idf = index.idf.get(t);
    if (idf && idf > 0) weighted.push([t, (1 + Math.log(c)) * idf]);
  }
  weighted.sort((a, b) => b[1] - a[1]);
  const top = weighted.slice(0, QUERY_TERMS);
  const qnorm = Math.sqrt(top.reduce((s, [, w]) => s + w * w, 0));
  if (qnorm === 0) return [];

  const found: RelatedPage[] = [];
  for (let i = 0; i < index.numPages; i++) {
    const page = i + 1;
    if (exclude?.(page) || index.norms[i] === 0) continue;
    const v = index.vectors[i];
    let dot = 0;
    const hits: Array<[string, number]> = [];
    for (const [t, w] of top) {
      const pw = v.get(t);
      if (pw) {
        dot += w * pw;
        hits.push([t, w * pw]);
      }
    }
    if (hits.length < 2) continue;
    const score = dot / (qnorm * index.norms[i]);
    if (score < minScore) continue;
    hits.sort((a, b) => b[1] - a[1]);
    // 한글 2글자 조각은 사람이 읽기 어려우므로 영문 용어만 보여준다.
    const terms = hits
      .map(([t]) => t)
      .filter((t) => /[a-z0-9]/.test(t))
      .slice(0, 5);
    found.push({ page, score, terms, matches: hits.slice(0, 12).map(([t]) => t) });
  }
  return found.sort((a, b) => b.score - a.score).slice(0, k);
}

/** 쪽 원문에서 겹친 용어가 가장 몰려 있는 곳을 잘라 보여준다. */
export function bestExcerpt(text: string, terms: string[], maxChars = 450): string {
  const t = text.replace(/[ \t]+/g, " ").trim();
  if (t.length <= maxChars) return t;
  const lower = t.toLowerCase();
  const keys = terms.map((x) => x.toLowerCase()).filter(Boolean);
  if (keys.length === 0) return t.slice(0, maxChars) + "…";
  const step = Math.max(40, Math.floor(maxChars / 6));
  let bestAt = 0;
  let best = -1;
  for (let at = 0; at < t.length; at += step) {
    const win = lower.slice(at, at + maxChars);
    let s = 0;
    for (const k of keys) if (win.includes(k)) s += 1;
    if (s > best) {
      best = s;
      bestAt = at;
    }
  }
  const slice = t.slice(bestAt, bestAt + maxChars).trim();
  return (bestAt > 0 ? "…" : "") + slice + (bestAt + maxChars < t.length ? "…" : "");
}

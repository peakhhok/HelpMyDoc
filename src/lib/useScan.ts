import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getPageText } from "./pdf";
import { getProvider } from "./providers";
import {
  buildScanPrompt,
  estimateScan,
  planChunks,
  remainingChunks,
  runScan,
  upsertChunk,
  type ScanData,
  type ScanEstimate,
  type ScanProgress,
  type PlannedChunk,
} from "./scan";
import type { Settings } from "./settings";
import type { UsageLimits } from "./usage";

interface Options {
  doc: PDFDocumentProxy | null;
  fileName: string;
  settings: Settings;
  /** 지금 AI 를 쓸 수 없다면 그 이유 (null 이면 사용 가능) */
  unavailable: string | null;
  scan: ScanData | null;
  changeScan: (update: (prev: ScanData | null) => ScanData | null) => void;
  onLimits: (limits: UsageLimits) => void;
}

/** 문서 스캔의 진행 상태. 대화상자를 닫아도 스캔은 계속된다. */
export function useScan({ doc, fileName, settings, unavailable, scan, changeScan, onLimits }: Options) {
  const [pageChars, setPageChars] = useState<number[] | null>(null);
  const [analyzing, setAnalyzing] = useState<{ done: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const analyzeRef = useRef<Promise<number[]> | null>(null);
  // runScan 이 시작할 때 최신 스캔 결과를 보도록 ref 로 들고 있는다.
  const scanRef = useRef(scan);
  scanRef.current = scan;

  // 다른 문서를 열면 이전 문서의 스캔은 멈추고 상태를 비운다.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      analyzeRef.current = null;
      setPageChars(null);
      setAnalyzing(null);
      setRunning(false);
      setProgress(null);
      setError(null);
    };
  }, [doc]);

  /** 쪽별 글자 수를 센다 (페이지 텍스트는 질문할 때와 같은 캐시를 쓴다). */
  const analyze = useCallback((): Promise<number[]> => {
    if (!doc) return Promise.resolve([]);
    if (pageChars) return Promise.resolve(pageChars);
    if (analyzeRef.current) return analyzeRef.current;
    const task = (async () => {
      const out: number[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        out.push((await getPageText(doc, p)).length);
        if (p % 10 === 0 || p === doc.numPages) setAnalyzing({ done: p, total: doc.numPages });
      }
      setPageChars(out);
      setAnalyzing(null);
      return out;
    })();
    analyzeRef.current = task;
    task.catch(() => {
      analyzeRef.current = null;
      setAnalyzing(null);
    });
    return task;
  }, [doc, pageChars]);

  const plan: PlannedChunk[] = useMemo(() => (pageChars ? planChunks(pageChars) : []), [pageChars]);
  const estimate: ScanEstimate | null = useMemo(() => (pageChars ? estimateScan(pageChars) : null), [pageChars]);
  const remaining = remainingChunks(plan, scan).length;

  const start = useCallback(async () => {
    if (!doc || running) return;
    if (unavailable) return setError(unavailable);
    setError(null);
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const provider = getProvider(settings.provider);
    try {
      const chars = await analyze();
      const fullPlan = planChunks(chars);
      await runScan({
        plan: fullPlan,
        existing: scanRef.current,
        signal: ac.signal,
        buildPrompt: async (chunk) => {
          const pageTexts: Array<{ page: number; text: string }> = [];
          for (let p = chunk.from; p <= chunk.to; p++) pageTexts.push({ page: p, text: await getPageText(doc, p) });
          return buildScanPrompt({ fileName, numPages: doc.numPages, chunk, pageTexts });
        },
        ask: async (prompt, signal) => {
          let out = "";
          await provider.stream(settings, {
            history: [],
            prompt,
            signal,
            onText: (d) => (out += d),
            onLimits,
          });
          return out;
        },
        onProgress: setProgress,
        onChunk: (chunk) => changeScan((prev) => upsertChunk(prev, provider.id, chunk)),
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message || "스캔에 실패했어요.");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [doc, running, unavailable, settings, analyze, fileName, onLimits, changeScan]);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { analyze, analyzing, estimate, plan, remaining, running, progress, error, start, cancel, setError };
}

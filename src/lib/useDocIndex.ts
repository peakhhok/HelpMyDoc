import { useCallback, useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getPageText } from "./pdf";
import { buildIndex, type PageIndex } from "./related";
import { digestMap, type ScanData } from "./scan";

/**
 * 문서의 "비슷한 쪽 찾기" 색인. 문서를 열면 백그라운드로 만들어 두고,
 * 스캔 결과(AI 가 적은 쪽별 핵심 용어)가 바뀌면 다시 만든다.
 */
export function useDocIndex(doc: PDFDocumentProxy | null, scan: ScanData | null): () => Promise<PageIndex | null> {
  const cache = useRef<{ doc: PDFDocumentProxy; stamp: string; promise: Promise<PageIndex | null> } | null>(null);
  const stamp = `${scan?.updatedAt ?? 0}:${scan?.chunks.length ?? 0}`;

  const get = useCallback((): Promise<PageIndex | null> => {
    if (!doc) return Promise.resolve(null);
    const hit = cache.current;
    if (hit && hit.doc === doc && hit.stamp === stamp) return hit.promise;
    const promise = (async () => {
      try {
        const texts: string[] = [];
        for (let p = 1; p <= doc.numPages; p++) texts.push(await getPageText(doc, p));
        const digests = digestMap(scan);
        return buildIndex(texts, (p) => {
          const d = digests.get(p);
          return d ? `${d.point} ${d.terms.join(" ")}` : "";
        });
      } catch {
        return null;
      }
    })();
    cache.current = { doc, stamp, promise };
    return promise;
  }, [doc, scan, stamp]);

  useEffect(() => {
    void get();
  }, [get]);

  return get;
}

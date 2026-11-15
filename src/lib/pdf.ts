import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const base = `${import.meta.env.BASE_URL}pdfjs/`;

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({
    data,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
  }).promise;
}

const textCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<string>>>();

/** 한 페이지의 텍스트를 추출한다 (문서별로 캐시). 스캔본이면 빈 문자열이 나온다. */
export function getPageText(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  let cache = textCache.get(doc);
  if (!cache) {
    cache = new Map();
    textCache.set(doc, cache);
  }
  let hit = cache.get(pageNumber);
  if (!hit) {
    hit = (async () => {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      let out = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        out += item.str;
        out += item.hasEOL ? "\n" : "";
      }
      return out.trim();
    })();
    cache.set(pageNumber, hit);
  }
  return hit;
}

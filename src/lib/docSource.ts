// 열린 문서 하나를 가리키는 공통 모양. PDF 든 PowerPoint(.pptx) 든 "쪽 수, 쪽별 글자, 닫기"만 알면
// 질문·스캔·비슷한 쪽 찾기가 동작하므로, 그 부분은 이 모양에만 의존한다.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getPageText } from "./pdf";
import type { Deck } from "./pptx/model";
import { mimeOf, parsePptx } from "./pptx/parse";

interface Base {
  numPages: number;
  /** 같은 문서를 구분하는 값 (화면을 새로 만들 때 쓴다) */
  key: string;
  /** 한 쪽(슬라이드)의 글자. 없으면 빈 문자열 */
  getText(page: number): Promise<string>;
  /** 문서를 닫을 때 정리 */
  destroy(): void;
}

export interface PdfSource extends Base {
  kind: "pdf";
  pdf: PDFDocumentProxy;
}

export interface PptxSource extends Base {
  kind: "pptx";
  deck: Deck;
  /** 슬라이드에 쓰인 그림의 화면용 주소 (blob URL, 문서를 닫을 때 해제) */
  mediaUrl(path: string): string | null;
}

export type DocSource = PdfSource | PptxSource;

/** PowerPoint(.pptx) 파일을 연다. 지원하지 않는 파일이면 읽을 수 있는 오류를 던진다. */
export function pptxSource(buffer: ArrayBuffer, key: string): PptxSource {
  const deck = parsePptx(buffer);
  const urls = new Map<string, string>();
  return {
    kind: "pptx",
    deck,
    numPages: deck.slides.length,
    key,
    getText: async (page) => deck.slides[page - 1]?.text ?? "",
    mediaUrl(path) {
      const hit = urls.get(path);
      if (hit) return hit;
      const data = deck.media.get(path);
      const mime = mimeOf(path);
      if (!data || !mime) return null;
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
      urls.set(path, url);
      return url;
    },
    destroy: () => {
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
    },
  };
}

export function pdfSource(pdf: PDFDocumentProxy): PdfSource {
  return {
    kind: "pdf",
    pdf,
    numPages: pdf.numPages,
    key: pdf.fingerprints[0] ?? "",
    getText: (page) => getPageText(pdf, page),
    destroy: () => void pdf.loadingTask.destroy(),
  };
}

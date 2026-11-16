// 쪽(슬라이드) 하나를 화면 요소 안에 그리는 방법. 뷰어는 이 모양에만 의존해서
// PDF 든 PowerPoint 든 같은 스크롤·확대·형광펜 동작을 쓴다.
import "./pdfjsGlobal";
import { TextLayerBuilder } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { DocSource } from "./docSource";
import { renderSlide } from "./pptx/render";

export interface Size {
  w: number;
  h: number;
}

/** 글자를 고르는 레이어에 붙이는 표시. 형광펜은 이 레이어 안의 글자 위치로 칠한다. */
export const TEXT_LAYER_ATTR = "data-text-layer";

export interface PageRenderer {
  numPages: number;
  /** 쪽 크기 (배율 1 기준, pt) — 첫 쪽 기준으로 모든 쪽이 같다고 보고 자리를 잡는다 */
  baseSize(): Promise<Size>;
  /**
   * holder 안에 쪽을 그린다. signal 이 중단되면 그리던 것을 멈춘다.
   * 실제 쪽 크기를 알면 돌려준다.
   */
  render(page: number, holder: HTMLElement, scale: number, signal: AbortSignal): Promise<Size | void>;
}

export function createRenderer(doc: DocSource): PageRenderer {
  if (doc.kind === "pptx") {
    const { deck } = doc;
    const size = { w: deck.width, h: deck.height };
    return {
      numPages: doc.numPages,
      baseSize: async () => size,
      render: async (n, holder, scale, signal) => {
        const slide = deck.slides[n - 1];
        if (!slide || signal.aborted) return;
        renderSlide(deck, slide, scale, holder, { mediaUrl: (p) => doc.mediaUrl(p) });
        return size;
      },
    };
  }
  const pdf = doc.pdf;
  return {
    numPages: doc.numPages,
    baseSize: async () => {
      const v = (await pdf.getPage(1)).getViewport({ scale: 1 });
      return { w: v.width, h: v.height };
    },
    render: async (pageNumber, holder, scale, signal) => {
      const page = await pdf.getPage(pageNumber);
      if (signal.aborted) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const task = page.render({
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      const cancelTask = () => task.cancel();
      signal.addEventListener("abort", cancelTask);
      try {
        await task.promise;
      } catch {
        return; // 취소됨
      } finally {
        signal.removeEventListener("abort", cancelTask);
      }
      if (signal.aborted) return;

      // pdf.js 의 글자 레이어(TextLayerBuilder)는 글자를 드래그해서 고를 때 선택이 엉뚱한 곳(문서 끝 등)까지
      // 번지지 않게 해 주는 보조 요소(endOfContent)와 선택 처리를 함께 만들어 준다.
      const textLayer = new TextLayerBuilder({ pdfPage: page });
      textLayer.div.setAttribute(TEXT_LAYER_ATTR, "");
      holder.replaceChildren(canvas, textLayer.div);
      signal.addEventListener("abort", () => textLayer.cancel());
      textLayer.render({ viewport } as Parameters<TextLayerBuilder["render"]>[0]).catch(() => {});
      return { w: base.width, h: base.height };
    },
  };
}

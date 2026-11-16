// pdf.js 의 뷰어 부품(pdfjs-dist/web/pdf_viewer.mjs)은 pdf.js 본체를 전역(globalThis.pdfjsLib)에서 찾는다.
// 그 부품보다 먼저 이 파일을 불러와서 전역을 채워 둔다. (import 는 적은 순서대로 실행된다)
import * as pdfjsLib from "pdfjs-dist";

(globalThis as unknown as { pdfjsLib: typeof pdfjsLib }).pdfjsLib = pdfjsLib;

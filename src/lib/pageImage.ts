// 문서의 한 쪽을 AI 에게 보여줄 그림(JPEG)으로 만든다. 글자만으로는 알 수 없는 그림·도표·화살표를 읽게 하려는 용도.
// 지금은 PDF 만 지원한다. (PowerPoint 는 화면을 그림으로 바꾸는 작업이 따로 필요하다.)
import type { DocSource } from "./docSource";

export interface PageImage {
  mediaType: "image/jpeg";
  /** base64 (data: 접두사 없음) */
  data: string;
  page: number;
  width: number;
  height: number;
}

/** AI 가 가장 잘 읽는 크기: 긴 변 1568px 이하 */
export const MAX_IMAGE_EDGE = 1568;
const QUALITY = 0.88;
/** 그림 한 장(base64)의 최대 크기. 브리지가 받는 한도와 같다 */
export const MAX_IMAGE_B64 = 1_800_000;

/** 그림을 보낼 수 있는 문서인가 */
export const canSendPageImage = (doc: DocSource | null | undefined): boolean => doc?.kind === "pdf";

/** base64 가 아닌 글자(줄바꿈 등)를 걸러 순수 base64 만 남긴다 */
const stripDataUrl = (url: string) => url.slice(url.indexOf(",") + 1);

export async function renderPageImage(doc: DocSource, pageNumber: number): Promise<PageImage> {
  if (doc.kind !== "pdf") throw new Error("이 문서 형식은 아직 쪽 그림을 보낼 수 없어요. (PDF만 지원)");
  const page = await doc.pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  // 긴 변이 MAX_IMAGE_EDGE 가 되도록 맞춘다 (작은 쪽도 읽기 좋게 최소 1.5배, 단 화면 해상도와 무관)
  const scale = Math.min(MAX_IMAGE_EDGE / Math.max(base.width, base.height), 3);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("쪽 그림을 만들 수 없어요.");
  // JPEG 은 투명을 지원하지 않으므로 흰 배경 위에 그린다
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport } as Parameters<typeof page.render>[0]).promise;
  // 너무 크면(아주 복잡한 쪽) 화질을 조금씩 낮춰 한도 안에 넣는다.
  let data = "";
  for (const q of [QUALITY, 0.75, 0.6, 0.45]) {
    data = stripDataUrl(canvas.toDataURL("image/jpeg", q));
    if (data.length <= MAX_IMAGE_B64) break;
  }
  const out = { width: canvas.width, height: canvas.height };
  canvas.width = canvas.height = 0; // 메모리 바로 반납
  if (data.length > MAX_IMAGE_B64) throw new Error("이 쪽은 그림이 너무 커서 보낼 수 없어요.");
  return { mediaType: "image/jpeg", data, page: pageNumber, ...out };
}

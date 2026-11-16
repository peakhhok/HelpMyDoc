// .pptx 를 읽어 만든 "그릴 수 있는 모양". 상속(마스터·레이아웃·테마)은 읽는 단계에서 모두 풀어서
// 여기에는 이미 계산된 값(pt, CSS 색)만 담는다. 그리는 쪽은 이 값을 그대로 화면 요소로 옮기기만 한다.

/** 슬라이드 좌표계(pt) 안의 상자. 회전은 도, 뒤집기는 중심 기준 */
export interface BoxPt {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  flipH: boolean;
  flipV: boolean;
}

export type FillSpec =
  { type: "solid"; css: string } | { type: "grad"; css: string } | { type: "pic"; media: string; mime: string };

export interface LineSpec {
  css: string;
  /** 굵기(pt) */
  w: number;
  dash?: "dash" | "dot";
  /** 화살촉 */
  head?: boolean;
  tail?: boolean;
}

export type GeomSpec =
  | { kind: "rect" }
  | { kind: "roundRect"; radius: number }
  | { kind: "ellipse" }
  /** 화살표: 몸통 두께는 높이(위·아래는 너비)에 대한 비율, 머리 길이는 짧은 변에 대한 비율 */
  | { kind: "arrow"; dir: "right" | "left" | "up" | "down"; shaft: number; head: number }
  /** 오각형 화살표(homePlate)와 쉐브론: 뾰족한 깊이는 짧은 변에 대한 비율 */
  | { kind: "chevron"; home: boolean; depth: number }
  /** 0~1 비율 좌표의 다각형 (삼각형, 화살표 등) */
  | { kind: "poly"; points: Array<[number, number]> }
  /** 자유 곡선(아이콘 등): path 좌표계 크기와 SVG path 의 d */
  | { kind: "path"; w: number; h: number; d: string }
  | { kind: "line" };

export interface Run {
  text: string;
  /** 줄바꿈(<a:br>) */
  br?: boolean;
  /** 슬라이드 번호 자리 */
  slideNum?: boolean;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  font: string;
  /** 첨자 (%, 위가 +) */
  baseline: number;
}

export interface Bullet {
  char?: string;
  /** 자동 번호 종류 (arabicPeriod, alphaLcPeriod …) */
  auto?: string;
  color?: string;
  /** 글자 크기에 대한 % */
  sizePct?: number;
  font?: string;
}

export interface Spacing {
  pct?: number;
  pts?: number;
}

export interface Para {
  runs: Run[];
  algn: "l" | "ctr" | "r" | "just";
  /** 들여쓰기(pt) */
  marL: number;
  indent: number;
  lvl: number;
  lnSpc?: Spacing;
  spcBef?: Spacing;
  spcAft?: Spacing;
  bullet?: Bullet;
  /** 빈 줄의 높이를 위한 글자 크기 */
  endSize: number;
}

export interface TextBody {
  paras: Para[];
  anchor: "t" | "ctr" | "b";
  /** 안쪽 여백(pt) */
  inset: { l: number; t: number; r: number; b: number };
  wrap: boolean;
  /** 글자에 맞춰 줄임 (normAutofit) */
  fontScale: number;
  lnSpcReduction: number;
}

export interface TableCell {
  text: TextBody | null;
  fill: string | null;
  colSpan: number;
  rowSpan: number;
  /** 병합돼 가려지는 칸 */
  merged: boolean;
  borders: { l?: LineSpec; t?: LineSpec; r?: LineSpec; b?: LineSpec };
}

export type Shape =
  | {
      kind: "shape";
      box: BoxPt;
      geom: GeomSpec;
      fill: FillSpec | null;
      line: LineSpec | null;
      text: TextBody | null;
      /** 제목 자리 도형 (글 추출에서 맨 앞에 둔다) */
      isTitle?: boolean;
    }
  | { kind: "line"; box: BoxPt; line: LineSpec }
  | {
      kind: "pic";
      box: BoxPt;
      /** 미디어 파일 경로 (지원하지 않는 형식이면 null) */
      media: string | null;
      mime: string;
      /** 잘라내기 (0~1 비율) */
      crop?: { l: number; t: number; r: number; b: number };
      alt: string;
    }
  | { kind: "table"; box: BoxPt; cols: number[]; rows: Array<{ h: number; cells: TableCell[] }> }
  /** 표시할 수 없는 개체(차트, SmartArt, 개체 삽입 등): 이름과 안에 있던 글만 보여준다 */
  | { kind: "placeholder"; box: BoxPt; label: string; lines: string[] };

export interface Slide {
  number: number;
  background: FillSpec | null;
  /** 마스터·레이아웃에서 가져온 장식 (슬라이드 도형 아래에 그린다) */
  under: Shape[];
  shapes: Shape[];
  /** AI 와 검색이 읽는 글 (발표자 노트 포함) */
  text: string;
  /** 직접 그리지 못한 요소가 있음 (원본과 다를 수 있음) */
  approximate: boolean;
}

export interface Deck {
  /** 슬라이드 크기(pt) */
  width: number;
  height: number;
  slides: Slide[];
  /** 슬라이드에서 쓰는 미디어 파일 (경로 → 내용) */
  media: Map<string, Uint8Array>;
}

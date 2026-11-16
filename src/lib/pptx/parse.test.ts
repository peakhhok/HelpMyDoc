import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { beforeAll, describe, expect, it } from "vitest";
import type { Deck } from "./model";
import { parsePptx } from "./parse";
import { parseTheme, resolveColor, css } from "./theme";
import { parseXml, setXmlParser } from "./xml";

const bytes = readFileSync(new URL("./fixtures/lecture.pptx", import.meta.url));
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

beforeAll(() => setXmlParser((xml) => new DOMParser().parseFromString(xml, "text/xml") as unknown as Document));

describe("parsePptx (python-pptx 로 만든 5장짜리 강의 슬라이드)", () => {
  let deck: Deck;
  beforeAll(() => {
    deck = parsePptx(ab);
  });

  it("슬라이드 크기(pt)와 장수", () => {
    expect(deck.slides).toHaveLength(5);
    expect(deck.width).toBeCloseTo(960, 0);
    expect(deck.height).toBeCloseTo(540, 0);
  });

  it("글: 제목이 맨 앞, 이어서 본문, 발표자 노트는 따로 표시", () => {
    const s1 = deck.slides[0].text;
    expect(s1.startsWith("AWS 보안 기초 — VPC Endpoint")).toBe(true);
    expect(s1).toContain("Security Specialty 강의 12주차");
    expect(s1).toContain("[발표자 노트]");
    expect(s1).toContain("엔드포인트 정책은 IAM 정책과 별개로 평가된다");

    const s2 = deck.slides[1].text;
    expect(s2.split("\n")[0]).toBe("IAM Policy + VPC Endpoint Policy + Resource Policy");
    expect(s2).toContain("vpce-1a2b3c4d 는 엔드포인트 ID");
    expect(s2).toContain("조건 키: aws:SourceVpce");
  });

  it("표는 행 단위로 ' | ' 로 이어서 추출한다", () => {
    expect(deck.slides[3].text).toContain("정책 | 적용 대상 | 기본값");
    expect(deck.slides[3].text).toContain("Endpoint Policy | VPC Endpoint | Allow *");
  });

  it("자리 표시자는 레이아웃·마스터에서 위치와 글자 모양을 물려받는다", () => {
    const body = deck.slides[1].shapes.find((s) => s.kind === "shape" && !s.isTitle && s.text);
    expect(body?.kind).toBe("shape");
    if (body?.kind !== "shape") return;
    // 슬라이드에는 위치가 없고 레이아웃/마스터에만 있다
    expect(body.box.w).toBeGreaterThan(300);
    expect(body.box.h).toBeGreaterThan(200);
    const paras = body.text?.paras ?? [];
    // 1단계: 글머리표(•) + 내어쓰기, 2단계: 대시
    expect(paras[0].bullet?.char).toBe("•");
    expect(paras[0].indent).toBeLessThan(0);
    expect(paras[0].marL).toBeGreaterThan(0);
    const sub = paras.find((p) => p.lvl === 1);
    expect(sub?.bullet?.char).toBe("–");
    // 마스터 본문 글자 크기 (28pt) 를 물려받고, 2단계는 더 작다
    expect(paras[0].runs[0].size).toBeGreaterThan((sub?.runs[0].size ?? 99) - 0.01);
    // 빨간 굵은 글자
    const red = paras[paras.length - 1].runs[0];
    expect(red.bold).toBe(true);
    expect(red.color).toMatch(/rgb\(192, 57, 43\)/);
  });

  it("그림과 도형: 그림은 파일을 가리키고, 화살표는 방향·두께를 갖는다", () => {
    const shapes = deck.slides[2].shapes;
    const pic = shapes.find((s) => s.kind === "pic");
    expect(pic?.kind === "pic" && pic.media?.startsWith("ppt/media/")).toBe(true);
    expect([...deck.media.keys()].some((k) => k.endsWith(".png"))).toBe(true);
    const arrows = shapes.filter((s) => s.kind === "shape" && s.geom.kind === "arrow");
    expect(arrows).toHaveLength(2);
    const ell = shapes.find((s) => s.kind === "shape" && s.geom.kind === "ellipse");
    expect(ell).toBeTruthy();
    expect(deck.slides[2].approximate).toBe(false);
  });

  it("표 머리글/줄무늬 색, 칸 수", () => {
    const tbl = deck.slides[3].shapes.find((s) => s.kind === "table");
    expect(tbl?.kind).toBe("table");
    if (tbl?.kind !== "table") return;
    expect(tbl.cols).toHaveLength(3);
    expect(tbl.rows).toHaveLength(4);
    expect(tbl.rows[0].cells[0].fill).toMatch(/^rgb/);
    expect(tbl.rows[0].cells[0].text?.paras[0].runs[0].color).toBe("rgb(255, 255, 255)");
    expect(tbl.rows[1].cells[0].fill).not.toBe(tbl.rows[2].cells[0].fill);
  });

  it("부제목처럼 테마에서 밝게(tint) 처리된 색은 파워포인트처럼 회색", () => {
    const sub = deck.slides[0].shapes.find((s) => s.kind === "shape" && !s.isTitle && s.text);
    if (sub?.kind !== "shape") throw new Error("no subtitle");
    // tx1(검정) 에 tint 75% → 약 #898989
    expect(sub.text?.paras[0].runs[0].color).toMatch(/rgb\((13\d|14\d), (13\d|14\d), (13\d|14\d)\)/);
  });
});

describe("오류와 색 계산", () => {
  it("pptx 가 아닌 파일은 안내 문구와 함께 오류", () => {
    expect(() => parsePptx(new TextEncoder().encode("not a zip").buffer as ArrayBuffer)).toThrow(/pptx/);
  });

  it("색 변환: lumMod/lumOff, alpha", () => {
    const theme = parseTheme(
      parseXml(
        `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="x"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="4F81BD"/></a:accent1></a:clrScheme></a:themeElements></a:theme>`,
      ),
      null,
    );
    const el = (xml: string) =>
      parseXml(`<a:x xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${xml}</a:x>`)
        .firstChild as Element;
    expect(css(resolveColor(el('<a:srgbClr val="FF0000"/>'), theme))).toBe("rgb(255, 0, 0)");
    expect(css(resolveColor(el('<a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr>'), theme))).toBe(
      "rgba(255, 0, 0, 0.5)",
    );
    expect(css(resolveColor(el('<a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr>'), theme))).toMatch(
      /^rgb\(\d+, \d+, \d+\)$/,
    );
    expect(css(resolveColor(el('<a:schemeClr val="bg1"/>'), theme))).toBe("rgb(255, 255, 255)");
  });
});

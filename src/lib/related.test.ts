import { describe, expect, it } from "vitest";
import { bestExcerpt, buildIndex, findRelated, tokenize } from "./related";

const filler = (i: number) => `배경 설명 문단 ${i} lorem${i} ipsum${i} dolor${i} sit${i} amet${i} `.repeat(6);

/** 20쪽짜리 문서: 100쪽에 해당하는 2쪽과 12쪽이 같은 주제(VPC Endpoint 정책), 나머지는 서로 다른 내용 */
function doc(): string[] {
  const pages = Array.from({ length: 20 }, (_, i) => filler(i + 1));
  pages[1] =
    "VPC Endpoint Policy 는 엔드포인트를 통해 S3 접근을 제한한다. vpce-1a2b3c4d 엔드포인트 정책 예시. " + filler(2);
  pages[11] =
    "Bucket Policy 와 VPC Endpoint Policy 를 함께 쓰면 접근이 허용되려면 모두 Allow 여야 한다. 엔드포인트 정책. " +
    filler(12);
  pages[6] = "CloudFront 캐시 동작: TTL, 오리진 그룹, 서명된 URL. " + filler(7);
  return pages;
}

describe("tokenize", () => {
  it("영문 단어·식별자와 한글 2글자 조각으로 쪼갠다 (불용어·숫자만은 제외)", () => {
    const t = tokenize("The VPC-Endpoint vpce-1a2b3c4d 서브넷 123 is on");
    expect(t).toContain("vpc-endpoint");
    expect(t).toContain("vpce-1a2b3c4d");
    expect(t).toContain("endpoint"); // 하이픈으로 이은 말의 부분도
    expect(t).toContain("서브");
    expect(t).toContain("브넷");
    expect(t).not.toContain("the");
    expect(t).not.toContain("123");
    expect(t).not.toContain("is");
  });
});

describe("findRelated", () => {
  const index = buildIndex(doc());

  it("12쪽을 보고 있으면 같은 주제의 2쪽을 가장 비슷한 쪽으로 찾는다", () => {
    const r = findRelated(index, [{ text: doc()[11] }], { exclude: (p) => p === 12 });
    expect(r[0].page).toBe(2);
    expect(r[0].terms.length).toBeGreaterThan(0);
    expect(r[0].terms.join(" ")).toMatch(/endpoint|policy|vpc/);
  });

  it("관련 없는 쪽은 결과에 넣지 않는다", () => {
    const r = findRelated(index, [{ text: doc()[11] }], { exclude: (p) => p === 12 });
    expect(r.map((x) => x.page)).not.toContain(7);
    expect(r.every((x) => x.score >= 0.12)).toBe(true);
  });

  it("이미 보낸 쪽(exclude)은 빼고, 검색글이 비슷한 게 없으면 빈 목록", () => {
    const r = findRelated(index, [{ text: doc()[11] }], { exclude: (p) => p === 12 || p === 2 });
    expect(r.map((x) => x.page)).not.toContain(2);
    expect(findRelated(index, [{ text: "zzzz qqqq 전혀 다른 말" }])).toEqual([]);
    expect(findRelated(index, [{ text: "" }])).toEqual([]);
  });

  it("질문의 용어도 검색에 반영된다 (선택·질문에 가중치)", () => {
    const r = findRelated(index, [{ text: "CloudFront 서명된 URL 은 어떻게 쓰지?", weight: 3 }], {
      exclude: () => false,
    });
    expect(r[0].page).toBe(7);
  });

  it("AI 가 적어 둔 핵심 용어(extra)가 있으면 원문에 없는 표현으로도 찾는다", () => {
    const texts = doc();
    texts[4] = "프라이빗 연결 구성 " + filler(5); // 5쪽 원문에는 '엔드포인트 정책' 표현이 없음
    const withExtra = buildIndex(texts, (p) => (p === 5 ? "VPC Endpoint Policy 엔드포인트 정책" : ""));
    const r = findRelated(withExtra, [{ text: doc()[11] }], { exclude: (p) => p === 12, k: 5 });
    expect(r.map((x) => x.page)).toContain(5);
  });

  it("k 개까지만, 점수 순으로", () => {
    const r = findRelated(index, [{ text: doc()[11] }], { exclude: (p) => p === 12, k: 1 });
    expect(r).toHaveLength(1);
  });

  it("500쪽 문서도 즉시 처리된다", () => {
    const big = Array.from({ length: 500 }, (_, i) => filler(i + 1) + " 공통 어휘 network subnet");
    const t0 = Date.now();
    const idx = buildIndex(big);
    findRelated(idx, [{ text: big[300] }]);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe("bestExcerpt", () => {
  it("짧은 쪽은 그대로, 긴 쪽은 겹친 용어가 몰린 곳을 보여준다", () => {
    expect(bestExcerpt("짧은 글", ["글"])).toBe("짧은 글");
    const text = "앞부분 ".repeat(200) + "여기에 VPC Endpoint Policy 설명이 있다. " + "뒷부분 ".repeat(200);
    const ex = bestExcerpt(text, ["endpoint", "policy"], 200);
    expect(ex).toContain("Endpoint Policy");
    expect(ex.length).toBeLessThan(260);
    expect(ex.startsWith("…")).toBe(true);
  });
  it("용어가 없으면 앞부분", () => {
    expect(bestExcerpt("가".repeat(1000), [], 100).startsWith("가")).toBe(true);
  });
});

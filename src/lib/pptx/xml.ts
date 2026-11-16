// 아주 얇은 XML 도우미. 브라우저의 DOMParser 와 테스트용 @xmldom/xmldom 둘 다에서 돌도록
// childNodes / localName / getAttribute 만 쓴다. (querySelector, children 등은 쓰지 않는다)

export type El = Element;

let customParser: ((xml: string) => Document) | null = null;

/** 테스트처럼 DOMParser 가 없는 환경에서 직접 파서를 넣는다. */
export function setXmlParser(fn: ((xml: string) => Document) | null): void {
  customParser = fn;
}

export function parseXml(xml: string): El {
  const doc = customParser ? customParser(xml) : new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (!root || root.nodeName === "parsererror" || (root as El).getElementsByTagName?.("parsererror")?.length) {
    throw new Error("XML 을 읽지 못했습니다.");
  }
  return root;
}

export function name(el: Node): string {
  const e = el as El;
  return (e.localName ?? e.nodeName.split(":").pop() ?? "") as string;
}

/** 직계 자식 요소들 (이름을 주면 그 이름만) */
export function kids(el: El | null | undefined, tag?: string): El[] {
  const out: El[] = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!tag || name(n) === tag)) out.push(n as El);
  }
  return out;
}

export function kid(el: El | null | undefined, tag: string): El | null {
  return kids(el, tag)[0] ?? null;
}

/** 경로("a/b/c")를 따라 내려간다. */
export function path(el: El | null | undefined, p: string): El | null {
  let cur: El | null | undefined = el;
  for (const part of p.split("/")) {
    cur = kid(cur, part);
    if (!cur) return null;
  }
  return cur ?? null;
}

export function attr(el: El | null | undefined, n: string): string | null {
  if (!el) return null;
  const v = el.getAttribute(n);
  return v === null || v === "" ? null : v;
}

export function num(el: El | null | undefined, n: string): number | null {
  const v = attr(el, n);
  if (v === null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/** 이 요소 아래(자기 자신 제외)의 모든 후손 요소 */
export function descendants(el: El | null | undefined, tag?: string): El[] {
  const out: El[] = [];
  const walk = (e: El) => {
    for (let n = e.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      if (!tag || name(n) === tag) out.push(n as El);
      walk(n as El);
    }
  };
  if (el) walk(el);
  return out;
}

export function text(el: El | null | undefined): string {
  return el?.textContent ?? "";
}

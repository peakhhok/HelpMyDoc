import { describe, expect, it } from "vitest";
import { sseData } from "./sse";

const stream = (chunks: string[]) => {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((x) => c.enqueue(enc.encode(x)));
      c.close();
    },
  });
};
const collect = async (chunks: string[]) => {
  const out: string[] = [];
  for await (const p of sseData(stream(chunks))) out.push(p);
  return out;
};

describe("sseData", () => {
  it("data 줄만 꺼내고 [DONE], 빈 줄, 다른 필드는 건너뛴다", async () => {
    expect(
      await collect(['event: x\ndata: {"a":1}\n\n', "data: [DONE]\n\n", ": comment\n", 'data: {"b":2}\n']),
    ).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("청크가 줄 한가운데서 끊겨도 이어 붙인다 (한글 포함)", async () => {
    const full = 'data: {"t":"안녕하세요"}\n\ndata: {"t":"둘"}\n\n';
    const cut = full.indexOf("하세요") + 1;
    expect(await collect([full.slice(0, cut), full.slice(cut)])).toEqual(['{"t":"안녕하세요"}', '{"t":"둘"}']);
  });

  it("CRLF 줄바꿈도 처리하고, 끝 줄바꿈 없이 끝난 마지막 줄도 돌려준다", async () => {
    expect(await collect(['data: {"a":1}\r\n\r\ndata: {"b":2}'])).toEqual(['{"a":1}', '{"b":2}']);
  });
});

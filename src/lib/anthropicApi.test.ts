import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeError, streamClaude } from "./anthropicApi";

function sseResponse(chunks: string[], init: ResponseInit = { status: 200 }) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, init);
}

const delta = (text: string) =>
  `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\n`;

const run = (extra: Partial<Parameters<typeof streamClaude>[0]> = {}) => {
  const got: string[] = [];
  const p = streamClaude({
    apiKey: "sk-test",
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    signal: new AbortController().signal,
    onText: (d) => got.push(d),
    ...extra,
  });
  return { got, p };
};

afterEach(() => vi.unstubAllGlobals());

describe("streamClaude", () => {
  it("올바른 헤더와 본문으로 호출한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([delta("ok")]));
    vi.stubGlobal("fetch", fetchMock);
    await run().p;
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-test");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(init.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: "m", stream: true, messages: [{ role: "user", content: "hi" }] });
    expect(typeof body.system).toBe("string");
  });

  it("SSE 를 청크 경계와 상관없이 해석한다", async () => {
    const full = delta("안녕") + delta("하세요");
    // 줄 한가운데에서 쪼갠다
    const cut = full.indexOf("하세요") + 1;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([full.slice(0, cut), full.slice(cut)])));
    const { got, p } = run();
    await p;
    expect(got.join("")).toBe("안녕하세요");
  });

  it("텍스트 델타가 아닌 이벤트는 무시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sseResponse(['data: {"type":"message_start"}\n\n', "data: [DONE]\n\n", "data: not-json\n\n", delta("x")]),
        ),
    );
    const { got, p } = run();
    await p;
    expect(got).toEqual(["x"]);
  });

  it("스트림 중 error 이벤트는 ClaudeError 로 던진다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sseResponse(['data: {"type":"error","error":{"message":"overloaded"}}\n\n'])),
    );
    await expect(run().p).rejects.toThrow(new ClaudeError("overloaded"));
  });

  it("401 이면 키 확인 안내를 준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 })),
    );
    await expect(run().p).rejects.toThrow(/API 키가 올바르지 않습니다/);
  });

  it("그 밖의 HTTP 오류는 상태 코드와 메시지를 담는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 })),
    );
    await expect(run().p).rejects.toThrow(/429.*rate limited/);
  });
});

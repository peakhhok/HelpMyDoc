import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeCodeError, fetchBridgeStatus, streamClaudeCode } from "./bridgeClient";

const ndjson = (chunks: string[], init: ResponseInit = { status: 200 }) => {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        chunks.forEach((x) => c.enqueue(enc.encode(x)));
        c.close();
      },
    }),
    init,
  );
};
const line = (o: object) => JSON.stringify(o) + "\n";

afterEach(() => vi.unstubAllGlobals());

describe("fetchBridgeStatus", () => {
  it("JSON 응답을 그대로 돌려준다", async () => {
    const status = { available: true, version: "1.0", loggedIn: true, authMethod: "oauth_token" };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(status), { headers: { "content-type": "application/json" } })),
    );
    expect(await fetchBridgeStatus()).toEqual(status);
  });

  it("정적 호스팅(SPA 가 HTML 을 돌려주는 경우)이면 사용 불가", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html></html>", { headers: { "content-type": "text/html" } })),
    );
    expect(await fetchBridgeStatus()).toEqual({ available: false });
  });

  it("네트워크 오류여도 던지지 않고 사용 불가로 본다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchBridgeStatus()).toEqual({ available: false });
  });
});

describe("streamClaudeCode", () => {
  const run = () => {
    const got: string[] = [];
    const p = streamClaudeCode({
      prompt: "p",
      system: "s",
      model: "",
      signal: new AbortController().signal,
      onText: (d) => got.push(d),
    });
    return { got, p };
  };

  it("NDJSON 텍스트 이벤트를 청크 경계와 상관없이 읽는다", async () => {
    const all = line({ t: "text", text: "안녕" }) + line({ t: "text", text: "하세요" }) + line({ t: "done" });
    const cut = all.indexOf("하세요") + 2;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson([all.slice(0, cut), all.slice(cut)])));
    const { got, p } = run();
    await p;
    expect(got.join("")).toBe("안녕하세요");
  });

  it("빈 model 은 요청에서 생략하고 prompt/system 을 보낸다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ndjson([line({ t: "done" })]));
    vi.stubGlobal("fetch", fetchMock);
    await run().p;
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/claude-code/chat");
    expect(JSON.parse(init.body)).toEqual({ prompt: "p", system: "s" });
  });

  it("error 이벤트는 ClaudeCodeError 로 던진다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson([line({ t: "error", message: "로그인 필요" })])));
    await expect(run().p).rejects.toThrow(new ClaudeCodeError("로그인 필요"));
  });

  it("HTTP 오류는 서버가 준 메시지를 보여준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "허용되지 않은 출처입니다." }), { status: 403 })),
    );
    await expect(run().p).rejects.toThrow("허용되지 않은 출처입니다.");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiError, listGeminiModels, streamGemini } from "./geminiApi";

const sse = (chunks: string[]) => {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        chunks.forEach((x) => c.enqueue(enc.encode(x)));
        c.close();
      },
    }),
    { status: 200 },
  );
};
const evt = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
const part = (text: string, extra: object = {}) => evt({ candidates: [{ content: { parts: [{ text, ...extra }] } }] });

const run = (over: Partial<Parameters<typeof streamGemini>[0]> = {}) => {
  const got: string[] = [];
  const usages: unknown[] = [];
  const p = streamGemini({
    apiKey: "AIza-test",
    model: "gemini-x",
    system: "SYS",
    messages: [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
    ],
    signal: new AbortController().signal,
    onText: (d) => got.push(d),
    onUsage: (u) => usages.push(u),
    ...over,
  });
  return { got, usages, p };
};

afterEach(() => vi.unstubAllGlobals());

describe("streamGemini", () => {
  it("올바른 주소·헤더·본문으로 호출한다 (assistant → model, 시스템 지침 분리)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([part("ok")]));
    vi.stubGlobal("fetch", fetchMock);
    await run().p;
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse");
    expect(init.headers["x-goog-api-key"]).toBe("AIza-test");
    expect(url).not.toContain("AIza-test"); // 키를 주소(로그)에 싣지 않는다
    const body = JSON.parse(init.body);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "SYS" }] });
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.contents[2].parts[0].text).toBe("q2");
  });

  it("답변을 이어 붙이고, 내부 추론(thought)은 섞지 않으며, 토큰 수를 알려준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sse([
          part("생각 중…", { thought: true }),
          part("안녕"),
          evt({
            candidates: [{ content: { parts: [{ text: "하세요" }] } }],
            usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 10, thoughtsTokenCount: 5 },
          }),
        ]),
      ),
    );
    const { got, usages, p } = run();
    await p;
    expect(got.join("")).toBe("안녕하세요");
    expect(usages).toEqual([{ inputTokens: 300, outputTokens: 15 }]);
  });

  it("모델 이름에 특수문자가 있어도 주소가 깨지지 않게 인코딩한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([part("x")]));
    vi.stubGlobal("fetch", fetchMock);
    await run({ model: "a/b?c" }).p;
    expect(fetchMock.mock.calls[0][0]).toContain("/models/a%2Fb%3Fc:streamGenerateContent");
  });

  it("차단된 요청, 스트림 오류, HTTP 오류를 Gemini 오류로 알린다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([evt({ promptFeedback: { blockReason: "SAFETY" } })])));
    await expect(run().p).rejects.toThrow(/차단되었습니다 \(SAFETY\)/);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([evt({ error: { message: "boom" } })])));
    await expect(run().p).rejects.toThrow(new GeminiError("boom"));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }), {
          status: 400,
        }),
      ),
    );
    await expect(run().p).rejects.toThrow(/Gemini API 키가 올바르지 않습니다/);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 })),
    );
    await expect(run().p).rejects.toThrow(/429.*quota/);
  });
});

describe("listGeminiModels", () => {
  it("generateContent 를 지원하는 gemini 모델만, 'models/' 접두사를 떼고 보여준다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
            { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
            { name: "models/imagen-4", supportedGenerationMethods: ["predict"] },
            { name: "models/gemini-3-pro", supportedGenerationMethods: ["generateContent"] },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await listGeminiModels("AIza-test")).toEqual(["gemini-3-pro", "gemini-2.5-flash"]);
    expect(fetchMock.mock.calls[0][1].headers["x-goog-api-key"]).toBe("AIza-test");
    expect(fetchMock.mock.calls[0][0]).not.toContain("AIza-test");
  });

  it("키가 틀리면 안내 메시지로 실패한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 })),
    );
    await expect(listGeminiModels("bad")).rejects.toThrow(/Gemini API 키가 올바르지 않습니다/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIError, isChatModelId, listOpenAIModels, streamOpenAI } from "./openaiApi";

const sse = (chunks: string[], init: ResponseInit = { status: 200 }) => {
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
const evt = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
const delta = (content: string) => evt({ choices: [{ delta: { content } }] });

const run = (over: Partial<Parameters<typeof streamOpenAI>[0]> = {}) => {
  const got: string[] = [];
  const usages: unknown[] = [];
  const p = streamOpenAI({
    apiKey: "sk-test",
    model: "m1",
    system: "SYS",
    messages: [{ role: "user", content: "hi" }],
    signal: new AbortController().signal,
    onText: (d) => got.push(d),
    onUsage: (u) => usages.push(u),
    ...over,
  });
  return { got, usages, p };
};

afterEach(() => vi.unstubAllGlobals());

describe("streamOpenAI", () => {
  it("올바른 주소·헤더·본문으로 호출하고, 시스템 프롬프트를 맨 앞에 둔다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([delta("ok")]));
    vi.stubGlobal("fetch", fetchMock);
    await run().p;
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: "m1", stream: true, stream_options: { include_usage: true } });
    expect(body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "hi" },
    ]);
  });

  it("답변을 이어 붙이고 마지막 usage 청크로 토큰 수를 알려준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sse([
            delta("안녕"),
            delta("하세요"),
            evt({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 7 } }),
            "data: [DONE]\n\n",
          ]),
        ),
    );
    const { got, usages, p } = run();
    await p;
    expect(got.join("")).toBe("안녕하세요");
    expect(usages).toEqual([{ inputTokens: 120, outputTokens: 7 }]);
  });

  it("청크가 줄 중간에서 끊겨도 해석한다", async () => {
    const full = delta("가나다") + delta("라마");
    const cut = full.indexOf("나다") + 1;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([full.slice(0, cut), full.slice(cut)])));
    const { got, p } = run();
    await p;
    expect(got.join("")).toBe("가나다라마");
  });

  it("사용량이 없으면 onUsage 를 호출하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([delta("x")])));
    const { usages, p } = run();
    await p;
    expect(usages).toEqual([]);
  });

  it("401 은 키 확인 안내, 그 밖의 오류는 상태 코드와 메시지", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "x" } }), { status: 401 })),
    );
    await expect(run().p).rejects.toThrow(/OpenAI API 키가 올바르지 않습니다/);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 })),
    );
    await expect(run().p).rejects.toThrow(/429.*quota/);
  });

  it("스트림 중 error 이벤트는 OpenAIError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([evt({ error: { message: "overloaded" } })])));
    await expect(run().p).rejects.toThrow(new OpenAIError("overloaded"));
  });
});

describe("모델 목록", () => {
  it("채팅에 쓸 수 있는 모델만 남긴다", () => {
    for (const id of ["gpt-5.5", "gpt-4o-mini", "o3", "o4-mini", "chatgpt-4o-latest"])
      expect(isChatModelId(id)).toBe(true);
    for (const id of [
      "text-embedding-3-large",
      "whisper-1",
      "tts-1",
      "dall-e-3",
      "gpt-image-1",
      "gpt-4o-realtime-preview",
      "gpt-4o-transcribe",
      "omni-moderation-latest",
      "davinci-002",
      "babbage-002",
    ]) {
      expect(isChatModelId(id)).toBe(false);
    }
  });

  it("목록을 불러와 필터링하고 최신(사전순 내림차순) 먼저 보여준다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "gpt-4o" }, { id: "whisper-1" }, { id: "gpt-5.5" }, { id: "text-embedding-3-small" }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await listOpenAIModels("sk-test")).toEqual(["gpt-5.5", "gpt-4o"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/models");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer sk-test");
  });

  it("키가 틀리면 안내 메시지로 실패한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(listOpenAIModels("bad")).rejects.toThrow(/OpenAI API 키가 올바르지 않습니다/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ClaudeCodeError,
  fetchBridgeStatus,
  fetchProjectInfo,
  startClaudeLogin,
  streamClaudeCode,
  streamCli,
  type ToolEvent,
} from "./bridgeClient";

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
    // 연결에 성공했다는 사실(bridgeReachable)이 덧붙는다
    expect(await fetchBridgeStatus()).toEqual({ ...status, bridgeReachable: true });
  });

  it("정적 호스팅(SPA 가 HTML 을 돌려주는 경우)이면 사용 불가", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html></html>", { headers: { "content-type": "text/html" } })),
    );
    expect(await fetchBridgeStatus()).toEqual({ bridgeReachable: false, available: false });
  });

  it("네트워크 오류여도 던지지 않고 사용 불가로 본다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchBridgeStatus()).toEqual({ bridgeReachable: false, available: false });
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

  it("usage / limits 이벤트를 콜백으로 전달한다", async () => {
    const limits = { fiveHour: { utilization: 0.47, resetsAt: 100 }, sevenDay: { utilization: 0.43, resetsAt: 200 } };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          ndjson([
            line({ t: "limits", ...limits }),
            line({ t: "text", text: "x" }),
            line({ t: "usage", inputTokens: 3700, outputTokens: 9 }),
            line({ t: "done" }),
          ]),
        ),
    );
    const got = { usage: [] as unknown[], limits: [] as unknown[] };
    await streamClaudeCode({
      prompt: "p",
      system: "s",
      model: "",
      signal: new AbortController().signal,
      onText: () => {},
      onUsage: (u) => got.usage.push(u),
      onLimits: (l) => got.limits.push(l),
    });
    expect(got.usage).toEqual([{ inputTokens: 3700, outputTokens: 9 }]);
    expect(got.limits).toEqual([limits]);
  });

  it("한도 상태(status)만 오는 옛 버전 이벤트도 그대로 전달한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(ndjson([line({ t: "limits", status: "warning" }), line({ t: "done" })])),
    );
    const got: unknown[] = [];
    await streamClaudeCode({
      prompt: "p",
      system: "s",
      model: "",
      signal: new AbortController().signal,
      onText: () => {},
      onLimits: (l) => got.push(l),
    });
    expect(got).toEqual([{ fiveHour: undefined, sevenDay: undefined, status: "warning" }]);
  });

  it("콜백을 안 넘겨도 usage / limits 이벤트가 오류를 만들지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(ndjson([line({ t: "limits" }), line({ t: "usage" }), line({ t: "done" })])),
    );
    await expect(run().p).resolves.toBeUndefined();
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

describe("여러 CLI 지원", () => {
  it("CLI id 에 따라 요청 주소가 달라진다 (상태 확인, 대화)", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ available: true }), { headers: { "content-type": "application/json" } }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await fetchBridgeStatus("codex");
    await fetchBridgeStatus();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/codex/status", "/api/claude-code/status"]);

    fetchMock.mockResolvedValue(ndjson([line({ t: "done" })]));
    await streamCli("codex", {
      prompt: "p",
      system: "s",
      model: "m",
      signal: new AbortController().signal,
      onText: () => {},
    });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/codex/chat");
    expect(JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body)).toEqual({ prompt: "p", system: "s", model: "m" });
  });

  it("notice 이벤트를 콜백으로 전달한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          ndjson([
            line({ t: "text", text: "x" }),
            line({ t: "notice", text: "도구를 1번 사용하려 했습니다" }),
            line({ t: "done" }),
          ]),
        ),
    );
    const notices: string[] = [];
    await streamCli("codex", {
      prompt: "p",
      system: "s",
      model: "",
      signal: new AbortController().signal,
      onText: () => {},
      onNotice: (t) => notices.push(t),
    });
    expect(notices).toEqual(["도구를 1번 사용하려 했습니다"]);
  });
});

describe("startClaudeLogin (로그인 시도하기)", () => {
  const login = (onOpened?: () => void, signal = new AbortController().signal) =>
    startClaudeLogin({ signal, onOpened });

  it("고정된 경로로 요청하고, 브라우저가 열리면 알리고, 종료 코드를 돌려준다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        ndjson([line({ t: "started" }), line({ t: "opened" }), line({ t: "exit", code: 0, tail: "" })]),
      );
    vi.stubGlobal("fetch", fetchMock);
    let opened = 0;
    expect(await login(() => opened++)).toEqual({ code: 0, tail: "" });
    expect(opened).toBe(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/claude-code/login");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({}); // 보내는 값은 없다
  });

  it("실패 종료는 코드와 마지막 출력을 돌려준다 (청크가 줄 중간에서 끊겨도 해석)", async () => {
    const all = line({ t: "started" }) + line({ t: "exit", code: 1, tail: "access denied" });
    const cut = all.indexOf("denied");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson([all.slice(0, cut), all.slice(cut)])));
    expect(await login()).toEqual({ code: 1, tail: "access denied" });
  });

  it("종료 이벤트 없이 연결이 끊기면 code -1", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson([line({ t: "started" })])));
    expect(await login()).toEqual({ code: -1, tail: "" });
  });

  it("error 이벤트와 HTTP 오류(진행 중 409 등)는 ClaudeCodeError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson([line({ t: "error", message: "claude 없음" })])));
    await expect(login()).rejects.toThrow(new ClaudeCodeError("claude 없음"));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ error: "이미 로그인이 진행 중입니다." }), { status: 409 })),
    );
    await expect(login()).rejects.toThrow("이미 로그인이 진행 중입니다.");
  });

  it("취소(abort)는 fetch 에 전달된다", async () => {
    const ac = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(ndjson([line({ t: "exit", code: 0 })]));
    vi.stubGlobal("fetch", fetchMock);
    await login(undefined, ac.signal);
    expect(fetchMock.mock.calls[0][1].signal).toBe(ac.signal);
  });
});

describe("프로젝트 폴더 연결", () => {
  const run = (events: object[], extra: object = {}) => {
    const tools: ToolEvent[] = [];
    const fetchMock = vi.fn(async () => ndjson(events.map(line)));
    vi.stubGlobal("fetch", fetchMock);
    return {
      tools,
      fetchMock,
      go: () =>
        streamClaudeCode({
          prompt: "p",
          system: "s",
          model: "sonnet",
          signal: new AbortController().signal,
          onText: () => {},
          onTool: (t) => tools.push(t),
          ...extra,
        }),
    };
  };

  it("project 를 요청에 실어 보내고, 없으면 생략한다", async () => {
    const a = run([{ t: "done" }], { project: { dir: "C:\\SCS", allowWrite: ["quiz/**"] } });
    await a.go();
    const body = JSON.parse((a.fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.project).toEqual({ dir: "C:\\SCS", allowWrite: ["quiz/**"] });
    const b = run([{ t: "done" }]);
    await b.go();
    expect(
      JSON.parse((b.fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body).project,
    ).toBeUndefined();
  });

  it("tool / tool_error 이벤트를 같은 id 로 전달한다", async () => {
    const r = run([
      { t: "tool", id: "t1", name: "Read", target: "STUDY_STATUS.md" },
      { t: "tool", id: "t2", name: "Write", target: "other.md" },
      { t: "tool_error", id: "t2", message: "Permission denied" },
      { t: "done" },
    ]);
    await r.go();
    expect(r.tools).toEqual([
      { id: "t1", name: "Read", target: "STUDY_STATUS.md" },
      { id: "t2", name: "Write", target: "other.md" },
      { id: "t2", error: "Permission denied" },
    ]);
  });
});

describe("fetchProjectInfo", () => {
  it("폴더 요약을 돌려주고, 오류는 서버가 준 문구로", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, name: "SCS", entries: 5, claudeMd: true, git: true }))),
    );
    expect(await fetchProjectInfo("C:\\SCS")).toMatchObject({ ok: true, name: "SCS", claudeMd: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: "프로젝트 폴더를 찾을 수 없어요." }), { status: 400 }),
      ),
    );
    expect(await fetchProjectInfo("X:\\none")).toEqual({ ok: false, error: "프로젝트 폴더를 찾을 수 없어요." });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const r = await fetchProjectInfo("x");
    expect(r.ok).toBe(false);
  });
});

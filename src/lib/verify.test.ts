import { afterEach, describe, expect, it, vi } from "vitest";
import { isAuthError, verifyClaudeCode } from "./verify";

const ndjson = (...events: object[]) =>
  new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", {
    headers: { "content-type": "application/x-ndjson" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("isAuthError", () => {
  it("로그인이 풀렸다는 뜻의 Claude Code 문구를 알아본다", () => {
    for (const m of [
      "Invalid API key · Please run /login",
      "OAuth token has expired. Please run /login",
      "Not logged in · Please run /login",
      "authentication_error: invalid x-api-key",
      "Request failed with status 401",
      "로그인이 필요합니다",
    ]) {
      expect(isAuthError(m), m).toBe(true);
    }
  });
  it("한도 초과·네트워크 오류·일반 오류는 로그인 문제로 보지 않는다", () => {
    for (const m of [
      "Claude AI usage limit reached",
      "Credit balance is too low",
      "fetch failed: ECONNREFUSED",
      "claude 가 코드 1 로 종료되었습니다.",
      "model not found: haiku",
      "max tokens exceeded",
      "",
    ]) {
      expect(isAuthError(m), m).toBe(false);
    }
    expect(isAuthError(null)).toBe(false);
  });
});

describe("verifyClaudeCode", () => {
  const ac = () => new AbortController().signal;

  it("답이 오면 정상이고, 같이 온 한도 정보를 전달한다", async () => {
    const fetchMock = vi.fn(async () =>
      ndjson(
        { t: "text", text: "OK" },
        { t: "limits", fiveHour: { utilization: 12, resetsAt: 1 } },
        { t: "usage", inputTokens: 5, outputTokens: 1 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await verifyClaudeCode(ac());
    expect(r.status).toBe("ok");
    expect(r.status === "ok" && r.limits?.fiveHour?.utilization).toBe(12);
    // 도구 없는 짧은 요청: 가장 작은 모델로 한 번
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.model).toBe("haiku");
    expect(body.prompt.length).toBeLessThan(50);
  });

  it("로그인이 풀린 오류는 auth 로 분류한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ndjson({ t: "error", message: "OAuth token has expired. Please run /login" })),
    );
    const r = await verifyClaudeCode(ac());
    expect(r).toMatchObject({ status: "auth" });
  });

  it("그 밖의 오류는 error (로그인 화면을 띄우지 않는다)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ndjson({ t: "error", message: "Claude AI usage limit reached" })),
    );
    expect((await verifyClaudeCode(ac())).status).toBe("error");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Failed to fetch");
      }),
    );
    expect((await verifyClaudeCode(ac())).status).toBe("error");
  });

  it("답 내용이 인증 안내 문구뿐이면 auth", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ndjson({ t: "text", text: "Invalid API key · Please run /login" })),
    );
    expect((await verifyClaudeCode(ac())).status).toBe("auth");
  });

  it("중단하면 AbortError 를 그대로 던진다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    );
    await expect(verifyClaudeCode(ac())).rejects.toMatchObject({ name: "AbortError" });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { describeUpdate, fetchUpdateState, installUpdate } from "./updateClient";

afterEach(() => vi.unstubAllGlobals());

describe("describeUpdate", () => {
  it("받는 중과 준비됨만 알리고, 나머지는 조용히 있는다", () => {
    expect(describeUpdate({ state: "downloading", version: "0.2.0", percent: 37 })).toEqual({
      text: "새 버전(v0.2.0)을 받는 중… 37%",
    });
    expect(describeUpdate({ state: "ready", version: "0.2.0" })).toEqual({
      text: "새 버전(v0.2.0)이 준비됐어요.",
      action: "install",
    });
    for (const s of ["disabled", "idle", "checking", "error"] as const) expect(describeUpdate({ state: s })).toBeNull();
    expect(describeUpdate(null)).toBeNull();
  });

  it("버전이나 진행률을 모르는 경우에도 문구가 깨지지 않는다", () => {
    expect(describeUpdate({ state: "downloading" })?.text).toBe("새 버전을 받는 중… 0%");
    expect(describeUpdate({ state: "ready" })?.text).toBe("새 버전이 준비됐어요.");
  });
});

describe("fetchUpdateState / installUpdate", () => {
  it("JSON 상태를 읽고, HTML(브라우저 버전의 화면 대체)이나 오류는 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ state: "ready", version: "1" }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    expect(await fetchUpdateState()).toEqual({ state: "ready", version: "1" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html/>", { headers: { "content-type": "text/html" } })),
    );
    expect(await fetchUpdateState()).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchUpdateState()).toBeNull();
  });

  it("설치 요청 결과를 true/false 로 돌려준다", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", f);
    expect(await installUpdate()).toBe(true);
    expect(f.mock.calls[0][0]).toBe("/api/app/update/install");
    expect(f.mock.calls[0][1].method).toBe("POST");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 409 })));
    expect(await installUpdate()).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("x")));
    expect(await installUpdate()).toBe(false);
  });
});

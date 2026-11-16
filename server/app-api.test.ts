import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppServer } from "./app-server.mjs";

let root = "";
let state: Record<string, unknown> = {};
const install = vi.fn(() => true);
const updater = { getState: () => state, install };
let withUpdater: http.Server;
let withoutUpdater: http.Server;
const ports: number[] = [];

function req(port: number, opts: { method?: string; path: string; headers?: Record<string, string>; body?: string }) {
  return new Promise<{ status: number; type: string; text: string }>((resolve, reject) => {
    const r = http.request(
      { host: "127.0.0.1", port, method: opts.method ?? "GET", path: opts.path, headers: opts.headers },
      (res) => {
        let text = "";
        res.on("data", (d) => (text += d));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), text }),
        );
      },
    );
    r.on("error", reject);
    r.end(opts.body);
  });
}
const listen = (s: http.Server) =>
  new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "helpmydoc-appapi-"));
  writeFileSync(join(root, "index.html"), "<html>INDEX</html>");
  withUpdater = createAppServer({ root, updater });
  withoutUpdater = createAppServer({ root });
  ports.push(await listen(withUpdater), await listen(withoutUpdater));
});
afterAll(async () => {
  await Promise.all([withUpdater, withoutUpdater].map((s) => new Promise((r) => s.close(r))));
  rmSync(root, { recursive: true, force: true });
});
beforeEach(() => {
  state = { state: "idle", currentVersion: "0.1.0" };
  install.mockClear();
});

describe("앱 API (자동 업데이트)", () => {
  it("현재 상태를 JSON 으로 알려준다", async () => {
    state = { state: "downloading", currentVersion: "0.1.0", version: "0.2.0", percent: 40 };
    const r = await req(ports[0], { path: "/api/app/update" });
    expect(r.status).toBe(200);
    expect(r.type).toContain("application/json");
    expect(JSON.parse(r.text)).toEqual(state);
  });

  it("준비되지 않았으면 설치 요청을 거절하고(409) 설치하지 않는다", async () => {
    for (const s of ["idle", "checking", "downloading", "error", "disabled"]) {
      state = { state: s };
      const r = await req(ports[0], {
        method: "POST",
        path: "/api/app/update/install",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(r.status).toBe(409);
    }
    await new Promise((r) => setTimeout(r, 30));
    expect(install).not.toHaveBeenCalled();
  });

  it("준비됐으면 응답을 먼저 보낸 뒤 설치를 시작한다", async () => {
    state = { state: "ready", version: "0.2.0" };
    const r = await req(ports[0], {
      method: "POST",
      path: "/api/app/update/install",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({ ok: true });
    await new Promise((res) => setTimeout(res, 50));
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("다른 웹사이트(Origin/Host/cross-site)는 상태 조회도 설치도 못 한다 (403)", async () => {
    state = { state: "ready" };
    const bad: Array<Record<string, string>> = [
      { origin: "https://evil.example" },
      { host: "evil.example" },
      { "sec-fetch-site": "cross-site" },
    ];
    for (const headers of bad) {
      expect((await req(ports[0], { path: "/api/app/update", headers })).status).toBe(403);
      expect(
        (
          await req(ports[0], {
            method: "POST",
            path: "/api/app/update/install",
            headers: { ...headers, "content-type": "application/json" },
            body: "{}",
          })
        ).status,
      ).toBe(403);
    }
    await new Promise((r) => setTimeout(r, 30));
    expect(install).not.toHaveBeenCalled();
  });

  it("알 수 없는 경로와 잘못된 메서드는 404", async () => {
    expect((await req(ports[0], { path: "/api/app/nope" })).status).toBe(404);
    expect((await req(ports[0], { path: "/api/app/update/install" })).status).toBe(404); // GET 으로는 설치 불가
    expect(
      (
        await req(ports[0], {
          method: "POST",
          path: "/api/app/update",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(404);
  });

  it("화면 파일 서비스는 그대로 동작한다", async () => {
    expect((await req(ports[0], { path: "/" })).text).toBe("<html>INDEX</html>");
  });

  it("업데이터가 없는 서버(브라우저 버전)에는 이 API 가 없어 화면(HTML)으로 대체된다 — 클라이언트는 JSON 이 아니면 '없음'으로 본다", async () => {
    const r = await req(ports[1], { path: "/api/app/update" });
    expect(r.type).toContain("text/html");
    expect(r.text).toBe("<html>INDEX</html>");
    const post = await req(ports[1], {
      method: "POST",
      path: "/api/app/update/install",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(post.type).toContain("text/html");
    expect(install).not.toHaveBeenCalled();
  });
});

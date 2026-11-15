import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppServer } from "./app-server.mjs";

let root = "";
let outer = "";
let server: http.Server;
let port = 0;

function get(path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; type: string; text: string }>((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path, headers }, (res) => {
        let text = "";
        res.on("data", (d) => (text += d));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), text }),
        );
      })
      .on("error", reject);
  });
}

beforeAll(async () => {
  outer = mkdtempSync(join(tmpdir(), "helpmydoc-static-"));
  root = join(outer, "dist");
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<html>INDEX</html>");
  writeFileSync(join(root, "assets", "app.js"), "console.log(1)");
  writeFileSync(join(root, "assets", "pdf.worker.min.mjs"), "export {}");
  writeFileSync(join(root, "assets", "x.wasm"), "");
  writeFileSync(join(outer, "secret.txt"), "TOP SECRET");
  server = createAppServer({ root });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  rmSync(outer, { recursive: true, force: true });
});

describe("app server", () => {
  it("index.html 과 정적 파일을 올바른 content-type 으로 서비스한다", async () => {
    expect(await get("/")).toMatchObject({ status: 200, text: "<html>INDEX</html>" });
    expect((await get("/")).type).toContain("text/html");
    expect((await get("/assets/app.js")).type).toContain("text/javascript");
    // 워커 스크립트의 MIME 이 틀리면 pdf.js 가 동작하지 않는다
    expect((await get("/assets/pdf.worker.min.mjs")).type).toContain("text/javascript");
    expect((await get("/assets/x.wasm")).type).toBe("application/wasm");
  });

  it("없는 경로는 SPA 처럼 index.html 로 대체한다", async () => {
    expect(await get("/some/route")).toMatchObject({ status: 200, text: "<html>INDEX</html>" });
  });

  it("dist 밖의 파일은 어떤 방식으로도 읽을 수 없다 (경로 탈출)", async () => {
    for (const p of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/assets/../../secret.txt"]) {
      const r = await get(p);
      expect(r.text).not.toContain("TOP SECRET");
    }
  });

  it("잘못된 퍼센트 인코딩은 400", async () => {
    expect((await get("/%E0%A4%A")).status).toBe(400);
  });

  it("브리지 경로는 정적 서비스보다 먼저 처리된다", async () => {
    const r = await get("/api/claude-code/status");
    expect(r.type).toContain("application/json");
    expect(r.text).not.toContain("INDEX");
    // 다른 Host 로는 접근할 수 없다 (브리지 보안이 서버 조합 후에도 유지되는지)
    expect((await get("/api/claude-code/status", { host: "evil.example" })).status).toBe(403);
  });
});

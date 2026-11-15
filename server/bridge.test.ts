// 브리지 통합 테스트: PATH 에 가짜 `claude` 를 심어 실제 자식 프로세스 실행 경로를 검증한다.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claudeCodeBridge } from "./bridge.mjs";

const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2);
if (a[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }
if (a[0] === "auth") {
  console.log(JSON.stringify({ loggedIn: process.env.FAKE_LOGGED_IN !== "0", authMethod: "oauth_token", email: "secret@example.com" }));
  process.exit(0);
}
if (process.env.FAKE_ARGS_FILE) fs.writeFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify(a));
if (process.env.FAKE_PID_FILE) fs.writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const emit = (o) => console.log(JSON.stringify(o));
  const mode = process.env.FAKE_MODE;
  if (mode === "hang") { emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "start" } } }); setInterval(() => {}, 1000); return; }
  if (mode === "error") { emit({ type: "result", subtype: "error", is_error: true, result: "Not logged in" }); process.exit(1); }
  const text = "echo:" + input.trim();
  if (mode !== "nostream") {
    emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: text.slice(0, 5) } } });
    emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: text.slice(5) } } });
  }
  emit({ type: "assistant", message: { content: [{ type: "text", text }] } });
  if (mode !== "nolimits") {
    emit({ type: "rate_limit_event", session_id: "SECRET-SESSION", rate_limit_info: { status: "allowed", unifiedWindows: {
      five_hour: { utilization: 0.47, resetsAt: 1794779400, status: "allowed" },
      seven_day: { utilization: process.env.FAKE_PERCENT_SCALE ? 43 : 0.43, resetsAt: 1794769200 } } } });
  }
  emit({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.123, session_id: "SECRET-SESSION",
    usage: { input_tokens: 2, cache_creation_input_tokens: 1337, cache_read_input_tokens: 2366, output_tokens: 9 } });
});
`;

interface Res {
  status: number;
  text: string;
}

let server: http.Server;
let port = 0;
let dir = "";
const originalPath = process.env.PATH;

function request(opts: {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: opts.method ?? "GET", path: opts.path, headers: opts.headers },
      (res) => {
        let text = "";
        res.on("data", (d) => (text += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    req.end(opts.body);
  });
}

const chat = (body: object, headers: Record<string, string> = {}) =>
  request({
    method: "POST",
    path: "/api/claude-code/chat",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const events = (text: string) =>
  text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { t: string; text?: string; message?: string });

async function waitFor(cond: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(process.platform === "win32")("claude code bridge", () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "helpmydoc-fake-"));
    writeFileSync(join(dir, "claude"), FAKE_CLAUDE);
    chmodSync(join(dir, "claude"), 0o755);
    process.env.PATH = dir + delimiter + originalPath;
    server = http.createServer((req, res) =>
      claudeCodeBridge(req, res, () => {
        res.statusCode = 404;
        res.end("next");
      }),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    process.env.PATH = originalPath;
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    delete process.env.FAKE_MODE;
    delete process.env.FAKE_LOGGED_IN;
    delete process.env.FAKE_ARGS_FILE;
    delete process.env.FAKE_PID_FILE;
  });

  describe("라우팅", () => {
    it("브리지 경로가 아니면 다음 핸들러로 넘긴다", async () => {
      const r = await request({ path: "/index.html" });
      expect(r).toEqual({ status: 404, text: "next" });
    });
    it("알 수 없는 브리지 경로는 404", async () => {
      expect((await request({ path: "/api/claude-code/nope" })).status).toBe(404);
    });
  });

  describe("status", () => {
    it("버전과 로그인 방식을 알려주되 계정 정보는 노출하지 않는다", async () => {
      const r = await request({ path: "/api/claude-code/status" });
      expect(r.status).toBe(200);
      expect(JSON.parse(r.text)).toEqual({
        platform: process.platform,
        apiKeyEnv: false,
        available: true,
        version: "9.9.9 (Claude Code)",
        loggedIn: true,
        authMethod: "oauth_token",
      });
      expect(r.text).not.toContain("secret@example.com");
    });
    it("로그아웃 상태를 반영한다", async () => {
      process.env.FAKE_LOGGED_IN = "0";
      expect(JSON.parse((await request({ path: "/api/claude-code/status" })).text).loggedIn).toBe(false);
    });
    it("claude 가 없으면 available:false", async () => {
      const saved = process.env.PATH;
      process.env.PATH = "/nonexistent";
      try {
        expect(JSON.parse((await request({ path: "/api/claude-code/status" })).text)).toEqual({
          platform: process.platform,
          apiKeyEnv: false,
          available: false,
        });
      } finally {
        process.env.PATH = saved;
      }
    });
  });

  describe("사용량 정보", () => {
    it("구독 한도 사용률과 답변 토큰 수를 전달하고, 그 밖의 필드는 버린다", async () => {
      const r = await chat({ prompt: "abc" });
      const ev = events(r.text) as Array<Record<string, unknown>>;
      expect(ev.find((e) => e.t === "limits")).toEqual({
        t: "limits",
        fiveHour: { utilization: 0.47, resetsAt: 1794779400 },
        sevenDay: { utilization: 0.43, resetsAt: 1794769200 },
      });
      expect(ev.find((e) => e.t === "usage")).toEqual({ t: "usage", inputTokens: 2 + 1337 + 2366, outputTokens: 9 });
      // 세션 ID, 비용은 화면에 필요 없으므로 내보내지 않는다
      expect(r.text).not.toContain("SECRET-SESSION");
      expect(r.text).not.toContain("0.123");
    });

    it("사용률이 퍼센트(0~100)로 오는 버전도 0~1 로 맞춘다", async () => {
      process.env.FAKE_PERCENT_SCALE = "1";
      try {
        const ev = events((await chat({ prompt: "abc" })).text) as Array<Record<string, unknown>>;
        const limits = ev.find((e) => e.t === "limits") as { sevenDay: { utilization: number } };
        expect(limits.sevenDay.utilization).toBeCloseTo(0.43);
      } finally {
        delete process.env.FAKE_PERCENT_SCALE;
      }
    });

    it("한도 이벤트가 없으면 limits 를 보내지 않는다", async () => {
      process.env.FAKE_MODE = "nolimits";
      const ev = events((await chat({ prompt: "abc" })).text);
      expect(ev.some((e) => e.t === "limits")).toBe(false);
      expect(ev.some((e) => e.t === "usage")).toBe(true);
    });
  });

  describe("status 부가 정보", () => {
    it("환경변수 API 키가 있는지만 알려주고 값은 노출하지 않는다", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-super-secret";
      try {
        const r = await request({ path: "/api/claude-code/status" });
        expect(JSON.parse(r.text).apiKeyEnv).toBe(true);
        expect(r.text).not.toContain("sk-ant-super-secret");
      } finally {
        delete process.env.ANTHROPIC_API_KEY;
      }
    });
  });

  describe("보안", () => {
    it("다른 Origin 을 거절한다 (CSRF)", async () => {
      expect(
        (await request({ path: "/api/claude-code/status", headers: { origin: "https://evil.example" } })).status,
      ).toBe(403);
      expect((await chat({ prompt: "hi" }, { origin: "https://evil.example" })).status).toBe(403);
    });
    it("같은 Origin 은 허용한다", async () => {
      const r = await request({ path: "/api/claude-code/status", headers: { origin: `http://127.0.0.1:${port}` } });
      expect(r.status).toBe(200);
    });
    it("localhost 가 아닌 Host 를 거절한다 (DNS rebinding)", async () => {
      expect(
        (await request({ path: "/api/claude-code/status", headers: { host: `evil.example:${port}` } })).status,
      ).toBe(403);
    });
    it("cross-site 요청을 거절한다", async () => {
      expect(
        (await request({ path: "/api/claude-code/status", headers: { "sec-fetch-site": "cross-site" } })).status,
      ).toBe(403);
      expect(
        (await request({ path: "/api/claude-code/status", headers: { "sec-fetch-site": "same-origin" } })).status,
      ).toBe(200);
    });
    it("application/json 이 아닌 POST 는 415", async () => {
      const r = await request({
        method: "POST",
        path: "/api/claude-code/chat",
        headers: { "content-type": "text/plain" },
        body: '{"prompt":"hi"}',
      });
      expect(r.status).toBe(415);
    });
    it("옵션 주입이 가능한 model 값을 거절한다", async () => {
      for (const model of ["--dangerously-skip-permissions", "-x", "a b", "x;rm", 5]) {
        expect((await chat({ prompt: "hi", model })).status).toBe(400);
      }
    });
    it("prompt 가 없거나 JSON 이 깨졌으면 400", async () => {
      expect((await chat({})).status).toBe(400);
      expect((await chat({ prompt: "  " })).status).toBe(400);
      const bad = await request({
        method: "POST",
        path: "/api/claude-code/chat",
        headers: { "content-type": "application/json" },
        body: "{oops",
      });
      expect(bad.status).toBe(400);
    });
    it("너무 큰 요청 본문을 거절한다", async () => {
      const big = "x".repeat(4 * 1024 * 1024 + 10);
      const r = await chat({ prompt: big }).catch(() => ({ status: 0, text: "" }));
      expect([0, 400, 413, 500]).toContain(r.status); // 연결이 끊기거나 오류로 끝나야 한다
    });
  });

  describe("chat", () => {
    it("응답을 NDJSON 으로 스트리밍하고 stdin 으로 프롬프트를 전달한다", async () => {
      const r = await chat({ prompt: "안녕 질문", system: "sys" });
      expect(r.status).toBe(200);
      const ev = events(r.text);
      expect(
        ev
          .filter((e) => e.t === "text")
          .map((e) => e.text)
          .join(""),
      ).toBe("echo:안녕 질문");
      expect(ev.at(-1)).toEqual({ t: "done" });
    });

    it("순수 채팅 옵션으로 실행한다 (도구/MCP/슬래시명령/프로젝트 설정 끔, 세션 저장 안 함)", async () => {
      const argsFile = join(dir, "args.json");
      process.env.FAKE_ARGS_FILE = argsFile;
      await chat({ prompt: "hi", system: "SYS", model: "haiku" });
      const a: string[] = JSON.parse(readFileSync(argsFile, "utf8"));
      const pair = (flag: string) => a[a.indexOf(flag) + 1];
      expect(a).toContain("-p");
      expect(pair("--output-format")).toBe("stream-json");
      expect(pair("--tools")).toBe(""); // 모든 내장 도구 비활성화
      expect(a).toContain("--no-session-persistence");
      expect(a).toContain("--strict-mcp-config");
      expect(a).toContain("--disable-slash-commands");
      expect(pair("--setting-sources")).toBe("user");
      expect(pair("--append-system-prompt")).toBe("SYS");
      expect(pair("--model")).toBe("haiku");
      expect(a.some((x) => x.includes("dangerously") || x.includes("permission"))).toBe(false);
    });

    it("model 을 생략하면 --model 을 넘기지 않는다", async () => {
      const argsFile = join(dir, "args2.json");
      process.env.FAKE_ARGS_FILE = argsFile;
      await chat({ prompt: "hi" });
      expect(JSON.parse(readFileSync(argsFile, "utf8"))).not.toContain("--model");
    });

    it("부분 스트림이 없으면 최종 assistant 메시지로 대체한다", async () => {
      process.env.FAKE_MODE = "nostream";
      const ev = events((await chat({ prompt: "abc" })).text);
      expect(ev.filter((e) => e.t === "text").map((e) => e.text)).toEqual(["echo:abc"]);
    });

    it("Claude Code 오류를 error 이벤트로 전달한다", async () => {
      process.env.FAKE_MODE = "error";
      const ev = events((await chat({ prompt: "hi" })).text);
      expect(ev.find((e) => e.t === "error")?.message).toBe("Not logged in");
    });

    it("클라이언트가 연결을 끊으면 자식 프로세스를 종료한다", async () => {
      const pidFile = join(dir, "pid");
      process.env.FAKE_MODE = "hang";
      process.env.FAKE_PID_FILE = pidFile;
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port,
            method: "POST",
            path: "/api/claude-code/chat",
            headers: { "content-type": "application/json" },
          },
          (res) => {
            res.once("data", () => {
              req.destroy(); // 중지 버튼/탭 닫기
              resolve();
            });
          },
        );
        req.on("error", () => {});
        req.end(JSON.stringify({ prompt: "hi" }));
        setTimeout(() => reject(new Error("no data")), 5000);
      });
      await waitFor(() => existsSync(pidFile));
      const pid = Number(readFileSync(pidFile, "utf8"));
      await waitFor(() => !alive(pid));
      expect(alive(pid)).toBe(false);
    });

    it("동시 실행 수를 제한한다 (3번째는 429)", async () => {
      process.env.FAKE_MODE = "hang";
      const open: http.ClientRequest[] = [];
      const start = () =>
        new Promise<void>((resolve) => {
          const req = http.request(
            {
              host: "127.0.0.1",
              port,
              method: "POST",
              path: "/api/claude-code/chat",
              headers: { "content-type": "application/json" },
            },
            (res) => res.once("data", () => resolve()),
          );
          req.on("error", () => {});
          open.push(req);
          req.end(JSON.stringify({ prompt: "hi" }));
        });
      await Promise.all([start(), start()]);
      const third = await chat({ prompt: "hi" });
      expect(third.status).toBe(429);
      open.forEach((r) => r.destroy());
      // 연결을 끊으면 자식 프로세스가 정리되어 슬롯이 반환되고, 다시 요청을 받을 수 있어야 한다
      process.env.FAKE_MODE = "";
      let status = 0;
      for (let i = 0; i < 80 && status !== 200; i++) {
        status = (await chat({ prompt: "again" }).catch(() => ({ status: 0 }))).status;
        if (status !== 200) await new Promise((r) => setTimeout(r, 100));
      }
      expect(status).toBe(200);
    });
  });
});

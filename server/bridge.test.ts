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
if (a[0] === "auth" && a[1] === "login") {
  const fs = require("fs");
  if (process.env.FAKE_LOGIN_ARGS_FILE) {
    // 표준입력이 파이프로 열려 있는지(= 앱이 입력을 넘길 수 있는지)도 기록한다
    fs.writeFileSync(process.env.FAKE_LOGIN_ARGS_FILE, JSON.stringify({ args: a, stdinIsPipe: fs.fstatSync(0).isFIFO() }));
  }
  if (process.env.FAKE_PID_FILE) fs.writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
  console.log("Opening browser to sign in...");
  console.log("If the browser did not open, visit: https://claude.example/oauth/authorize?state=SECRET-STATE");
  const mode = process.env.FAKE_LOGIN_MODE;
  if (mode === "hang") setInterval(() => {}, 1000);
  else if (mode === "fail") { console.error("Login failed: access denied (https://claude.example/err?state=SECRET-STATE)"); process.exit(1); }
  else setTimeout(() => process.exit(0), 150);
} else if (a[0] === "auth") {
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
  const style = process.env.FAKE_LIMITS_STYLE;
  if (mode !== "nolimits" && style === "old-single") {
    emit({ type: "rate_limit_event", session_id: "SECRET-SESSION", rate_limit_info: { status: "allowed", rateLimitType: "five_hour", utilization: 0.62, resetsAt: 1794779400 } });
  } else if (mode !== "nolimits" && style === "old-seven") {
    emit({ type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "seven_day", utilization: 0.31, resetsAt: 1794769200 } });
  } else if (mode !== "nolimits" && style === "old-status") {
    emit({ type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", rateLimitType: "five_hour", resetsAt: 1794779400 } });
  } else if (mode !== "nolimits" && style === "unknown") {
    emit({ type: "rate_limit_event", rate_limit_info: { status: "something_new" } });
  } else if (mode !== "nolimits") {
    emit({ type: "rate_limit_event", session_id: "SECRET-SESSION", rate_limit_info: { status: "allowed", unifiedWindows: {
      five_hour: { utilization: 0.47, resetsAt: 1794779400, status: "allowed" },
      seven_day: { utilization: process.env.FAKE_PERCENT_SCALE ? 43 : 0.43, resetsAt: 1794769200 } } } });
  }
  emit({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.123, session_id: "SECRET-SESSION",
    usage: { input_tokens: 2, cache_creation_input_tokens: 1337, cache_read_input_tokens: 2366, output_tokens: 9 } });
});
`;

// 공식 문서(codex exec --json)의 이벤트 형식을 따르는 가짜 codex
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2);
if (a[0] === "--version") { console.log("codex-cli 9.9.9"); process.exit(0); }
if (a[0] === "login" && a[1] === "status") {
  const m = process.env.FAKE_CODEX_LOGIN;
  if (m === "out") { console.error("Not logged in"); process.exit(1); }
  if (m === "weird") { console.log("???"); process.exit(2); }
  console.log("Logged in using ChatGPT (secret@example.com)"); process.exit(0);
}
if (process.env.FAKE_CODEX_ARGS_FILE) fs.writeFileSync(process.env.FAKE_CODEX_ARGS_FILE, JSON.stringify(a));
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  if (process.env.FAKE_CODEX_STDIN_FILE) fs.writeFileSync(process.env.FAKE_CODEX_STDIN_FILE, input);
  const emit = (o) => console.log(JSON.stringify(o));
  const mode = process.env.FAKE_CODEX_MODE;
  emit({ type: "thread.started", thread_id: "SECRET-THREAD" });
  emit({ type: "turn.started" });
  if (mode === "fail") { emit({ type: "turn.failed", error: { message: "rate limited" } }); process.exit(1); }
  if (mode === "tool") emit({ type: "item.completed", item: { id: "item_1", type: "command_execution", command: "bash -lc ls", status: "completed" } });
  emit({ type: "item.completed", item: { id: "item_2", type: "reasoning", text: "thinking" } });
  emit({ type: "item.completed", item: { id: "item_3", type: "agent_message", text: "codex:" + input.trim().split("\\n").pop() } });
  if (mode === "two") emit({ type: "item.completed", item: { id: "item_4", type: "agent_message", text: "second" } });
  emit({ type: "turn.completed", usage: { input_tokens: 24763, cached_input_tokens: 24448, output_tokens: 122, reasoning_output_tokens: 0 } });
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

const codexChat = (body: object, headers: Record<string, string> = {}) =>
  request({
    method: "POST",
    path: "/api/codex/chat",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const loginReq = (body: object = {}, headers: Record<string, string> = {}) =>
  request({
    method: "POST",
    path: "/api/claude-code/login",
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
    writeFileSync(join(dir, "codex"), FAKE_CODEX);
    chmodSync(join(dir, "codex"), 0o755);
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
    for (const k of Object.keys(process.env))
      if (k.startsWith("FAKE_CODEX_") || k.startsWith("FAKE_LOGIN_")) delete process.env[k];
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
        status: "ok",
      });
      expect(ev.find((e) => e.t === "usage")).toEqual({ t: "usage", inputTokens: 2 + 1337 + 2366, outputTokens: 9 });
      // 세션 ID, 비용은 화면에 필요 없으므로 내보내지 않는다
      expect(r.text).not.toContain("SECRET-SESSION");
      expect(r.text).not.toContain("0.123");
    });

    it("옛 버전(unifiedWindows 없음)은 창 하나짜리 이벤트를 읽는다", async () => {
      const one = async (style: string) => {
        process.env.FAKE_LIMITS_STYLE = style;
        const ev = events((await chat({ prompt: "abc" })).text) as Array<Record<string, unknown>>;
        return ev.find((e) => e.t === "limits");
      };
      try {
        expect(await one("old-single")).toEqual({
          t: "limits",
          fiveHour: { utilization: 0.62, resetsAt: 1794779400 },
          status: "ok",
        });
        expect(await one("old-seven")).toEqual({
          t: "limits",
          sevenDay: { utilization: 0.31, resetsAt: 1794769200 },
          status: "ok",
        });
      } finally {
        delete process.env.FAKE_LIMITS_STYLE;
      }
    });

    it("사용률 숫자가 없는 버전은 한도 상태(정상/경고/초과)만 전달하고, 알 수 없는 값은 보내지 않는다", async () => {
      try {
        process.env.FAKE_LIMITS_STYLE = "old-status";
        let ev = events((await chat({ prompt: "abc" })).text) as Array<Record<string, unknown>>;
        expect(ev.find((e) => e.t === "limits")).toEqual({ t: "limits", status: "warning" });
        process.env.FAKE_LIMITS_STYLE = "unknown";
        ev = events((await chat({ prompt: "abc" })).text) as Array<Record<string, unknown>>;
        expect(ev.some((e) => e.t === "limits")).toBe(false);
      } finally {
        delete process.env.FAKE_LIMITS_STYLE;
      }
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

  describe("로그인 시도하기 (고정 명령 하나만 실행)", () => {
    it("`claude auth login` 만 실행하고, 브라우저를 열었다는 사실과 종료 코드만 알려준다", async () => {
      const argsFile = join(dir, "login-args.json");
      process.env.FAKE_LOGIN_ARGS_FILE = argsFile;
      const r = await loginReq();
      expect(r.status).toBe(200);
      const ev = events(r.text) as Array<Record<string, unknown>>;
      expect(ev.map((e) => e.t)).toEqual(["started", "opened", "exit"]);
      expect(ev.at(-1)).toEqual({ t: "exit", code: 0, tail: "" });
      const rec = JSON.parse(readFileSync(argsFile, "utf8"));
      expect(rec.args).toEqual(["auth", "login"]); // 인자는 이것뿐
      expect(rec.stdinIsPipe).toBe(false); // 표준입력은 막혀 있다 (인증 코드를 앱이 대신 전달하지 않음)
      expect(r.text).not.toContain("SECRET-STATE"); // 일회용 인증 주소는 화면으로 보내지 않는다
    });

    it("요청에 무엇을 실어 보내도 명령에는 반영되지 않는다", async () => {
      const argsFile = join(dir, "login-args2.json");
      process.env.FAKE_LOGIN_ARGS_FILE = argsFile;
      await loginReq({ args: ["--evil"], command: "rm -rf /", model: "x", prompt: "y" });
      expect(JSON.parse(readFileSync(argsFile, "utf8")).args).toEqual(["auth", "login"]);
    });

    it("실패하면 종료 코드와 마지막 출력을 알려주되 링크는 가린다", async () => {
      process.env.FAKE_LOGIN_MODE = "fail";
      const r = await loginReq();
      const exit = (events(r.text) as Array<Record<string, unknown>>).find((e) => e.t === "exit") as {
        code: number;
        tail: string;
      };
      expect(exit.code).toBe(1);
      expect(exit.tail).toContain("access denied");
      expect(exit.tail).toContain("[링크]");
      expect(exit.tail).not.toContain("Opening browser"); // 마지막 한 줄만
      expect(r.text).not.toContain("SECRET-STATE");
      expect(r.text).not.toContain("claude.example");
    });

    it("연결을 끊으면(취소) 로그인 프로세스를 종료하고, 진행 중에는 두 번째를 받지 않는다 (409)", async () => {
      const pidFile = join(dir, "login-pid");
      process.env.FAKE_LOGIN_MODE = "hang";
      process.env.FAKE_PID_FILE = pidFile;
      const first = http.request({
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/api/claude-code/login",
        headers: { "content-type": "application/json" },
      });
      first.on("error", () => {});
      const started = new Promise<void>((resolve) =>
        first.on("response", (res) => {
          res.once("data", () => resolve());
        }),
      );
      first.end("{}");
      await started;
      await waitFor(() => existsSync(pidFile));
      const pid = Number(readFileSync(pidFile, "utf8"));
      expect(alive(pid)).toBe(true);

      expect((await loginReq()).status).toBe(409);

      first.destroy(); // 화면에서 취소
      await waitFor(() => !alive(pid));
      expect(alive(pid)).toBe(false);

      // 정리된 뒤에는 다시 시작할 수 있다
      process.env.FAKE_LOGIN_MODE = "";
      let status = 0;
      for (let i = 0; i < 40 && status !== 200; i++) {
        status = (await loginReq()).status;
        if (status !== 200) await new Promise((r) => setTimeout(r, 100));
      }
      expect(status).toBe(200);
    });

    it("Origin/Host 검사가 똑같이 적용되고, 로그인 명령이 없는 CLI(codex)와 GET 은 거절한다", async () => {
      expect((await loginReq({}, { origin: "https://evil.example" })).status).toBe(403);
      expect((await loginReq({}, { "sec-fetch-site": "cross-site" })).status).toBe(403);
      expect(
        (
          await request({
            method: "POST",
            path: "/api/codex/login",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ).status,
      ).toBe(404);
      expect((await request({ path: "/api/claude-code/login" })).status).toBe(404);
    });
  });

  describe("Codex 어댑터", () => {
    it("status: 버전과 로그인 방식만 알려주고 계정 정보는 노출하지 않는다", async () => {
      const r = await request({ path: "/api/codex/status" });
      expect(r.status).toBe(200);
      expect(JSON.parse(r.text)).toEqual({
        platform: process.platform,
        available: true,
        version: "codex-cli 9.9.9",
        loggedIn: true,
        authMethod: "chatgpt",
      });
      expect(r.text).not.toContain("secret@example.com");
    });

    it("status: 로그인 안 됨(종료 코드 1, 'Not logged in')", async () => {
      process.env.FAKE_CODEX_LOGIN = "out";
      const j = JSON.parse((await request({ path: "/api/codex/status" })).text);
      expect(j).toMatchObject({ available: true, loggedIn: false, authMethod: null });
    });

    it("status: 형식을 알 수 없으면 막지 않고 loggedIn 을 비워 둔다", async () => {
      process.env.FAKE_CODEX_LOGIN = "weird";
      const j = JSON.parse((await request({ path: "/api/codex/status" })).text);
      expect(j.available).toBe(true);
      expect(j.loggedIn).toBeUndefined();
    });

    it("status: codex 가 없으면 available:false", async () => {
      const saved = process.env.PATH;
      process.env.PATH = "/nonexistent";
      try {
        expect(JSON.parse((await request({ path: "/api/codex/status" })).text)).toEqual({
          platform: process.platform,
          available: false,
        });
      } finally {
        process.env.PATH = saved;
      }
    });

    it("chat: 답변과 토큰 사용량을 전달하고, 세션 ID 등은 버린다", async () => {
      const r = await codexChat({ prompt: "질문입니다", system: "SYS" });
      expect(r.status).toBe(200);
      const ev = events(r.text) as Array<Record<string, unknown>>;
      expect(ev.filter((e) => e.t === "text").map((e) => e.text)).toEqual(["codex:질문입니다"]);
      expect(ev.find((e) => e.t === "usage")).toEqual({ t: "usage", inputTokens: 24763, outputTokens: 122 });
      expect(ev.at(-1)).toEqual({ t: "done" });
      expect(r.text).not.toContain("SECRET-THREAD");
    });

    it("chat: 읽기 전용 샌드박스·세션 저장 안 함·사용자 설정 무시로 실행하고, 프롬프트는 인자가 아니라 표준입력으로 넘긴다", async () => {
      const argsFile = join(dir, "codex-args.json");
      const stdinFile = join(dir, "codex-stdin.txt");
      process.env.FAKE_CODEX_ARGS_FILE = argsFile;
      process.env.FAKE_CODEX_STDIN_FILE = stdinFile;
      await codexChat({ prompt: "문서 질문 XYZ", system: "SYSTEM-PROMPT", model: "gpt-5.5" });
      const a: string[] = JSON.parse(readFileSync(argsFile, "utf8"));
      expect(a[0]).toBe("exec");
      for (const flag of ["--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules"]) {
        expect(a).toContain(flag);
      }
      expect(a[a.indexOf("-s") + 1]).toBe("read-only");
      expect(a[a.indexOf("-m") + 1]).toBe("gpt-5.5");
      expect(a.some((x) => /danger|workspace-write|bypass/i.test(x))).toBe(false);
      expect(a.join(" ")).not.toContain("문서 질문 XYZ"); // 프롬프트는 인자에 없다
      const stdin = readFileSync(stdinFile, "utf8");
      expect(stdin).toContain("SYSTEM-PROMPT");
      expect(stdin).toContain("Do not run shell commands"); // 도구 사용 금지 지침
      expect(stdin.trim().endsWith("문서 질문 XYZ")).toBe(true);
    });

    it("chat: model 을 생략하면 -m 을 넘기지 않는다", async () => {
      const argsFile = join(dir, "codex-args2.json");
      process.env.FAKE_CODEX_ARGS_FILE = argsFile;
      await codexChat({ prompt: "hi" });
      expect(JSON.parse(readFileSync(argsFile, "utf8"))).not.toContain("-m");
    });

    it("chat: 메시지가 둘이면 이어 붙인다", async () => {
      process.env.FAKE_CODEX_MODE = "two";
      const ev = events((await codexChat({ prompt: "q" })).text);
      expect(
        ev
          .filter((e) => e.t === "text")
          .map((e) => e.text)
          .join(""),
      ).toBe("codex:q\n\nsecond");
    });

    it("chat: 모델이 도구를 쓰려 했으면 화면에 알린다", async () => {
      process.env.FAKE_CODEX_MODE = "tool";
      const ev = events((await codexChat({ prompt: "q" })).text) as Array<Record<string, unknown>>;
      expect(String(ev.find((e) => e.t === "notice")?.text)).toContain("도구를 1번");
    });

    it("chat: 실패(turn.failed)를 error 이벤트로 전달한다", async () => {
      process.env.FAKE_CODEX_MODE = "fail";
      const ev = events((await codexChat({ prompt: "q" })).text);
      expect(ev.find((e) => e.t === "error")?.message).toBe("rate limited");
    });

    it("model 값 검증과 Origin 검사가 Codex 경로에도 똑같이 적용된다", async () => {
      expect((await codexChat({ prompt: "q", model: "--dangerously-bypass-approvals-and-sandbox" })).status).toBe(400);
      expect((await codexChat({ prompt: "q" }, { origin: "https://evil.example" })).status).toBe(403);
      expect((await request({ path: "/api/codex/status", headers: { host: `evil.example:${port}` } })).status).toBe(
        403,
      );
    });

    it("알 수 없는 CLI 경로는 브리지가 처리하지 않는다", async () => {
      expect(await request({ path: "/api/gemini/status" })).toEqual({ status: 404, text: "next" });
      expect(await request({ path: "/api/__proto__/status" })).toEqual({ status: 404, text: "next" });
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

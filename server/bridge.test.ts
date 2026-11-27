// 브리지 통합 테스트: PATH 에 가짜 `claude` 를 심어 실제 자식 프로세스 실행 경로를 검증한다.
import { execFileSync } from "node:child_process";
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
if (process.env.FAKE_CWD_FILE) fs.writeFileSync(process.env.FAKE_CWD_FILE, process.cwd());
if (process.env.FAKE_PID_FILE) fs.writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  if (process.env.FAKE_STDIN_FILE) fs.writeFileSync(process.env.FAKE_STDIN_FILE, input);
  const emit = (o) => console.log(JSON.stringify(o));
  const mode = process.env.FAKE_MODE;
  if (mode === "hang") { emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "start" } } }); setInterval(() => {}, 1000); return; }
  if (mode === "error") { emit({ type: "result", subtype: "error", is_error: true, result: "Not logged in" }); process.exit(1); }
  const text = "echo:" + input.trim();
  if (mode === "tools") {
    // 도구를 쓰는 어시스턴트 턴 → 도구 결과(거부됨) → 최종 답변
    const root = process.cwd().replace(/\\\\/g, "/");
    emit({ type: "stream_event", event: { type: "message_start" } });
    emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "읽어볼게요." } } });
    emit({ type: "assistant", message: { content: [
      { type: "text", text: "읽어볼게요." },
      { type: "tool_use", id: "t1", name: "Read", input: { file_path: root + "/STUDY_STATUS.md" } },
      { type: "tool_use", id: "t2", name: "Write", input: { file_path: root + "/other.md", content: "x" } } ] } });
    emit({ type: "user", message: { content: [
      { type: "tool_result", tool_use_id: "t1", content: "ok" },
      { type: "tool_result", tool_use_id: "t2", is_error: true, content: "Permission to use Write has been denied" } ] } });
    emit({ type: "stream_event", event: { type: "message_start" } });
    emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "끝났어요." } } });
    emit({ type: "result", subtype: "success", is_error: false, usage: { input_tokens: 1, output_tokens: 1 } });
    return;
  }
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

  describe("프로젝트 폴더 연결", () => {
    let proj = "";
    beforeAll(() => {
      proj = mkdtempSync(join(tmpdir(), "helpmydoc-proj-"));
      writeFileSync(join(proj, "CLAUDE.md"), "# 규칙\n항상 표 먼저");
      writeFileSync(join(proj, "STUDY_STATUS.md"), "Q135");
    });
    afterAll(() => rmSync(proj, { recursive: true, force: true }));

    const argsOf = async (project: object | undefined, extra: object = {}) => {
      const f = join(dir, "args-project.json");
      const c = join(dir, "cwd-project.txt");
      process.env.FAKE_ARGS_FILE = f;
      process.env.FAKE_CWD_FILE = c;
      const r = await chat({ prompt: "안녕", system: "SYS", project, ...extra });
      delete process.env.FAKE_CWD_FILE;
      return {
        r,
        args: JSON.parse(readFileSync(f, "utf8")) as string[],
        cwd: existsSync(c) ? readFileSync(c, "utf8") : "",
      };
    };

    it("폴더에서 실행하고 읽기 도구만 연다 (쓰기·셸 없음, 묻지 않고 거부)", async () => {
      const { r, args, cwd } = await argsOf({ dir: proj });
      expect(r.status).toBe(200);
      expect(cwd).toBe(proj);
      expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep");
      expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
      expect(args).not.toContain("--allowedTools");
      expect(args).toContain("--strict-mcp-config");
      expect(args.join(" ")).not.toMatch(/Bash|Write|Edit|WebFetch/);
    });

    it("허용 경로를 적으면 그 경로에만 쓰기를 연다", async () => {
      const { args } = await argsOf({ dir: proj, allowWrite: ["quiz/**", "STUDY_STATUS.md"] });
      expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep,Write,Edit");
      expect(args[args.indexOf("--allowedTools") + 1]).toBe(
        "Write(quiz/**),Edit(quiz/**),Write(STUDY_STATUS.md),Edit(STUDY_STATUS.md)",
      );
    });

    it("시스템 프롬프트에 폴더 안내와 CLAUDE.md 가 들어간다", async () => {
      const { args } = await argsOf({ dir: proj, allowWrite: ["quiz/**"] });
      const sys = args[args.indexOf("--append-system-prompt") + 1];
      expect(sys.startsWith("SYS")).toBe(true);
      expect(sys).toContain("항상 표 먼저");
      expect(sys).toContain("ONLY at these paths");
      expect(sys).toContain("quiz/**");
      const ro = await argsOf({ dir: proj });
      expect(ro.args[ro.args.indexOf("--append-system-prompt") + 1]).toContain("read-only");
    });

    it("project 가 없으면 예전처럼 도구 없이 빈 임시 폴더에서 실행한다", async () => {
      const { args, cwd } = await argsOf(undefined);
      expect(args[args.indexOf("--tools") + 1]).toBe("");
      expect(args).not.toContain("--permission-mode");
      expect(cwd).not.toBe(proj);
    });

    it("잘못된 폴더·경로는 400 (실행하지 않는다)", async () => {
      for (const bad of [
        { dir: "상대/경로" },
        { dir: join(proj, "없는폴더") },
        { dir: join(proj, "CLAUDE.md") }, // 파일
        { dir: "" },
        { dir: proj, allowWrite: ["../밖"] },
        { dir: proj, allowWrite: ["/etc/passwd"] },
        { dir: proj, allowWrite: ["C:/Windows"] },
        { dir: proj, allowWrite: ["~/x"] },
        { dir: proj, allowWrite: ["a;rm -rf"] },
        { dir: proj, allowWrite: ["quiz/**)"] },
        { dir: proj, allowWrite: [123] },
      ]) {
        const r = await chat({ prompt: "x", project: bad });
        expect(r.status, JSON.stringify(bad)).toBe(400);
      }
    });

    it("Codex 는 프로젝트 폴더를 지원하지 않는다", async () => {
      const r = await codexChat({ prompt: "x", project: { dir: proj } });
      expect(r.status).toBe(400);
    });

    it("도구 사용을 화면에 알리고(폴더 기준 경로), 거부된 도구는 오류로, 여러 턴의 글은 문단으로 이어 붙인다", async () => {
      process.env.FAKE_MODE = "tools";
      const r = await chat({ prompt: "x", project: { dir: proj, allowWrite: ["quiz/**"] } });
      const ev = events(r.text) as Array<{
        t: string;
        text?: string;
        name?: string;
        target?: string;
        id?: string;
        message?: string;
      }>;
      const tools = ev.filter((e) => e.t === "tool");
      expect(tools.map((t) => [t.name, t.target])).toEqual([
        ["Read", "STUDY_STATUS.md"],
        ["Write", "other.md"],
      ]);
      const err = ev.filter((e) => e.t === "tool_error");
      expect(err).toHaveLength(1);
      expect(err[0].id).toBe("t2");
      expect(err[0].message).toContain("denied");
      expect(
        ev
          .filter((e) => e.t === "text")
          .map((e) => e.text)
          .join(""),
      ).toBe("읽어볼게요.\n\n끝났어요.");
    });

    describe("AI 에게 여는 git", () => {
      let repo = "";
      const FILES = ["quiz/wrong_notes.md", "STUDY_STATUS.md"];
      beforeAll(() => {
        repo = mkdtempSync(join(tmpdir(), "helpmydoc-gitproj-"));
        execFileSync("git", ["init", "-q", "-b", "main-hkwfct", repo]);
      });
      afterAll(() => rmSync(repo, { recursive: true, force: true }));
      const lists = (args: string[]) => ({
        tools: args[args.indexOf("--tools") + 1],
        allow: (args[args.indexOf("--allowedTools") + 1] ?? "").split(","),
        deny: (args[args.indexOf("--disallowedTools") + 1] ?? "").split(","),
        sys: args[args.indexOf("--append-system-prompt") + 1] ?? "",
      });

      it("지정한 브랜치에서는 읽기 git + 파일을 지정한 add/commit 만 열고 push 등은 명시적으로 막는다", async () => {
        const { args } = await argsOf({ dir: repo, allowWrite: FILES, git: true, branch: "main-hkwfct" });
        const l = lists(args);
        expect(l.tools).toBe("Read,Glob,Grep,Write,Edit,Bash");
        for (const ok of [
          "Bash(git status)",
          "Bash(git diff *)",
          "Bash(git log *)",
          "Bash(git branch --show-current)",
          "Bash(git add quiz/wrong_notes.md)",
          "Bash(git add STUDY_STATUS.md)",
          "Bash(git add quiz/wrong_notes.md STUDY_STATUS.md)",
          "Bash(git commit -m * -- quiz/wrong_notes.md)",
          "Bash(git commit -m * -- STUDY_STATUS.md)",
          "Bash(git commit -m * -- quiz/wrong_notes.md STUDY_STATUS.md)",
        ]) {
          expect(l.allow, ok).toContain(ok);
        }
        // 파일을 지정하지 않는 commit/전체 add/push 는 허용 목록에 없다
        expect(l.allow).not.toContain("Bash(git commit -m *)");
        expect(l.allow.join("|")).not.toMatch(/git push|git add \.|git add -A|git checkout|git reset|git pull/);
        for (const no of [
          "Bash(git push)",
          "Bash(git push *)",
          "Bash(git add .)",
          "Bash(git commit * -a)",
          "Bash(git commit *--amend*)",
          "Bash(git diff *--output*)",
        ]) {
          expect(l.deny, no).toContain(no);
        }
        expect(l.sys).toContain("main-hkwfct");
        expect(l.sys).toContain("never push");
      });

      it("현재 브랜치가 지정한 브랜치가 아니면 commit 은 열지 않는다 (읽기 git 만)", async () => {
        const { args } = await argsOf({ dir: repo, allowWrite: FILES, git: true, branch: "other-branch" });
        const l = lists(args);
        expect(l.allow).toContain("Bash(git status)");
        expect(l.allow.join("|")).not.toMatch(/git add|git commit/);
        expect(l.sys).toContain("Committing is disabled");
      });

      it("쓰기 허용 경로가 와일드카드뿐이면(정확한 파일이 없으면) commit 은 열지 않는다", async () => {
        const { args } = await argsOf({ dir: repo, allowWrite: ["quiz/**"], git: true, branch: "main-hkwfct" });
        expect(lists(args).allow.join("|")).not.toMatch(/git add|git commit/);
      });

      it("git 을 켜지 않으면 Bash 도구 자체가 없다", async () => {
        const { args } = await argsOf({ dir: repo, allowWrite: FILES });
        expect(lists(args).tools).toBe("Read,Glob,Grep,Write,Edit");
        expect(args.join(" ")).not.toContain("Bash");
      });

      it("잘못된 브랜치 이름은 400", async () => {
        expect((await chat({ prompt: "x", project: { dir: repo, git: true, branch: "a b;c" } })).status).toBe(400);
      });
    });

    describe("CLAUDE.md 예시 만들기", () => {
      let empty = "";
      beforeAll(() => {
        empty = mkdtempSync(join(tmpdir(), "helpmydoc-init-"));
      });
      afterAll(() => rmSync(empty, { recursive: true, force: true }));
      const init = (body: object, headers: Record<string, string> = {}) =>
        request({
          method: "POST",
          path: "/api/claude-code/init",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        });

      it("폴더에 CLAUDE.md 예시를 만들고, 이미 있으면 덮어쓰지 않는다", async () => {
        const r = await init({ dir: empty, template: "study" });
        expect(r.status).toBe(200);
        const text = readFileSync(join(empty, "CLAUDE.md"), "utf8");
        expect(text).toContain("공부 자료 폴더 안내");
        expect(text).toContain("push는 하지 않아요");
        writeFileSync(join(empty, "CLAUDE.md"), "내가 고친 내용");
        const again = await init({ dir: empty, template: "reference" });
        expect(again.status).toBe(400);
        expect(JSON.parse(again.text).error).toContain("덮어쓰지 않아요");
        expect(readFileSync(join(empty, "CLAUDE.md"), "utf8")).toBe("내가 고친 내용");
      });

      it("읽기 전용 참고 자료 예시도 만들 수 있고, 잘못된 요청은 막는다", async () => {
        const d = mkdtempSync(join(tmpdir(), "helpmydoc-init2-"));
        expect((await init({ dir: d, template: "reference" })).status).toBe(200);
        expect(readFileSync(join(d, "CLAUDE.md"), "utf8")).toContain("읽기만");
        rmSync(d, { recursive: true, force: true });
        expect((await init({ dir: empty, template: "nope" })).status).toBe(400);
        expect((await init({ dir: "상대/경로", template: "study" })).status).toBe(400);
        expect((await init({ dir: join(empty, "없음"), template: "study" })).status).toBe(400);
        expect(
          (
            await request({
              method: "POST",
              path: "/api/claude-code/init",
              headers: { "content-type": "text/plain" },
              body: "x",
            })
          ).status,
        ).toBe(415);
        expect((await init({ dir: empty, template: "study" }, { origin: "https://evil.example" })).status).toBe(403);
        expect(
          (
            await request({
              method: "POST",
              path: "/api/codex/init",
              headers: { "content-type": "application/json" },
              body: "{}",
            })
          ).status,
        ).toBe(404);
      });
    });

    describe("앱 버튼용 git API", () => {
      const gitPost = (body: object, headers: Record<string, string> = {}) =>
        request({
          method: "POST",
          path: "/api/claude-code/git",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        });

      it("잘못된 요청은 막는다 (폴더·action·브랜치·형식·출처)", async () => {
        expect((await gitPost({ dir: "상대", action: "status" })).status).toBe(400);
        expect((await gitPost({ dir: proj, action: "nope" })).status).toBe(400);
        expect((await gitPost({ dir: proj, action: "sync" })).status).toBe(400); // 브랜치 없음
        expect((await gitPost({ dir: proj, action: "status" })).status).toBe(400); // git 저장소 아님
        expect((await gitPost({ dir: proj, action: "sync", branch: "x;rm" })).status).toBe(400);
        const r = await request({
          method: "POST",
          path: "/api/claude-code/git",
          headers: { "content-type": "text/plain" },
          body: "x",
        });
        expect(r.status).toBe(415);
        expect((await gitPost({ dir: proj, action: "status" }, { origin: "https://evil.example" })).status).toBe(403);
        expect(
          (
            await request({
              method: "POST",
              path: "/api/codex/git",
              headers: { "content-type": "application/json" },
              body: "{}",
            })
          ).status,
        ).toBe(404);
      });
    });

    it("폴더 확인 API: 있는 폴더는 요약, 없거나 상대 경로는 400", async () => {
      const ok = await request({ path: `/api/claude-code/project?dir=${encodeURIComponent(proj)}` });
      expect(ok.status).toBe(200);
      expect(JSON.parse(ok.text)).toMatchObject({ ok: true, claudeMd: true, git: false });
      expect(
        (await request({ path: `/api/claude-code/project?dir=${encodeURIComponent(join(proj, "x"))}` })).status,
      ).toBe(400);
      expect((await request({ path: "/api/claude-code/project?dir=relative" })).status).toBe(400);
      expect((await request({ path: "/api/claude-code/project" })).status).toBe(400);
      expect((await request({ path: `/api/codex/project?dir=${encodeURIComponent(proj)}` })).status).toBe(404);
    });

    it("다른 웹사이트에서의 요청은 폴더 확인도 실행도 막힌다 (403)", async () => {
      const bad = { origin: "https://evil.example" };
      expect(
        (await request({ path: `/api/claude-code/project?dir=${encodeURIComponent(proj)}`, headers: bad })).status,
      ).toBe(403);
      expect((await chat({ prompt: "x", project: { dir: proj } }, bad)).status).toBe(403);
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

    const PNG1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const stdinOf = async (extra: object) => {
      const argsFile = join(dir, "args-img.json");
      const inFile = join(dir, "stdin-img.txt");
      rmSync(argsFile, { force: true });
      rmSync(inFile, { force: true });
      process.env.FAKE_ARGS_FILE = argsFile;
      process.env.FAKE_STDIN_FILE = inFile;
      const r = await chat({ prompt: "이 쪽 그림 설명해줘", system: "SYS", ...extra });
      delete process.env.FAKE_STDIN_FILE;
      return {
        r,
        args: existsSync(argsFile) ? (JSON.parse(readFileSync(argsFile, "utf8")) as string[]) : [],
        stdin: existsSync(inFile) ? readFileSync(inFile, "utf8") : "",
      };
    };

    it("쪽 그림을 보내면 stream-json 입력으로 그림 블록과 질문을 함께 전달한다", async () => {
      const { r, args, stdin } = await stdinOf({ images: [{ mediaType: "image/jpeg", data: PNG1 }] });
      expect(r.status).toBe(200);
      expect(args[args.indexOf("--input-format") + 1]).toBe("stream-json");
      expect(args[args.indexOf("--tools") + 1]).toBe(""); // 그림을 보내도 도구는 열리지 않는다
      expect(args[args.indexOf("--append-system-prompt") + 1]).toContain("# Page image");
      const msg = JSON.parse(stdin.trim());
      expect(msg.type).toBe("user");
      expect(msg.message.content[0]).toEqual({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: PNG1 },
      });
      expect(msg.message.content[1]).toEqual({ type: "text", text: "이 쪽 그림 설명해줘" });
    });

    it("그림이 없으면 예전처럼 글자만 표준입력으로 보낸다", async () => {
      const { args, stdin } = await stdinOf({});
      expect(args).not.toContain("--input-format");
      expect(stdin).toBe("이 쪽 그림 설명해줘");
    });

    it("잘못된 그림은 400 으로 거절하고 실행하지 않는다", async () => {
      const bad = [
        [{ mediaType: "image/svg+xml", data: PNG1 }],
        [{ mediaType: "image/png", data: "not base64!!" }],
        [{ mediaType: "image/png", data: "" }],
        [{ mediaType: "image/png", data: "A".repeat(1_800_001) }],
        [
          { mediaType: "image/png", data: PNG1 },
          { mediaType: "image/png", data: PNG1 },
          { mediaType: "image/png", data: PNG1 },
        ],
        [],
        "x",
        [null],
      ];
      for (const images of bad) {
        const { r, args } = await stdinOf({ images });
        expect(r.status).toBe(400);
        expect(args).toEqual([]);
      }
    });

    it("웹 검색을 켜면 WebSearch 만 열고(WebFetch·셸 없음) 묻지 않고 나머지는 거부한다", async () => {
      const argsFile = join(dir, "args-web.json");
      process.env.FAKE_ARGS_FILE = argsFile;
      await chat({ prompt: "hi", system: "SYS", web: true });
      const a: string[] = JSON.parse(readFileSync(argsFile, "utf8"));
      const pair = (flag: string) => a[a.indexOf(flag) + 1];
      expect(pair("--tools")).toBe("WebSearch");
      expect(pair("--permission-mode")).toBe("dontAsk");
      expect(pair("--allowedTools")).toBe("WebSearch");
      expect(a.join(" ")).not.toMatch(/WebFetch|Bash|Write|Edit|Read/);
      expect(a).toContain("--strict-mcp-config");
      const sys = pair("--append-system-prompt");
      expect(sys.startsWith("SYS")).toBe(true);
      expect(sys).toContain("# Web search");
      expect(sys).toContain("untrusted");
    });

    it("웹 검색은 true 일 때만 켜진다 (문자열·숫자 같은 값은 꺼짐)", async () => {
      const argsFile = join(dir, "args-web2.json");
      process.env.FAKE_ARGS_FILE = argsFile;
      for (const web of ["true", 1, "yes", null]) {
        await chat({ prompt: "hi", system: "SYS", web });
        const a: string[] = JSON.parse(readFileSync(argsFile, "utf8"));
        expect(a[a.indexOf("--tools") + 1]).toBe("");
        expect(a.join(" ")).not.toContain("WebSearch");
      }
    });

    it("폴더 연결 모드에서도 웹 검색은 WebSearch 한 가지만 더 연다", async () => {
      const argsFile = join(dir, "args-web3.json");
      process.env.FAKE_ARGS_FILE = argsFile;
      const proj = mkdtempSync(join(tmpdir(), "hmd-web-"));
      await chat({ prompt: "hi", system: "SYS", web: true, project: { dir: proj } });
      const a: string[] = JSON.parse(readFileSync(argsFile, "utf8"));
      expect(a[a.indexOf("--tools") + 1]).toBe("Read,Glob,Grep,WebSearch");
      expect(a[a.indexOf("--allowedTools") + 1]).toBe("WebSearch");
      expect(a.join(" ")).not.toMatch(/WebFetch|Bash|Write|Edit\b/);
      expect(a[a.indexOf("--append-system-prompt") + 1]).toContain("besides WebSearch");
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

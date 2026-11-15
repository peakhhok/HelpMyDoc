// 로컬 브리지: 사용자 PC에 설치된 Claude Code(`claude -p`)를 그대로 실행하고 응답을 스트리밍한다.
//
// 지켜야 할 원칙 (Anthropic 약관/사용 정책):
//  - Claude Code 바이너리는 수정 없이 그대로 실행한다. 로그인은 Claude Code 가 직접 처리한다.
//  - 이 프로그램은 로그인 토큰/세션을 읽거나 저장하거나 중계하지 않는다.
//  - 127.0.0.1 에서만 열리며, 본인 PC 에서 본인 계정으로만 쓰는 용도다.
//    (다른 사람에게 서버로 제공하거나 구독 한도를 공유하는 용도로 쓰지 말 것)
import { spawn, execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PREFIX = "/api/claude-code/";
const WORKDIR = join(tmpdir(), "helpmydoc-claude-code"); // 프로젝트 CLAUDE.md 등이 섞이지 않도록 빈 폴더에서 실행
const MAX_BODY = 4 * 1024 * 1024;
const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 5 * 60 * 1000;
const MODEL_RE = /^[a-z0-9][a-z0-9.\-\[\]]{0,63}$/i;

let running = 0;

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** 다른 웹사이트가 localhost 브리지를 몰래 호출하는 것(CSRF, DNS rebinding)을 막는다. */
function isTrustedRequest(req) {
  const host = String(req.headers.host ?? "").toLowerCase();
  const hostname = host.replace(/:\d+$/, "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== host) return false;
    } catch {
      return false;
    }
  }
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return false;
  return true;
}

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, cwd: WORKDIR, windowsHide: true }, (err, stdout) => resolve({ err, stdout: String(stdout ?? "") }));
  });
}

async function status() {
  mkdirSync(WORKDIR, { recursive: true });
  const v = await run("claude", ["--version"]);
  if (v.err) return { available: false };
  const out = { available: true, version: v.stdout.trim().split("\n")[0] };
  const a = await run("claude", ["auth", "status", "--json"]);
  try {
    const j = JSON.parse(a.stdout);
    // 계정 식별 정보는 노출하지 않고 로그인 여부와 방식만 전달한다.
    out.loggedIn = !!j.loggedIn;
    out.authMethod = j.authMethod ?? null;
  } catch {
    out.loggedIn = undefined;
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("요청이 너무 큽니다."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function chat(req, res) {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
    return json(res, 415, { error: "application/json 만 허용됩니다." });
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return json(res, 400, { error: e.message || "잘못된 요청입니다." });
  }
  const { prompt, system, model } = body ?? {};
  if (typeof prompt !== "string" || !prompt.trim()) return json(res, 400, { error: "prompt 가 필요합니다." });
  if (model != null && model !== "" && (typeof model !== "string" || !MODEL_RE.test(model))) {
    return json(res, 400, { error: "model 값이 올바르지 않습니다." });
  }
  if (running >= MAX_CONCURRENT) return json(res, 429, { error: "동시에 처리할 수 있는 요청 수를 넘었습니다." });

  mkdirSync(WORKDIR, { recursive: true });
  // 순수 채팅 용도: 파일/명령 도구, MCP, 슬래시 명령, 프로젝트 설정을 모두 끈다.
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--tools", "",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--setting-sources", "user",
  ];
  if (typeof system === "string" && system) args.push("--append-system-prompt", system);
  if (model) args.push("--model", model);

  running++;
  res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" });
  const send = (o) => res.writable && res.write(JSON.stringify(o) + "\n");

  const child = spawn("claude", args, { cwd: WORKDIR, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
  let buf = "";
  let stderr = "";
  let streamed = false;
  let lastAssistant = "";
  let failure = "";
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    running--;
  };

  child.on("error", (e) => {
    failure = e.code === "ENOENT" ? "claude 명령을 찾을 수 없습니다. Claude Code 를 설치해 주세요." : e.message;
    send({ t: "error", message: failure });
    finish();
    res.end();
  });

  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.type === "stream_event" && e.event?.type === "content_block_delta" && e.event.delta?.type === "text_delta") {
        streamed = true;
        send({ t: "text", text: e.event.delta.text });
      } else if (e.type === "assistant") {
        lastAssistant = (e.message?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
      } else if (e.type === "result" && e.is_error) {
        failure = String(e.result ?? "Claude Code 오류");
      }
    }
  });
  child.stderr.on("data", (d) => {
    if (stderr.length < 2000) stderr += d;
  });
  child.on("close", (code) => {
    if (finished) return;
    if (!streamed && lastAssistant && !failure) send({ t: "text", text: lastAssistant });
    else if (!streamed && (failure || code !== 0)) {
      send({ t: "error", message: failure || stderr.trim().slice(0, 400) || `claude 가 코드 ${code} 로 종료되었습니다.` });
    }
    send({ t: "done" });
    finish();
    res.end();
  });

  // 브라우저가 중단하면(중지 버튼, 탭 닫기) 자식 프로세스도 종료한다.
  res.on("close", () => {
    if (!res.writableEnded) child.kill("SIGTERM");
  });

  child.stdin.on("error", () => {});
  child.stdin.end(prompt);
}

/** connect 스타일 미들웨어. 해당 경로가 아니면 next() 로 넘긴다. */
export function claudeCodeBridge(req, res, next) {
  const url = req.url ?? "";
  if (!url.startsWith(PREFIX)) return next();
  if (!isTrustedRequest(req)) return json(res, 403, { error: "허용되지 않은 출처입니다." });

  const route = url.slice(PREFIX.length).split("?")[0];
  if (route === "status" && req.method === "GET") {
    status().then((s) => json(res, 200, s), (e) => json(res, 500, { error: String(e) }));
  } else if (route === "chat" && req.method === "POST") {
    chat(req, res).catch((e) => {
      if (!res.headersSent) json(res, 500, { error: String(e?.message ?? e) });
      else res.end();
    });
  } else {
    json(res, 404, { error: "not found" });
  }
}

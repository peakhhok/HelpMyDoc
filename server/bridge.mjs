// 로컬 브리지: 사용자 PC에 설치된 공식 CLI(Claude Code `claude -p`, Codex `codex exec`)를 그대로 실행하고
// 응답을 스트리밍한다. CLI 별 차이(인자, 출력 형식)는 adapters.mjs 에 있다.
//
// 지켜야 할 원칙 (각 회사의 약관/사용 정책):
//  - 공식 프로그램은 수정 없이 그대로 실행한다. 로그인은 그 프로그램이 직접 처리한다.
//  - 이 프로그램은 로그인 토큰/세션을 읽거나 저장하거나 중계하지 않는다.
//  - 127.0.0.1 에서만 열리며, 본인 PC 에서 본인 계정으로만 쓰는 용도다.
//    (다른 사람에게 서버로 제공하거나 구독 한도를 공유하는 용도로 쓰지 말 것)
import { spawn, execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adapters, resolveAdapterCommand, stripAnsi } from "./adapters.mjs";
import { ProjectError, describeProject, readClaudeMd, validateProject } from "./project.mjs";

const MAX_BODY = 4 * 1024 * 1024;
const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 5 * 60 * 1000;
/** 프로젝트 폴더 모드는 파일을 여러 번 읽을 수 있어 더 오래 걸릴 수 있다 */
const PROJECT_TIMEOUT_MS = 15 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const MODEL_RE = /^[a-z0-9][a-z0-9.\-\[\]]{0,63}$/i;
const ROUTE_RE = /^\/api\/([a-z-]+)\/([a-z]+)(?:\?.*)?$/;

let running = 0;
/** 로그인 흐름은 한 번에 하나만 */
let loginRunning = false;

export function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** 다른 웹사이트가 localhost 브리지를 몰래 호출하는 것(CSRF, DNS rebinding)을 막는다. */
export function isTrustedRequest(req) {
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

/** 프로젝트 설정 등이 섞이지 않도록 CLI 마다 빈 임시 폴더에서 실행한다. */
function workdirFor(adapter) {
  const dir = join(tmpdir(), `helpmydoc-${adapter.id}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** cli: resolveCli 의 결과 ({ command, prefixArgs, env }) */
function run(cli, args, cwd, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(
      cli.command,
      [...cli.prefixArgs, ...args],
      { timeout, cwd, windowsHide: true, env: { ...process.env, ...cli.env } },
      (err, stdout, stderr) =>
        resolve({
          ok: !err,
          code: err ? (typeof err.code === "number" ? err.code : -1) : 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        }),
    );
  });
}

async function status(adapter) {
  const cwd = workdirFor(adapter);
  const cli = resolveAdapterCommand(adapter);
  const out = await adapter.status({ run: (c, args) => run(c, args, cwd), cli });
  // 윈도우에서 npm 래퍼(.cmd)만 있고 실행할 방법을 못 찾은 경우를 화면에서 안내할 수 있게 알린다.
  if (!out.available && cli.shimOnly) out.shimOnly = true;
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

async function chat(adapter, req, res) {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
    return json(res, 415, { error: "application/json 만 허용됩니다." });
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return json(res, 400, { error: e.message || "잘못된 요청입니다." });
  }
  const { prompt, system, model, project: projectInput } = body ?? {};
  if (typeof prompt !== "string" || !prompt.trim()) return json(res, 400, { error: "prompt 가 필요합니다." });
  if (model != null && model !== "" && (typeof model !== "string" || !MODEL_RE.test(model))) {
    return json(res, 400, { error: "model 값이 올바르지 않습니다." });
  }
  if (running >= MAX_CONCURRENT) return json(res, 429, { error: "동시에 처리할 수 있는 요청 수를 넘었습니다." });

  // 프로젝트 폴더 연결: 그 폴더에서 읽기 도구(와 허용한 경로의 쓰기)를 열어 실행한다.
  let project = null;
  let systemText = typeof system === "string" ? system : "";
  if (projectInput != null) {
    if (!adapter.supportsProject) return json(res, 400, { error: "이 연결 방식은 프로젝트 폴더를 지원하지 않습니다." });
    try {
      project = validateProject(projectInput);
    } catch (e) {
      return json(res, e instanceof ProjectError ? e.status : 500, { error: e.message });
    }
    systemText += adapter.projectSystem({ ...project, claudeMd: readClaudeMd(project.dir) });
  }

  const cwd = project ? project.dir : workdirFor(adapter);
  const cli = resolveAdapterCommand(adapter);
  const args = adapter.buildArgs({ system: systemText, model, project });

  running++;
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  });
  const send = (o) => res.writable && res.write(JSON.stringify(o) + "\n");

  const child = spawn(cli.command, [...cli.prefixArgs, ...args], {
    cwd,
    env: { ...process.env, ...cli.env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), project ? PROJECT_TIMEOUT_MS : TIMEOUT_MS);
  const state = adapter.newState({ project });
  let buf = "";
  let stderr = "";
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    running--;
  };

  child.on("error", (e) => {
    send({ t: "error", message: e.code === "ENOENT" ? adapter.notFoundMessage : e.message });
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
      for (const ev of adapter.handle(e, state)) send(ev);
    }
  });
  child.stderr.on("data", (d) => {
    if (stderr.length < 2000) stderr += d;
  });
  child.on("close", (code) => {
    if (finished) return;
    for (const ev of adapter.finish(state, { code, stderr })) send(ev);
    send({ t: "done" });
    finish();
    res.end();
  });

  // 브라우저가 중단하면(중지 버튼, 탭 닫기) 자식 프로세스도 종료한다.
  res.on("close", () => {
    if (!res.writableEnded) child.kill("SIGTERM");
  });

  child.stdin.on("error", () => {});
  child.stdin.end(adapter.buildStdin({ prompt, system: systemText }));
}

/** 실패했을 때 보여줄 마지막 출력 한 줄. 링크(일회용 인증 주소)는 가린다. */
function tailOf(text) {
  const lines = stripAnsi(text)
    .replace(/https?:\/\/\S+/g, "[링크]")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return (lines.at(-1) ?? "").slice(-200);
}

/**
 * "로그인 시도하기": 공식 CLI 의 로그인 명령(고정 인자) 하나만 실행한다.
 *  - 셸을 거치지 않고, 요청에서 받은 값은 명령에 전혀 쓰지 않는다.
 *  - 표준입력은 막는다. (인증 코드를 앱이 대신 전달하지 않는다. 브라우저 로그인은 CLI 가 직접 마무리한다)
 *  - 연결이 끊기면(취소, 화면 닫기) 프로세스를 종료한다.
 * 화면에는 {t:"started"}, {t:"opened"}(브라우저를 열었다고 알림), {t:"exit", code, tail} 만 보낸다.
 */
function login(adapter, res) {
  if (!adapter.loginArgs) return json(res, 404, { error: "not found" });
  if (loginRunning) return json(res, 409, { error: "이미 로그인이 진행 중입니다." });

  const cwd = workdirFor(adapter);
  const cli = resolveAdapterCommand(adapter);
  loginRunning = true;
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  });
  const send = (o) => res.writable && res.write(JSON.stringify(o) + "\n");
  send({ t: "started" });

  const child = spawn(cli.command, [...cli.prefixArgs, ...adapter.loginArgs], {
    cwd,
    env: { ...process.env, ...cli.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), LOGIN_TIMEOUT_MS);
  let out = "";
  let opened = false;
  let done = false;

  const finish = () => {
    if (done) return false;
    done = true;
    clearTimeout(timer);
    loginRunning = false;
    return true;
  };
  const onData = (d) => {
    out = (out + d).slice(-4000);
    if (!opened && /opening browser/i.test(out)) {
      opened = true;
      send({ t: "opened" });
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);

  child.on("error", (e) => {
    if (!finish()) return;
    send({ t: "error", message: e.code === "ENOENT" ? adapter.notFoundMessage : e.message });
    res.end();
  });
  child.on("close", (code) => {
    if (!finish()) return;
    send({ t: "exit", code: code ?? -1, tail: code === 0 ? "" : tailOf(out) });
    res.end();
  });
  res.on("close", () => {
    if (!res.writableEnded) child.kill("SIGTERM");
  });
}

/** connect 스타일 미들웨어. 브리지 경로(/api/<cli>/…)가 아니면 next() 로 넘긴다. */
export function claudeCodeBridge(req, res, next) {
  const m = ROUTE_RE.exec(req.url ?? "");
  const adapter = m && Object.hasOwn(adapters, m[1]) ? adapters[m[1]] : null;
  if (!adapter) return next();
  if (!isTrustedRequest(req)) return json(res, 403, { error: "허용되지 않은 출처입니다." });

  const route = m[2];
  if (route === "status" && req.method === "GET") {
    status(adapter).then(
      (s) => json(res, 200, s),
      (e) => json(res, 500, { error: String(e) }),
    );
  } else if (route === "project" && req.method === "GET" && adapter.supportsProject) {
    const dir = new URL(req.url, "http://localhost").searchParams.get("dir") ?? "";
    try {
      json(res, 200, describeProject(dir));
    } catch (e) {
      json(res, e instanceof ProjectError ? 400 : 500, { ok: false, error: e.message });
    }
  } else if (route === "login" && req.method === "POST") {
    login(adapter, res);
  } else if (route === "chat" && req.method === "POST") {
    chat(adapter, req, res).catch((e) => {
      if (!res.headersSent) json(res, 500, { error: String(e?.message ?? e) });
      else res.end();
    });
  } else {
    json(res, 404, { error: "not found" });
  }
}

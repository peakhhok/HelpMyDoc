// 패키징된 데스크톱 앱을 실제로 실행해 보는 스모크 테스트. (CI 의 윈도우·맥·리눅스 서버에서 돌린다)
//
// 사용법: node scripts/smoke-desktop.cjs <패키징된 실행 파일 경로>
//
// 확인하는 것
//  1. 앱이 뜨고 창 제목, 첫 실행 시작 화면이 보인다 (asar 안의 서버·화면이 OS 에서 동작)
//  2. 브리지가 응답한다 (/api/claude-code/status, /api/codex/status)
//  3. 가짜 codex 를 PATH 에 두고 Codex 를 감지한다 — 윈도우에서는 npm 래퍼(codex.cmd)를 셸 없이 실행하는 경로를 검증
//  4. PDF 를 열면 pdf.js 워커·글꼴 자산이 패키지 안에서 로드되어 렌더링되고 텍스트 레이어가 나온다
const { _electron } = require("playwright-core");
const { chmodSync, mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { delimiter, join } = require("node:path");

const exe = process.argv[2];
// 포터블 exe 처럼 "실제 앱을 자식 프로세스로 띄우는" 포장은 Playwright 가 연결을 못 잡는다.
// 그때는 --http-only 로 앱을 그냥 실행하고 로컬 서버가 응답하는지만 확인한다.
const httpOnly = process.argv.includes("--http-only");
if (!exe) {
  console.error("사용법: node scripts/smoke-desktop.cjs <실행 파일 경로> [--http-only]");
  process.exit(2);
}

let failures = 0;
const check = (name, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "  OK  " : "  FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

/** 텍스트 하나가 들어 있는 최소 PDF (xref 오프셋을 계산해 만든다) */
function tinyPdf(text) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null, // 내용 스트림 (아래에서 채움)
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 24 Tf 20 100 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** 가짜 codex: 윈도우에서는 npm 이 만드는 래퍼(codex.cmd)와 그 옆의 진입점(codex.js)을 흉내 낸다. */
function makeFakeCodex() {
  const dir = mkdtempSync(join(tmpdir(), "hmd-smoke-bin-"));
  const body = `
const a = process.argv.slice(2);
if (a[0] === "--version") { console.log("codex-cli 9.9.9"); process.exit(0); }
if (a[0] === "login" && a[1] === "status") { console.log("Logged in using ChatGPT"); process.exit(0); }
process.exit(2);
`;
  if (process.platform === "win32") {
    writeFileSync(
      join(dir, "codex.cmd"),
      '@echo off\r\nnode "%~dp0node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
    );
    const js = join(dir, "node_modules", "@openai", "codex", "bin");
    mkdirSync(js, { recursive: true });
    writeFileSync(join(js, "codex.js"), body);
  } else {
    writeFileSync(join(dir, "codex"), "#!/usr/bin/env node\n" + body);
    chmodSync(join(dir, "codex"), 0o755);
  }
  return dir;
}

/** 앱을 일반 프로세스로 실행하고, 로컬 서버(고정 포트)가 화면과 브리지를 서비스하는지 HTTP 로 확인한다. */
async function httpOnlySmoke({ userData, env }) {
  const { spawn, spawnSync } = require("node:child_process");
  const http = require("node:http");
  const get = (path) =>
    new Promise((resolve, reject) => {
      const req = http.get({ host: "127.0.0.1", port: 47821, path, timeout: 3000 }, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("timeout")));
    });

  const child = spawn(exe, ["--user-data-dir=" + userData, ...(process.platform === "linux" ? ["--no-sandbox"] : [])], {
    env,
    stdio: "ignore",
    windowsHide: true,
  });
  let exited = null;
  child.on("exit", (code) => (exited = code));
  try {
    let home = null;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && !home) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        home = await get("/");
      } catch {
        /* 아직 안 떴다 */
      }
    }
    check(
      "앱이 뜨고 로컬 서버가 화면을 서비스",
      !!home && home.status === 200 && home.body.includes('id="root"'),
      home ? `HTTP ${home.status}` : `응답 없음 (프로세스 종료 코드: ${exited})`,
    );
    if (home) {
      const claude = JSON.parse((await get("/api/claude-code/status")).body);
      check("Claude 브리지 응답", claude.platform === process.platform, JSON.stringify(claude));
      const codex = JSON.parse((await get("/api/codex/status")).body);
      check("Codex 감지", codex.available === true && codex.version === "codex-cli 9.9.9", JSON.stringify(codex));
    }
  } finally {
    // 포터블 exe 는 압축을 푼 실제 앱이 자식 프로세스이므로 프로세스 트리를 통째로 끝낸다.
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else child.kill("SIGKILL");
  }
  console.log(failures ? `\n실패 ${failures}건` : "\n스모크 테스트 통과");
  process.exit(failures ? 1 : 0);
}

(async () => {
  const userData = mkdtempSync(join(tmpdir(), "hmd-smoke-ud-"));
  const shimDir = makeFakeCodex();
  const args = ["--user-data-dir=" + userData];
  if (process.platform === "linux") args.push("--no-sandbox"); // CI 의 비특권 사용자 환경
  console.log(`실행: ${exe} (${process.platform})`);

  // 윈도우의 PATH 변수 이름은 `Path` 일 수 있다. 같은 이름으로 덧붙여야 중복 키가 생기지 않는다.
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  // 스모크 테스트는 GitHub 로 업데이트를 확인하지 않는다.
  const appEnv = {
    ...process.env,
    [pathKey]: shimDir + delimiter + (process.env[pathKey] ?? ""),
    HELPMYDOC_NO_UPDATE: "1",
  };
  if (httpOnly) return httpOnlySmoke({ userData, env: appEnv });
  const app = await _electron.launch({
    executablePath: exe,
    args,
    env: appEnv,
    timeout: 60_000,
  });
  const errors = [];
  try {
    const packaged = await app.evaluate(({ app }) => app.isPackaged);
    check("패키징된 앱으로 실행됨", packaged === true);

    const win = await app.firstWindow();
    win.on("pageerror", (e) => errors.push(e.message));
    await win.waitForSelector(".setup", { timeout: 30_000 });
    check("창 제목", (await win.title()) === "HelpMyDoc", await win.title());
    check("첫 실행 시작 화면", (await win.locator(".setup h1").innerText()).includes("시작하기"));
    check("고정 포트로 로컬 서버에 연결", win.url().startsWith("http://127.0.0.1:"), win.url());

    const st = await win.evaluate(async () => ({
      claude: await (await fetch("/api/claude-code/status")).json(),
      codex: await (await fetch("/api/codex/status")).json(),
    }));
    check("Claude 브리지 응답", st.claude && st.claude.platform === process.platform, JSON.stringify(st.claude));
    check(
      process.platform === "win32" ? "Codex 감지 (npm 래퍼 codex.cmd → 진입점 직접 실행)" : "Codex 감지 (PATH)",
      st.codex.available === true && st.codex.version === "codex-cli 9.9.9" && st.codex.loggedIn === true,
      JSON.stringify(st.codex),
    );

    // 첫 실행 화면을 넘기고 PDF 를 연다
    await win.getByRole("button", { name: "나중에 설정하고 PDF만 보기" }).click();
    await win.waitForSelector(".dropzone", { timeout: 15_000 });
    await win.setInputFiles('input[type="file"]', {
      name: "smoke.pdf",
      mimeType: "application/pdf",
      buffer: tinyPdf("SMOKE-TEST-7731"),
    });
    await win.waitForSelector(".page-content canvas", { timeout: 30_000 });
    check("PDF 렌더링 (pdf.js 워커·자산이 패키지 안에서 로드됨)", true);
    await win.waitForFunction(
      () => (document.querySelector(".textLayer")?.textContent ?? "").includes("SMOKE-TEST-7731"),
      null,
      { timeout: 15_000 },
    );
    check("PDF 텍스트 레이어 추출", true);

    // Ctrl+마우스 휠로 PDF 만 확대·축소된다 (화면 전체 확대가 아님)
    const zoomText = () => win.locator(".zoom span").innerText();
    const before = await zoomText();
    await win.locator(".viewer").hover();
    await win.keyboard.down("Control");
    await win.mouse.wheel(0, -300);
    await win.keyboard.up("Control");
    await win.waitForFunction((b) => document.querySelector(".zoom span")?.textContent !== b, before, {
      timeout: 5_000,
    });
    check("Ctrl+휠 확대", parseInt(await zoomText(), 10) > parseInt(before, 10), `${before} → ${await zoomText()}`);
    await win.keyboard.press("Control+0");
    await win.waitForFunction((b) => document.querySelector(".zoom span")?.textContent === b, before, {
      timeout: 5_000,
    });
    check("Ctrl+0 으로 기본 배율 복귀", (await zoomText()) === before);
    check("화면 오류 없음", errors.length === 0, errors.join(" | "));
  } finally {
    await app.close().catch(() => {});
  }
  console.log(failures ? `\n실패 ${failures}건` : "\n스모크 테스트 통과");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("스모크 테스트 실행 실패:", e);
  process.exit(1);
});

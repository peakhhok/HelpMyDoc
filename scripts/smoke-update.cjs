// 윈도우 자동 업데이트 흐름 시험: 구버전(0.0.1)을 설치해 실행 → 로컬 서버의 신버전(0.0.2)을 받아 → 설치·재시작 → 0.0.2 로 뜨는지 확인한다.
//
// 먼저 make-update-test-config.cjs 로 두 버전을 빌드해 release-old/, release-new/ 를 만들어 둔다.
const http = require("node:http");
const { readdirSync, mkdirSync, mkdtempSync, createReadStream, existsSync, statSync } = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const { tmpdir } = require("node:os");
const { extname, join } = require("node:path");

const FEED_PORT = 8765;
const APP_PORT = 47821;
let failures = 0;
const check = (name, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "  OK  " : "  FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 업데이트 서버: release-new 폴더를 그대로 서비스한다 (latest.yml, 설치 파일, blockmap) */
function serveFeed(dir) {
  return http
    .createServer((req, res) => {
      const file = join(dir, decodeURIComponent((req.url ?? "/").split("?")[0]));
      console.log(`  [feed] ${req.method} ${req.url}`);
      if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "content-type": extname(file) === ".yml" ? "text/yaml" : "application/octet-stream",
        "content-length": statSync(file).size,
      });
      createReadStream(file).pipe(res);
    })
    .listen(FEED_PORT, "127.0.0.1");
}

const getJson = (path) =>
  new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: APP_PORT, path, timeout: 3000 }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
  });
const post = (path) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: APP_PORT, method: "POST", path, headers: { "content-type": "application/json" } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end("{}");
  });

async function waitFor(fn, ms, label) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
      last = v;
    } catch (e) {
      last = e.message;
    }
    await sleep(2000);
  }
  throw new Error(`시간 초과: ${label} (마지막 값: ${JSON.stringify(last)})`);
}

(async () => {
  const oldInstaller = readdirSync("release-old").find((f) => /Setup-0\.0\.1\.exe$/.test(f));
  const newInstaller = readdirSync("release-new").find((f) => /Setup-0\.0\.2\.exe$/.test(f));
  check("구버전/신버전 설치 파일이 있음", !!oldInstaller && !!newInstaller, `${oldInstaller} / ${newInstaller}`);
  check(
    "신버전 폴더에 업데이트 정보(latest.yml)가 있음",
    existsSync("release-new/latest.yml"),
    readdirSync("release-new").join(", "),
  );
  if (failures) process.exit(1);

  const feed = serveFeed(join(process.cwd(), "release-new"));
  try {
    console.log("구버전 0.0.1 을 조용히 설치");
    const inst = spawnSync(join("release-old", oldInstaller), ["/S"], { stdio: "inherit" });
    check("구버전 설치 완료", inst.status === 0, `종료 코드 ${inst.status}`);
    const exe = join(process.env.LOCALAPPDATA, "Programs", "HelpMyDoc", "HelpMyDoc.exe");
    check("설치된 실행 파일이 있음", existsSync(exe), exe);

    const userData = mkdtempSync(join(tmpdir(), "hmd-upd-ud-"));
    console.log("구버전 실행 (3초 뒤 업데이트를 확인하도록)");
    const app = spawn(exe, ["--user-data-dir=" + userData], {
      env: { ...process.env, HELPMYDOC_UPDATE_CHECK_DELAY_MS: "3000" },
      stdio: "ignore",
      windowsHide: true,
    });

    const first = await waitFor(
      async () => (await getJson("/api/app/update")).currentVersion === "0.0.1" && (await getJson("/api/app/update")),
      90_000,
      "구버전 앱 시작",
    );
    check("실행 중인 버전은 0.0.1", first.currentVersion === "0.0.1", JSON.stringify(first));

    console.log("신버전을 내려받아 '준비됨'이 될 때까지 대기");
    const ready = await waitFor(
      async () => {
        const s = await getJson("/api/app/update");
        if (s.state === "error") throw new Error("업데이트 오류: " + s.error);
        return s.state === "ready" && s;
      },
      240_000,
      "신버전 다운로드",
    );
    check(
      "신버전(0.0.2)을 받아 준비됨",
      ready.version === "0.0.2" && ready.currentVersion === "0.0.1",
      JSON.stringify(ready),
    );

    console.log("설치하고 다시 시작 요청");
    check("설치 요청이 받아들여짐 (200)", (await post("/api/app/update/install")) === 200);

    const updated = await waitFor(
      async () => {
        const s = await getJson("/api/app/update");
        return s.currentVersion === "0.0.2" && s;
      },
      240_000,
      "신버전으로 재시작",
    );
    check("업데이트 후 실행 중인 버전은 0.0.2", updated.currentVersion === "0.0.2", JSON.stringify(updated));
    check("업데이트 후 더 받을 것이 없음(최신)", ["idle", "checking"].includes(updated.state), updated.state);
    app.kill();
  } catch (e) {
    check("업데이트 흐름", false, e.message);
  } finally {
    spawnSync("taskkill", ["/IM", "HelpMyDoc.exe", "/T", "/F"]);
    feed.close();
  }
  console.log(failures ? `\n실패 ${failures}건` : "\n업데이트 흐름 테스트 통과");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("업데이트 테스트 실행 실패:", e);
  process.exit(1);
});

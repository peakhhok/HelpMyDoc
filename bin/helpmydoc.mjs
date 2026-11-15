#!/usr/bin/env node
// 빌드된 앱(dist/)과 로컬 Claude Code 브리지를 127.0.0.1 에서 함께 서비스한다.
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeCodeBridge } from "../server/bridge.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
if (!existsSync(join(root, "index.html"))) {
  console.error("dist/ 가 없습니다. 먼저 `npm run build` 를 실행하세요.");
  process.exit(1);
}

const argPort = process.argv.indexOf("--port");
const port = Number(argPort > 0 ? process.argv[argPort + 1] : process.env.PORT) || 5174;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".png": "image/png",
};

function serveStatic(req, res) {
  const pathname = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let file = normalize(join(root, pathname));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html"); // SPA fallback
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

http
  .createServer((req, res) => claudeCodeBridge(req, res, () => serveStatic(req, res)))
  .listen(port, "127.0.0.1", () => {
    console.log(`HelpMyDoc  →  http://localhost:${port}`);
    console.log("로컬 Claude Code 브리지가 127.0.0.1 에서만 열려 있습니다. (본인 PC 에서 본인 계정으로만 사용하세요)");
  });

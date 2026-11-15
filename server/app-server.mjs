// 빌드된 앱(dist/)과 로컬 Claude Code 브리지를 하나의 HTTP 서버로 묶는다.
// `npm start`(bin/helpmydoc.mjs)와 데스크톱 앱(electron/main.mjs)이 함께 사용한다.
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { claudeCodeBridge } from "./bridge.mjs";

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

export function createStaticHandler(root) {
  return (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent((req.url ?? "/").split("?")[0]);
    } catch {
      res.writeHead(400).end("bad request");
      return;
    }
    let file = normalize(join(root, pathname));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html"); // SPA fallback
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  };
}

/** root: 빌드 결과(dist) 폴더. 호출한 쪽에서 listen 한다. (항상 127.0.0.1 에만 바인딩할 것) */
export function createAppServer({ root }) {
  const serveStatic = createStaticHandler(root);
  return http.createServer((req, res) => claudeCodeBridge(req, res, () => serveStatic(req, res)));
}

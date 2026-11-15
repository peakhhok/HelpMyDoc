#!/usr/bin/env node
// 빌드된 앱(dist/)과 로컬 Claude Code 브리지를 127.0.0.1 에서 함께 서비스한다.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAppServer } from "../server/app-server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
if (!existsSync(join(root, "index.html"))) {
  console.error("dist/ 가 없습니다. 먼저 `npm run build` 를 실행하세요.");
  process.exit(1);
}

const argPort = process.argv.indexOf("--port");
const port = Number(argPort > 0 ? process.argv[argPort + 1] : process.env.PORT) || 5174;

createAppServer({ root }).listen(port, "127.0.0.1", () => {
  console.log(`HelpMyDoc  →  http://localhost:${port}`);
  console.log("로컬 Claude Code 브리지가 127.0.0.1 에서만 열려 있습니다. (본인 PC 에서 본인 계정으로만 사용하세요)");
});

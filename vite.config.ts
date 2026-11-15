import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import claudeCodeBridge from "./server/vite-plugin.mjs";

const version: string = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

/** 어떤 코드로 빌드된 앱인지 설정창에서 알 수 있도록 커밋 해시를 넣는다. (git 이 없으면 unknown) */
function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  plugins: [react(), claudeCodeBridge()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(gitCommit()),
  },
});

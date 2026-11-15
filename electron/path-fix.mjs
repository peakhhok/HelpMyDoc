// 맥/리눅스에서 앱을 더블클릭(Finder/런처)으로 열면 터미널의 PATH 를 물려받지 못해
// 설치된 `claude` 를 찾지 못한다. 로그인 셸의 PATH 를 읽어 오고, 흔한 설치 위치를 덧붙인다.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, delimiter, join } from "node:path";

export const MARK = "__HELPMYDOC_PATH__";

/** 셸 출력에서 마커 사이의 PATH 만 꺼낸다. (rc 파일이 출력하는 잡음 무시) */
export function parseShellPath(stdout) {
  const m = new RegExp(`${MARK}([\\s\\S]*?)${MARK}`).exec(stdout);
  const value = m?.[1]?.trim();
  return value || null;
}

export function extraPathDirs(home, platform) {
  if (platform === "win32") return [];
  const common = [
    join(home, ".local", "bin"),
    join(home, ".claude", "local"),
    join(home, ".npm-global", "bin"),
    join(home, ".volta", "bin"),
    "/usr/local/bin",
  ];
  return platform === "darwin" ? ["/opt/homebrew/bin", ...common] : common;
}

/** 앞쪽 우선으로 합치고 중복을 제거한다. */
export function mergePath(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const dir of (list ?? "").split(delimiter)) {
      if (dir && !seen.has(dir)) {
        seen.add(dir);
        out.push(dir);
      }
    }
  }
  return out.join(delimiter);
}

/** @param {string} shell @param {(file: string, args: string[], options?: object) => string | Buffer} exec */
function readLoginShellPath(shell, exec) {
  const isFish = basename(shell) === "fish";
  const script = isFish ? `printf '%s' '${MARK}'(string join : $PATH)'${MARK}'` : `printf '%s' "${MARK}$PATH${MARK}"`;
  try {
    return parseShellPath(
      exec(shell, ["-ilc", script], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }),
    );
  } catch {
    return null; // 셸을 못 읽어도 아래의 기본 위치로 계속 진행
  }
}

/**
 * @param {{
 *   platform?: string,
 *   env?: Record<string, string | undefined>,
 *   home?: string,
 *   exec?: (file: string, args: string[], options?: object) => string | Buffer,
 * }} [opts]
 */
export function fixPath({
  platform = process.platform,
  env = process.env,
  home = homedir(),
  exec = execFileSync,
} = {}) {
  if (platform === "win32") return env.PATH ?? ""; // 윈도우 GUI 앱은 시스템 PATH 를 그대로 물려받는다
  const shell = env.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  return mergePath(readLoginShellPath(shell, exec), env.PATH, extraPathDirs(home, platform).join(delimiter));
}

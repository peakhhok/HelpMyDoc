import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 실행할 claude 명령을 정한다.
 *
 * 1. PATH 에서 찾을 수 있으면 그것을 쓴다. 윈도우에서는 `claude.cmd`(npm 래퍼)를 셸 없이 실행할 수 없으므로
 *    `claude.exe` 의 전체 경로를 직접 찾는다. (셸을 거치면 시스템 프롬프트 같은 인자가 명령 주입에 노출되어 쓰지 않는다.)
 *    그 밖의 OS 에서는 spawn 이 PATH 를 찾도록 이름만 돌려준다.
 * 2. PATH 에 없으면 공식 설치 프로그램의 기본 위치(`~/.local/bin/claude[.exe]`)를 확인한다.
 *    설치 직후에는 이미 켜져 있던 앱이 새 PATH 를 모르기 때문이다.
 * 3. 어디에도 없으면 이름만 돌려주어 '설치 안 됨'으로 처리되게 한다.
 *
 * @param {{ platform?: string, pathEnv?: string, home?: string, exists?: (path: string) => boolean }} [opts]
 */
export function resolveClaudeCommand({
  platform = process.platform,
  pathEnv = process.env.PATH ?? "",
  home = process.env.USERPROFILE || homedir(),
  exists = existsSync,
} = {}) {
  const win = platform === "win32";
  const exe = win ? "claude.exe" : "claude";
  const dirs = pathEnv.split(win ? ";" : ":").filter(Boolean);

  for (const dir of dirs) {
    const candidate = join(dir, exe);
    if (exists(candidate)) return win ? candidate : "claude";
  }
  const installed = join(home, ".local", "bin", exe);
  if (exists(installed)) return installed;
  return "claude";
}

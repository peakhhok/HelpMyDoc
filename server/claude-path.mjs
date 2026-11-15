import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 실행할 claude 명령을 정한다.
 * 윈도우에서는 `claude.cmd`(npm 래퍼)를 셸 없이 실행할 수 없으므로 PATH 에서 `claude.exe` 를 직접 찾는다.
 * (셸을 거치면 시스템 프롬프트 같은 인자가 명령 주입에 노출되어서 쓰지 않는다.)
 * 그 밖의 OS 에서는 spawn 이 PATH 를 찾도록 이름만 돌려준다.
 *
 * @param {{ platform?: string, pathEnv?: string, exists?: (path: string) => boolean }} [opts]
 */
export function resolveClaudeCommand({
  platform = process.platform,
  pathEnv = process.env.PATH ?? "",
  exists = existsSync,
} = {}) {
  if (platform !== "win32") return "claude";
  for (const dir of pathEnv.split(";").filter(Boolean)) {
    const candidate = join(dir, "claude.exe");
    if (exists(candidate)) return candidate;
  }
  return "claude";
}

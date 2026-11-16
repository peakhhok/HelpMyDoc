import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 실행할 CLI 명령을 정한다. (claude, codex 공통)
 *
 * 1. PATH 에서 찾을 수 있으면 그것을 쓴다. 윈도우에서는 `name.cmd`(npm 래퍼)를 셸 없이 실행할 수 없으므로
 *    `name.exe` 의 전체 경로를 직접 찾는다. (셸을 거치면 인자가 명령 주입에 노출되어 쓰지 않는다.)
 *    그 밖의 OS 에서는 spawn 이 PATH 를 찾도록 이름만 돌려준다.
 * 2. PATH 에 없으면 공식 설치 프로그램의 기본 위치(`~/.local/bin/name[.exe]`)를 확인한다.
 *    설치 직후에는 이미 켜져 있던 앱이 새 PATH 를 모르기 때문이다.
 * 3. 윈도우에서 npm 래퍼(`name.cmd`)만 있다면, 래퍼 옆의 실제 JS 진입점(shimScript)을 node 로 직접 실행한다.
 *    (Electron 에서는 ELECTRON_RUN_AS_NODE=1 로 같은 실행 파일을 node 처럼 쓴다.)
 * 4. 어디에도 없으면 found: false 로 돌려주어 '설치 안 됨'으로 처리되게 한다.
 *
 * @param {string} name
 * @param {{
 *   platform?: string,
 *   pathEnv?: string,
 *   home?: string,
 *   exists?: (path: string) => boolean,
 *   execPath?: string,
 *   shimScript?: string,
 * }} [opts]
 * @returns {{ command: string, prefixArgs: string[], env: Record<string, string>, found: boolean, shimOnly: boolean }}
 */
export function resolveCli(
  name,
  {
    platform = process.platform,
    pathEnv = process.env.PATH ?? "",
    home = process.env.USERPROFILE || homedir(),
    exists = existsSync,
    execPath = process.execPath,
    shimScript,
  } = {},
) {
  const win = platform === "win32";
  const exe = win ? `${name}.exe` : name;
  const dirs = pathEnv.split(win ? ";" : ":").filter(Boolean);
  const found = (command) => ({ command, prefixArgs: [], env: {}, found: true, shimOnly: false });

  for (const dir of dirs) {
    const candidate = join(dir, exe);
    if (exists(candidate)) return found(win ? candidate : name);
  }
  const installed = join(home, ".local", "bin", exe);
  if (exists(installed)) return found(installed);

  let shimOnly = false;
  if (win) {
    for (const dir of dirs) {
      if (!exists(join(dir, `${name}.cmd`))) continue;
      if (shimScript) {
        const script = join(dir, shimScript);
        if (exists(script)) {
          return {
            command: execPath,
            prefixArgs: [script],
            env: { ELECTRON_RUN_AS_NODE: "1" },
            found: true,
            shimOnly: false,
          };
        }
      }
      shimOnly = true;
    }
  }
  return { command: name, prefixArgs: [], env: {}, found: false, shimOnly };
}

/** 이전 이름 호환: claude 명령 문자열만 필요할 때 */
export function resolveClaudeCommand(opts) {
  return resolveCli("claude", opts).command;
}

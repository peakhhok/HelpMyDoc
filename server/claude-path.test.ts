import { describe, expect, it } from "vitest";
import { resolveCli, resolveClaudeCommand } from "./claude-path.mjs";

describe("resolveClaudeCommand", () => {
  it("윈도우 외에는 PATH 에 있으면 이름만 돌려주고 PATH 탐색은 spawn 에 맡긴다", () => {
    expect(
      resolveClaudeCommand({
        platform: "linux",
        pathEnv: "/a:/b",
        home: "/h",
        exists: (p: string) => p === "/b/claude",
      }),
    ).toBe("claude");
    expect(
      resolveClaudeCommand({ platform: "darwin", pathEnv: "/a", home: "/h", exists: (p: string) => p === "/a/claude" }),
    ).toBe("claude");
  });

  it("윈도우에서는 PATH 에서 claude.exe 의 전체 경로를 찾는다", () => {
    const found = resolveClaudeCommand({
      platform: "win32",
      pathEnv: "C:\\Windows;C:\\Users\\me\\.local\\bin;C:\\other",
      home: "C:\\Users\\me",
      exists: (p: string) => p.endsWith("claude.exe") && p.includes(".local"),
    });
    expect(found).toMatch(/\.local[\\/]bin[\\/]claude\.exe$/);
  });

  it("PATH 에 없으면 공식 설치 위치(~/.local/bin)를 확인한다 (설치 직후 앱을 다시 켜지 않아도 되게)", () => {
    const winHome = "C:\\Users\\me";
    const win = resolveClaudeCommand({
      platform: "win32",
      pathEnv: "C:\\a",
      home: winHome,
      exists: (p: string) => p.startsWith(winHome) && p.endsWith("claude.exe"), // PATH 의 C:\a 에는 없음
    });
    expect(win).toMatch(/Users[\\/]me[\\/]\.local[\\/]bin[\\/]claude\.exe$/);

    const mac = resolveClaudeCommand({
      platform: "darwin",
      pathEnv: "/usr/bin",
      home: "/Users/me",
      exists: (p: string) => p === "/Users/me/.local/bin/claude",
    });
    expect(mac).toBe("/Users/me/.local/bin/claude");
  });

  it("어디에도 없으면(claude.cmd 만 있는 경우 포함) 이름만 돌려줘 '설치 안 됨'으로 처리되게 한다", () => {
    expect(
      resolveClaudeCommand({ platform: "win32", pathEnv: "C:\\a;C:\\b", home: "C:\\h", exists: () => false }),
    ).toBe("claude");
    expect(resolveClaudeCommand({ platform: "linux", pathEnv: "/a", home: "/h", exists: () => false })).toBe("claude");
  });

  it("PATH 가 비어 있어도 던지지 않는다", () => {
    expect(resolveClaudeCommand({ platform: "win32", pathEnv: "", home: "C:\\h", exists: () => false })).toBe("claude");
  });
});

describe("resolveCli (npm 래퍼 처리)", () => {
  const shimScript = "node_modules/@openai/codex/bin/codex.js";

  it("윈도우에서 codex.exe 가 있으면 그것을 직접 쓴다", () => {
    const r = resolveCli("codex", {
      platform: "win32",
      pathEnv: "C:\\a;C:\\tools",
      home: "C:\\h",
      exists: (p: string) => p.includes("tools") && p.endsWith("codex.exe"),
      shimScript,
    });
    expect(r.found).toBe(true);
    expect(r.command).toMatch(/tools[\\/]codex\.exe$/);
    expect(r.prefixArgs).toEqual([]);
  });

  it("윈도우에서 npm 래퍼(codex.cmd)만 있으면 옆의 JS 진입점을 node 로 직접 실행한다 (셸 없이)", () => {
    const npmDir = "C:\\Users\\me\\AppData\\Roaming\\npm";
    const r = resolveCli("codex", {
      platform: "win32",
      pathEnv: `C:\\a;${npmDir}`,
      home: "C:\\Users\\me",
      execPath: "C:\\app\\HelpMyDoc.exe",
      exists: (p: string) => p.endsWith("codex.cmd") || p.endsWith("codex.js"),
      shimScript,
    });
    expect(r.found).toBe(true);
    expect(r.command).toBe("C:\\app\\HelpMyDoc.exe");
    expect(r.prefixArgs[0]).toMatch(/node_modules[\\/]@openai[\\/]codex[\\/]bin[\\/]codex\.js$/);
    expect(r.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" }); // Electron 에서 같은 실행 파일을 node 처럼 쓴다
  });

  it("래퍼만 있고 진입점을 못 찾으면 shimOnly 로 알린다", () => {
    const r = resolveCli("codex", {
      platform: "win32",
      pathEnv: "C:\\npm",
      home: "C:\\h",
      exists: (p: string) => p.endsWith("codex.cmd"),
      shimScript,
    });
    expect(r).toMatchObject({ found: false, shimOnly: true });
  });

  it("리눅스/맥에서는 PATH 에 있으면 이름만, 없으면 found:false", () => {
    expect(
      resolveCli("codex", { platform: "linux", pathEnv: "/a", home: "/h", exists: (p: string) => p === "/a/codex" }),
    ).toMatchObject({ command: "codex", found: true });
    expect(resolveCli("codex", { platform: "linux", pathEnv: "/a", home: "/h", exists: () => false })).toMatchObject({
      found: false,
      shimOnly: false,
    });
  });

  it("resolveClaudeCommand 는 이전과 같은 문자열을 돌려준다", () => {
    expect(
      resolveClaudeCommand({ platform: "linux", pathEnv: "/a", home: "/h", exists: (p: string) => p === "/a/claude" }),
    ).toBe("claude");
  });
});

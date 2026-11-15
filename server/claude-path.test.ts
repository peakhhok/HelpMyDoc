import { describe, expect, it } from "vitest";
import { resolveClaudeCommand } from "./claude-path.mjs";

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

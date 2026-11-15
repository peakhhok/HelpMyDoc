import { describe, expect, it } from "vitest";
import { resolveClaudeCommand } from "./claude-path.mjs";

describe("resolveClaudeCommand", () => {
  it("윈도우 외에는 이름만 돌려주고 PATH 탐색은 spawn 에 맡긴다", () => {
    expect(resolveClaudeCommand({ platform: "linux", pathEnv: "/a:/b", exists: () => true })).toBe("claude");
    expect(resolveClaudeCommand({ platform: "darwin", pathEnv: "/a", exists: () => true })).toBe("claude");
  });

  it("윈도우에서는 PATH 에서 claude.exe 의 전체 경로를 찾는다", () => {
    const found = resolveClaudeCommand({
      platform: "win32",
      pathEnv: "C:\\Windows;C:\\Users\\me\\.local\\bin;C:\\other",
      exists: (p: string) => p.endsWith("claude.exe") && p.includes(".local"),
    });
    expect(found).toMatch(/\.local[\\/]bin[\\/]claude\.exe$/);
  });

  it("윈도우에서 claude.exe 가 없으면(claude.cmd 만 있는 경우 포함) 이름만 돌려줘 '사용 불가'로 처리되게 한다", () => {
    expect(resolveClaudeCommand({ platform: "win32", pathEnv: "C:\\a;C:\\b", exists: () => false })).toBe("claude");
  });

  it("PATH 가 비어 있어도 던지지 않는다", () => {
    expect(resolveClaudeCommand({ platform: "win32", pathEnv: "", exists: () => true })).toBe("claude");
  });
});

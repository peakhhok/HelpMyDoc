import { describe, expect, it } from "vitest";
import { MARK, extraPathDirs, fixPath, mergePath, parseShellPath } from "./path-fix.mjs";

describe("parseShellPath", () => {
  it("마커 사이의 PATH 만 꺼낸다 (셸 rc 파일의 잡음 무시)", () => {
    expect(parseShellPath(`welcome!\n${MARK}/usr/bin:/home/me/.local/bin${MARK}\nbye`)).toBe(
      "/usr/bin:/home/me/.local/bin",
    );
  });
  it("마커가 없거나 비어 있으면 null", () => {
    expect(parseShellPath("no markers")).toBeNull();
    expect(parseShellPath(`${MARK}${MARK}`)).toBeNull();
  });
});

describe("mergePath", () => {
  it("앞쪽 우선으로 합치고 중복·빈 항목을 제거한다", () => {
    expect(mergePath("/a:/b", "/b:/c", undefined, ":/d:")).toBe("/a:/b:/c:/d");
  });
});

describe("extraPathDirs", () => {
  it("OS 별로 흔한 설치 위치를 돌려준다", () => {
    expect(extraPathDirs("/Users/me", "darwin")).toEqual(
      expect.arrayContaining(["/opt/homebrew/bin", "/Users/me/.local/bin", "/usr/local/bin"]),
    );
    expect(extraPathDirs("/home/me", "linux")).toEqual(
      expect.arrayContaining(["/home/me/.local/bin", "/home/me/.claude/local"]),
    );
    expect(extraPathDirs("/home/me", "linux")).not.toContain("/opt/homebrew/bin");
    expect(extraPathDirs("C:\\Users\\me", "win32")).toEqual([]);
  });
});

describe("fixPath", () => {
  const home = "/home/me";

  it("윈도우에서는 PATH 를 그대로 둔다", () => {
    expect(fixPath({ platform: "win32", env: { PATH: "C:\\x" }, home: "C:\\me", exec: () => "never" })).toBe("C:\\x");
  });

  it("로그인 셸의 PATH 를 앞에 두고 현재 PATH 와 기본 위치를 합친다", () => {
    const calls: unknown[][] = [];
    const out = fixPath({
      platform: "linux",
      env: { PATH: "/usr/bin", SHELL: "/bin/zsh" },
      home,
      exec: (...args: unknown[]) => (calls.push(args), `${MARK}/home/me/bin:/usr/bin${MARK}`),
    });
    expect(out.split(":").slice(0, 3)).toEqual(["/home/me/bin", "/usr/bin", "/home/me/.local/bin"]);
    expect(calls[0][0]).toBe("/bin/zsh");
    expect(calls[0][1]).toEqual(["-ilc", expect.stringContaining(MARK)]);
  });

  it("fish 는 별도 문법으로 PATH 를 읽는다", () => {
    let script = "";
    fixPath({
      platform: "darwin",
      env: { PATH: "/usr/bin", SHELL: "/opt/homebrew/bin/fish" },
      home,
      exec: (_s: string, a: string[]) => ((script = a[1]), ""),
    });
    expect(script).toContain("string join");
  });

  it("셸 실행이 실패해도 현재 PATH + 기본 위치로 계속한다", () => {
    const out = fixPath({
      platform: "darwin",
      env: { PATH: "/usr/bin" },
      home,
      exec: () => {
        throw new Error("shell missing");
      },
    });
    expect(out).toContain("/usr/bin");
    expect(out).toContain("/opt/homebrew/bin");
    expect(out).toContain("/home/me/.local/bin");
  });

  it("SHELL 이 없으면 OS 기본 셸을 쓴다", () => {
    const shells: string[] = [];
    fixPath({ platform: "darwin", env: {}, home, exec: (s: string) => (shells.push(s), "") });
    fixPath({ platform: "linux", env: {}, home, exec: (s: string) => (shells.push(s), "") });
    expect(shells).toEqual(["/bin/zsh", "/bin/bash"]);
  });
});

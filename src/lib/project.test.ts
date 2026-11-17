import { describe, expect, it } from "vitest";
import { invalidWritePaths, isSafeWritePattern, parseWritePaths, projectFromSettings, projectName } from "./project";

describe("쓰기 허용 경로", () => {
  it("폴더 안의 상대 경로(글롭 포함)만 안전하다", () => {
    for (const ok of ["quiz/**", "STUDY_STATUS.md", "quiz/wrong_notes.md", "노트/오답 정리.md", "a/b/*.md"]) {
      expect(isSafeWritePattern(ok), ok).toBe(true);
    }
    for (const bad of [
      "../밖",
      "a/../b",
      "/etc/passwd",
      "C:/Windows",
      "c:\\x",
      "~/x",
      "a;b",
      "a)b",
      "",
      "x".repeat(200),
    ]) {
      expect(isSafeWritePattern(bad), bad).toBe(false);
    }
  });
  it("백슬래시 경로도 슬래시로 바꿔 읽는다", () => {
    expect(parseWritePaths("quiz\\**, STUDY_STATUS.md\n노트/a.md")).toEqual([
      "quiz/**",
      "STUDY_STATUS.md",
      "노트/a.md",
    ]);
    expect(parseWritePaths("  ,, ")).toEqual([]);
  });
  it("잘못된 경로를 골라낸다", () => {
    expect(invalidWritePaths("quiz/**, ../x, C:/y")).toEqual(["../x", "C:/y"]);
    expect(invalidWritePaths("")).toEqual([]);
  });
});

describe("projectFromSettings", () => {
  it("폴더가 없으면 null, 있으면 안전한 쓰기 경로만 남긴다", () => {
    expect(projectFromSettings({ projectDir: "  ", projectWrite: "quiz/**" })).toBeNull();
    expect(projectFromSettings({ projectDir: "C:\\SCS", projectWrite: "" })).toEqual({
      dir: "C:\\SCS",
      allowWrite: [],
    });
    expect(projectFromSettings({ projectDir: "C:\\SCS", projectWrite: "quiz/**, ../x" })).toEqual({
      dir: "C:\\SCS",
      allowWrite: ["quiz/**"],
    });
  });
  it("폴더 이름", () => {
    expect(projectName("C:\\Users\\peakh\\바탕 화면\\SCS")).toBe("SCS");
    expect(projectName("/home/u/scs/")).toBe("scs");
  });
});

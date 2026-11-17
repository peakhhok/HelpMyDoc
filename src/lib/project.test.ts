import { describe, expect, it } from "vitest";
import {
  invalidWritePaths,
  isSafeBranch,
  isSafeWritePattern,
  parseWritePaths,
  projectFromSettings,
  NO_PROJECT,
  projectFromValues,
  projectName,
  sanitizeProjectValues,
  valuesFromSettings,
} from "./project";

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
  const base = { projectDir: "C:\\SCS", projectWrite: "", projectGit: false, projectBranch: "" };

  it("폴더가 없으면 null, 있으면 안전한 쓰기 경로만 남긴다", () => {
    expect(projectFromSettings({ ...base, projectDir: "  ", projectWrite: "quiz/**" })).toBeNull();
    expect(projectFromSettings(base)).toEqual({ dir: "C:\\SCS", allowWrite: [], git: false, branch: "" });
    expect(projectFromSettings({ ...base, projectWrite: "quiz/**, ../x" })).toEqual({
      dir: "C:\\SCS",
      allowWrite: ["quiz/**"],
      git: false,
      branch: "",
    });
  });
  it("git 허용과 브랜치 (이상한 브랜치 이름은 비운다)", () => {
    expect(projectFromSettings({ ...base, projectGit: true, projectBranch: " main-hkwfct " })).toMatchObject({
      git: true,
      branch: "main-hkwfct",
    });
    expect(projectFromSettings({ ...base, projectGit: true, projectBranch: "a b;c" })).toMatchObject({ branch: "" });
    expect(isSafeBranch("feature/x.1")).toBe(true);
    expect(isSafeBranch("-rf")).toBe(false);
  });
  it("폴더 이름", () => {
    expect(projectName("C:\\Users\\peakh\\바탕 화면\\SCS")).toBe("SCS");
    expect(projectName("/home/u/scs/")).toBe("scs");
  });
});

describe("문서별 프로젝트 설정 값", () => {
  it("설정의 기본값에서 값을 만들고, 값에서 실행용 설정을 만든다", () => {
    const v = valuesFromSettings({
      projectDir: "C:\\A",
      projectWrite: "notes/**",
      projectGit: true,
      projectBranch: "main",
    });
    expect(v).toEqual({ dir: "C:\\A", write: "notes/**", git: true, branch: "main" });
    expect(projectFromValues(v)).toEqual({ dir: "C:\\A", allowWrite: ["notes/**"], git: true, branch: "main" });
    expect(projectFromValues(NO_PROJECT)).toBeNull();
  });
  it("저장된 값이 깨져 있으면 null(기본값 사용), 일부만 있으면 채운다", () => {
    expect(sanitizeProjectValues(undefined)).toBeNull();
    expect(sanitizeProjectValues("x")).toBeNull();
    expect(sanitizeProjectValues({ write: "x" })).toBeNull();
    expect(sanitizeProjectValues({ dir: "C:\\B" })).toEqual({ dir: "C:\\B", write: "", git: false, branch: "" });
    expect(sanitizeProjectValues({ dir: "", git: true })).toEqual({ dir: "", write: "", git: true, branch: "" }); // 이 문서는 연결 안 함
  });
});

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitError, gitStatus, gitSync, tail } from "./git.mjs";

let hasGit = true;
try {
  execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
  hasGit = false;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });

describe.skipIf(!hasGit)("git 도우미 (실제 git, 로컬 원격)", () => {
  let root = "";
  let remote = "";
  let me = "";
  let cloud = "";
  const BR = "main-hkwfct";

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "helpmydoc-git-"));
    remote = join(root, "remote.git");
    execFileSync("git", ["init", "--bare", "-b", BR, remote]);
    const clone = (name: string) => {
      const d = join(root, name);
      execFileSync("git", ["clone", remote, d], { stdio: "ignore" });
      git(d, "config", "user.name", "t");
      git(d, "config", "user.email", "t@t");
      return d;
    };
    me = clone("me");
    git(me, "checkout", "-b", BR);
    mkdirSync(join(me, "quiz"));
    writeFileSync(join(me, "quiz", "wrong_notes.md"), "# 오답\n");
    writeFileSync(join(me, "STUDY_STATUS.md"), "Q135\n");
    git(me, "add", "quiz/wrong_notes.md", "STUDY_STATUS.md");
    git(me, "commit", "-m", "init");
    git(me, "push", "-u", "origin", BR);
    cloud = clone("cloud");
    git(cloud, "checkout", BR);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("상태: 브랜치, 바뀐 파일, 앞/뒤 개수, 브랜치 일치 여부", async () => {
    const clean = await gitStatus(me, BR);
    expect(clean).toMatchObject({ ok: true, branch: BR, clean: true, ahead: 0, behind: 0, branchMatches: true });
    writeFileSync(join(me, "quiz", "wrong_notes.md"), "# 오답\nQ136\n");
    writeFileSync(join(me, "새 파일.md"), "x");
    const dirty = await gitStatus(me, BR);
    expect(dirty.clean).toBe(false);
    expect(dirty.changed.map((c: { path: string }) => c.path).sort()).toEqual(["quiz/wrong_notes.md", "새 파일.md"]);
    expect((await gitStatus(me, "other-branch")).branchMatches).toBe(false);
    git(me, "checkout", "--", "quiz/wrong_notes.md");
    rmSync(join(me, "새 파일.md"));
  });

  it("git 저장소가 아니면 안내", async () => {
    await expect(gitStatus(root, BR)).rejects.toBeInstanceOf(GitError);
    await expect(gitSync(root, BR)).rejects.toThrow(/git 저장소/);
  });

  it("잘못된 브랜치 이름은 실행 전에 거절", async () => {
    for (const bad of ["", "-rf", "a b", "a;b", "$(x)", "a..b ", "x".repeat(100)]) {
      await expect(gitSync(me, bad)).rejects.toBeInstanceOf(GitError);
    }
  });

  it("다른 브랜치에 있으면 동기화하지 않는다 (아무것도 바뀌지 않음)", async () => {
    git(me, "checkout", "-b", "scratch");
    const r = await gitSync(me, BR);
    expect(r.ok).toBe(false);
    expect(r.steps[0]).toMatchObject({ label: "브랜치 확인", ok: false });
    expect(r.steps).toHaveLength(1);
    git(me, "checkout", BR);
    git(me, "branch", "-D", "scratch");
  });

  it("동기화: 원격(클라우드 세션)의 변경을 먼저 받고 내 커밋을 올린다", async () => {
    // 클라우드가 먼저 올림
    writeFileSync(join(cloud, "STUDY_STATUS.md"), "Q135\nQ136 시작\n");
    git(cloud, "add", "STUDY_STATUS.md");
    git(cloud, "commit", "-m", "cloud");
    git(cloud, "push", "origin", BR);
    // 나는 다른 파일을 로컬 커밋 (갈라짐)
    writeFileSync(join(me, "quiz", "wrong_notes.md"), "# 오답\nQ136: B\n");
    git(me, "add", "quiz/wrong_notes.md");
    git(me, "commit", "-m", "오답 노트: Q136 추가");
    const before = await gitStatus(me, BR);
    expect(before.ahead).toBe(1);

    const r = await gitSync(me, BR);
    expect(r.steps.map((s: { label: string; ok: boolean }) => [s.label, s.ok])).toEqual([
      ["브랜치 확인", true],
      ["git pull", true],
      [`git push origin ${BR}`, true],
    ]);
    expect(r.ok).toBe(true);
    // 둘 다 반영됨
    expect(readFileSync(join(me, "STUDY_STATUS.md"), "utf8")).toContain("Q136 시작");
    git(cloud, "pull", "--no-rebase", "--no-edit");
    expect(readFileSync(join(cloud, "quiz", "wrong_notes.md"), "utf8")).toContain("Q136: B");
    expect(git(remote, "log", "--oneline", BR)).toContain("오답 노트: Q136 추가");
  });

  it("같은 줄을 서로 고쳐 충돌이 나면 병합을 취소해 원래대로 되돌리고 멈춘다 (push 하지 않음)", async () => {
    writeFileSync(join(cloud, "STUDY_STATUS.md"), "클라우드가 고친 내용\n");
    git(cloud, "add", "STUDY_STATUS.md");
    git(cloud, "commit", "-m", "cloud conflict");
    git(cloud, "push", "origin", BR);
    writeFileSync(join(me, "STUDY_STATUS.md"), "내가 고친 내용\n");
    git(me, "add", "STUDY_STATUS.md");
    git(me, "commit", "-m", "mine conflict");
    const remoteBefore = git(remote, "rev-parse", BR);

    const r = await gitSync(me, BR);
    expect(r.ok).toBe(false);
    expect(r.steps.map((s: { label: string }) => s.label)).toEqual(["브랜치 확인", "git pull", "병합 취소"]);
    expect(existsSync(join(me, ".git", "MERGE_HEAD"))).toBe(false);
    expect(readFileSync(join(me, "STUDY_STATUS.md"), "utf8")).toBe("내가 고친 내용\n");
    expect(git(remote, "rev-parse", BR)).toBe(remoteBefore); // 올라가지 않음
    expect((await gitStatus(me, BR)).clean).toBe(true);
  });
});

describe("tail", () => {
  it("마지막 줄만 남기고 주소는 가린다", () => {
    const t = tail("a\nb\nc\nremote: https://github.com/x/y.git?token=SECRET\nd", 2);
    expect(t).toBe("remote: [주소]\nd");
    expect(tail("x\n".repeat(50), 3).split("\n")).toHaveLength(3);
  });
});

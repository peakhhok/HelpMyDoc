// 프로젝트 폴더의 git 도우미. 앱 버튼("변경 보기", "동기화")이 쓰는 고정 명령만 실행한다.
//  - AI 는 이 파일을 거치지 않는다. push 는 AI 가 아니라 사용자가 버튼을 눌렀을 때만 일어난다.
//  - 셸을 거치지 않고(execFile), 요청에서 받은 값 중 명령에 들어가는 것은 검증한 브랜치 이름뿐이다.
//  - 비밀번호 입력을 기다리며 멈추지 않도록 GIT_TERMINAL_PROMPT=0 으로 실행한다. (로그인은 PC 의 git 이 이미 가진 것을 쓴다)
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/;

export class GitError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** git 을 실행한다. 실패해도 던지지 않고 { ok, code, out } 으로 돌려준다. (git 이 없으면 notFound) */
export function runGit(dir, args, timeout = 30_000) {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd: dir,
        timeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C.UTF-8" },
      },
      (err, stdout, stderr) =>
        resolve({
          ok: !err,
          code: err ? (typeof err.code === "number" ? err.code : -1) : 0,
          notFound: !!err && err.code === "ENOENT",
          out: `${stdout ?? ""}${stderr ?? ""}`.trim(),
        }),
    );
  });
}

export async function currentBranch(dir) {
  const r = await runGit(dir, ["branch", "--show-current"], 8000);
  return r.ok ? r.out.split("\n")[0].trim() : "";
}

/** 마지막 몇 줄만 화면에 보여준다. 주소(일회용 토큰이 들어 있을 수 있음)는 가린다. */
export function tail(text, lines = 8) {
  return text
    .replace(/https?:\/\/[^\s'"]+/g, "[주소]")
    .split(/\r?\n/)
    .slice(-lines)
    .join("\n")
    .slice(-800);
}

function checkBranchName(branch) {
  if (typeof branch !== "string" || !BRANCH_RE.test(branch)) {
    throw new GitError("브랜치 이름이 올바르지 않아요.");
  }
}

/**
 * 현재 상태: 브랜치, 원격보다 앞서/뒤처진 개수(마지막으로 알려진 값), 바뀐 파일.
 * branch 를 주면 현재 브랜치가 그것과 같은지도 알려 준다.
 */
export async function gitStatus(dir, branch) {
  if (!existsSync(join(dir, ".git"))) throw new GitError("이 폴더는 git 저장소가 아니에요.");
  const r = await runGit(dir, ["-c", "core.quotePath=false", "status", "--porcelain=v2", "-b"]);
  if (r.notFound) throw new GitError("git 을 찾을 수 없어요. git 을 설치해 주세요.");
  if (!r.ok) throw new GitError(`git status 실패: ${tail(r.out, 3)}`);
  let name = "";
  let upstream = "";
  let ahead = 0;
  let behind = 0;
  const changed = [];
  let changedCount = 0;
  for (const line of r.out.split("\n")) {
    if (line.startsWith("# branch.head "))
      name = line
        .slice(14)
        .trim()
        .replace(/^\(detached\)$/, "");
    else if (line.startsWith("# branch.upstream ")) upstream = line.slice(18).trim();
    else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      ahead = Number(m?.[1] ?? 0);
      behind = Number(m?.[2] ?? 0);
    } else if (line && !line.startsWith("#")) {
      changedCount++;
      if (changed.length >= 60) continue;
      if (line.startsWith("? ")) changed.push({ status: "?", path: line.slice(2) });
      else if (line.startsWith("1 ") || line.startsWith("u ")) {
        const f = line.split(" ");
        changed.push({
          status: f[1].replace(/\./g, "") || "?",
          path: f.slice(line.startsWith("u ") ? 10 : 8).join(" "),
        });
      } else if (line.startsWith("2 ")) {
        const f = line.split(" ");
        changed.push({ status: "R", path: f.slice(9).join(" ").split("\t")[0] });
      }
    }
  }
  return {
    ok: true,
    branch: name,
    upstream,
    ahead,
    behind,
    changed,
    changedCount,
    clean: changedCount === 0,
    branchMatches: branch ? name === branch : null,
  };
}

/**
 * 동기화: (1) 지정한 브랜치에 있는지 확인 (2) git pull (병합, 충돌 나면 되돌림) (3) git push origin <브랜치>.
 * 단계마다 결과를 모아 돌려주고, 한 단계라도 실패하면 거기서 멈춘다.
 */
export async function gitSync(dir, branch) {
  checkBranchName(branch);
  if (!existsSync(join(dir, ".git"))) throw new GitError("이 폴더는 git 저장소가 아니에요.");
  const steps = [];
  const step = (label, r) => {
    steps.push({ label, ok: r.ok, output: tail(r.out) });
    return r.ok;
  };

  const cur = await runGit(dir, ["branch", "--show-current"], 8000);
  if (cur.notFound) throw new GitError("git 을 찾을 수 없어요. git 을 설치해 주세요.");
  const now = cur.out.trim();
  if (now !== branch) {
    steps.push({
      label: "브랜치 확인",
      ok: false,
      output: `현재 브랜치가 "${now || "(없음)"}"이에요. "${branch}"에서만 동기화해요.`,
    });
    return { ok: false, steps };
  }
  steps.push({ label: "브랜치 확인", ok: true, output: branch });

  // 클라우드 세션 등 다른 곳에서 올린 변경을 먼저 받아온다. (병합 방식, 메시지 입력 없이)
  const pull = await runGit(dir, ["pull", "--no-rebase", "--no-edit"], 120_000);
  if (!step("git pull", pull)) {
    // 충돌로 병합이 중간에 멈췄으면 되돌려서 저장소가 어중간한 상태로 남지 않게 한다.
    if (existsSync(join(dir, ".git", "MERGE_HEAD"))) {
      const abort = await runGit(dir, ["merge", "--abort"]);
      steps.push({
        label: "병합 취소",
        ok: abort.ok,
        output: abort.ok ? "충돌이 나서 병합을 취소하고 원래대로 되돌렸어요. 직접 해결해 주세요." : tail(abort.out),
      });
    }
    return { ok: false, steps };
  }

  const push = await runGit(dir, ["push", "origin", branch], 120_000);
  step(`git push origin ${branch}`, push);
  return { ok: push.ok, steps };
}

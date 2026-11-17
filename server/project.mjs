// "프로젝트 폴더 연결": 사용자가 고른 폴더(예: 공부 자료 저장소)를 Claude Code 의 작업 폴더로 쓴다.
// 이 파일은 그 폴더가 안전하게 쓸 수 있는 것인지 확인하고, 폴더 안의 지침 파일(CLAUDE.md)을 읽는다.
//
// 안전 원칙
//  - 읽기 도구(Read/Glob/Grep)만 기본으로 준다. 쓰기는 사용자가 허용 경로를 적었을 때 그 경로에만 준다.
//  - 셸(Bash)과 웹, MCP 는 주지 않는다. 폴더 밖 파일은 권한이 없어 거부된다. (--permission-mode dontAsk)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { BRANCH_RE } from "./git.mjs";

const MAX_CLAUDE_MD = 40_000;
/** 쓰기를 허용할 경로(폴더 기준 상대 경로, 글롭 가능) 하나의 모양 */
const WRITE_PATTERN_RE = /^[A-Za-z0-9가-힣._\-/* ]{1,120}$/;

export class ProjectError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** 쓰기 허용 경로가 안전한 모양인지: 폴더 안의 상대 경로만, 위로 올라가거나 절대 경로·홈 경로는 안 된다. */
export function isSafeWritePattern(p) {
  if (typeof p !== "string") return false;
  const s = p.trim().replace(/\\/g, "/");
  if (!WRITE_PATTERN_RE.test(s)) return false;
  if (s.startsWith("/") || s.startsWith("~") || /^[A-Za-z]:/.test(s)) return false;
  if (s.split("/").some((seg) => seg === "..")) return false;
  return true;
}

/** 요청으로 받은 project 값을 검증해 { dir, allowWrite } 로 돌려준다. 문제가 있으면 ProjectError. */
export function validateProject(input) {
  if (!input || typeof input !== "object") throw new ProjectError("project 값이 올바르지 않습니다.");
  const dir = typeof input.dir === "string" ? input.dir.trim() : "";
  if (!dir || !isAbsolute(dir))
    throw new ProjectError("프로젝트 폴더는 전체 경로(예: C:\\Users\\이름\\폴더)로 적어 주세요.");
  let st;
  try {
    st = statSync(dir);
  } catch {
    throw new ProjectError("프로젝트 폴더를 찾을 수 없어요. 경로를 확인해 주세요.");
  }
  if (!st.isDirectory()) throw new ProjectError("프로젝트 경로가 폴더가 아니에요.");

  const raw = Array.isArray(input.allowWrite) ? input.allowWrite : [];
  if (raw.length > 20) throw new ProjectError("쓰기 허용 경로가 너무 많아요.");
  const allowWrite = [];
  for (const p of raw) {
    if (!isSafeWritePattern(p)) {
      throw new ProjectError(
        `쓰기 허용 경로가 올바르지 않아요: "${String(p).slice(0, 60)}" (폴더 안의 상대 경로만, 예: quiz/**)`,
      );
    }
    allowWrite.push(p.trim().replace(/\\/g, "/"));
  }
  // git: AI 에게 git 읽기와 로컬 commit 을 허용할지. branch 가 있으면 그 브랜치에서만 commit 한다.
  const git = input.git === true;
  const branch = typeof input.branch === "string" ? input.branch.trim() : "";
  if (branch && !BRANCH_RE.test(branch)) throw new ProjectError("브랜치 이름이 올바르지 않아요.");
  return { dir, allowWrite, git, branch };
}

/** 와일드카드가 없는 정확한 파일 경로만 (git add 는 파일 이름을 지정한 것만 허용하기 위해) */
export function exactFiles(allowWrite) {
  return allowWrite.filter((p) => !/[*?]/.test(p) && !p.endsWith("/"));
}

/** 폴더의 CLAUDE.md 내용 (없으면 빈 문자열, 너무 길면 앞부분만) */
export function readClaudeMd(dir) {
  try {
    const p = join(dir, "CLAUDE.md");
    if (!existsSync(p)) return "";
    return readFileSync(p, "utf8").slice(0, MAX_CLAUDE_MD);
  } catch {
    return "";
  }
}

/** 화면에서 폴더를 확인할 때 보여줄 요약 */
export function describeProject(input) {
  const dir = typeof input === "string" ? input.trim() : "";
  const { dir: ok } = validateProject({ dir });
  let entries = 0;
  try {
    entries = readdirSync(ok).filter((n) => !n.startsWith(".")).length;
  } catch {
    /* 읽을 수 없는 폴더 */
  }
  const name = ok.split(/[\\/]/).filter(Boolean).pop() ?? ok;
  return {
    ok: true,
    name,
    entries,
    claudeMd: existsSync(join(ok, "CLAUDE.md")),
    git: existsSync(join(ok, ".git")),
  };
}

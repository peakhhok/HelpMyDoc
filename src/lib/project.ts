// 프로젝트 폴더 연결(설정)과 관련된 값 처리. 서버(server/project.mjs)와 같은 규칙으로 쓰기 허용 경로를 걸러서,
// 잘못된 값은 저장하기 전에 화면에서 알려 준다. (서버도 다시 검증한다)
import type { Settings } from "./settings";

const WRITE_PATTERN_RE = /^[A-Za-z0-9가-힣._\-/* ]{1,120}$/;

/** 폴더 안의 상대 경로만 허용한다: 위로 올라가기(..), 절대 경로, 드라이브 문자, 홈(~) 경로는 안 된다. */
export function isSafeWritePattern(p: string): boolean {
  const s = p.trim().replace(/\\/g, "/");
  if (!WRITE_PATTERN_RE.test(s)) return false;
  if (s.startsWith("/") || s.startsWith("~") || /^[A-Za-z]:/.test(s)) return false;
  return !s.split("/").some((seg) => seg === "..");
}

/** "quiz/**, STUDY_STATUS.md" 같은 입력을 경로 목록으로 (쉼표·줄바꿈으로 구분) */
export function parseWritePaths(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((s) => s.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

/** 설정에 적힌 쓰기 허용 경로 중 잘못된 것 */
export function invalidWritePaths(input: string): string[] {
  return parseWritePaths(input).filter((p) => !isSafeWritePattern(p));
}

const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/;
export const isSafeBranch = (b: string) => BRANCH_RE.test(b.trim());

export interface ProjectConfig {
  dir: string;
  allowWrite: string[];
  /** AI 에게 git 읽기와 (지정한 파일의) 로컬 commit 을 허용 */
  git: boolean;
  branch: string;
}

/** 질문에 쓸 프로젝트 설정 (폴더를 연결하지 않았으면 null). 잘못된 쓰기 경로는 버린다. */
export function projectFromValues(v: ProjectValues): ProjectConfig | null {
  const dir = v.dir.trim();
  if (!dir) return null;
  const branch = isSafeBranch(v.branch) ? v.branch.trim() : "";
  return { dir, allowWrite: parseWritePaths(v.write).filter(isSafeWritePattern), git: v.git, branch };
}

export function projectFromSettings(
  s: Pick<Settings, "projectDir" | "projectWrite" | "projectGit" | "projectBranch">,
): ProjectConfig | null {
  return projectFromValues(valuesFromSettings(s));
}

/** 화면에서 편집하는 프로젝트 설정 값 (쓰기 경로는 입력한 그대로의 글). 문서마다 따로 저장할 수 있다. */
export interface ProjectValues {
  dir: string;
  write: string;
  git: boolean;
  branch: string;
}

export const NO_PROJECT: ProjectValues = { dir: "", write: "", git: false, branch: "" };

/** 설정에 저장된 "기본값" (문서별 설정이 없는 문서에 쓴다) */
export function valuesFromSettings(
  s: Pick<Settings, "projectDir" | "projectWrite" | "projectGit" | "projectBranch">,
): ProjectValues {
  return { dir: s.projectDir, write: s.projectWrite, git: s.projectGit, branch: s.projectBranch };
}

/** 저장소에서 읽은 문서별 설정이 깨져 있어도 안전하게 걸러낸다. (없거나 이상하면 null = 기본값 사용) */
export function sanitizeProjectValues(raw: unknown): ProjectValues | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.dir !== "string") return null;
  return {
    dir: o.dir,
    write: typeof o.write === "string" ? o.write : "",
    git: o.git === true,
    branch: typeof o.branch === "string" ? o.branch : "",
  };
}

/** 채팅창 머리말에 보여줄 폴더 이름 (경로의 마지막 부분) */
export function projectName(dir: string): string {
  return dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
}

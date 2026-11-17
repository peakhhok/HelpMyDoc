import { useState } from "react";
import { fetchProjectInfo, type ProjectInfo } from "../lib/bridgeClient";
import { invalidWritePaths, isSafeBranch } from "../lib/project";
import type { Settings } from "../lib/settings";

interface Props {
  draft: Settings;
  set: (patch: Partial<Settings>) => void;
}

/** 설정 > Claude Code: 프로젝트 폴더 연결 (공부 자료 저장소 같은 내 폴더를 AI가 읽게 한다) */
export function ProjectSettings({ draft, set }: Props) {
  const [info, setInfo] = useState<ProjectInfo | "checking" | null>(null);
  const bad = invalidWritePaths(draft.projectWrite);

  const check = async () => {
    if (!draft.projectDir.trim()) return setInfo(null);
    setInfo("checking");
    setInfo(await fetchProjectInfo(draft.projectDir.trim()));
  };

  return (
    <>
      <label>
        프로젝트 폴더 (선택)
        <input
          value={draft.projectDir}
          placeholder="예: C:\Users\이름\바탕 화면\자료"
          spellCheck={false}
          onChange={(e) => {
            set({ projectDir: e.target.value });
            setInfo(null);
          }}
          onBlur={() => draft.projectDir.trim() && info === null && void check()}
        />
      </label>
      <div className="project-check">
        <button type="button" className="ghost small" onClick={check} disabled={!draft.projectDir.trim()}>
          폴더 확인
        </button>
        {info === "checking" && <span className="muted">확인 중…</span>}
        {info && info !== "checking" && info.ok && (
          <span className="ok">
            ✔ {info.name} · 항목 {info.entries}개 · {info.claudeMd ? "CLAUDE.md 있음" : "CLAUDE.md 없음"}
            {info.git ? " · git 저장소" : ""}
          </span>
        )}
        {info && info !== "checking" && !info.ok && <span className="error">{info.error}</span>}
      </div>
      <p className="hint">
        이 폴더를 열어서 안의 파일을 AI가 직접 읽게 합니다. 폴더의 <b>CLAUDE.md</b>가 있으면 그 지침을 따릅니다. AI는
        GitHub가 아니라 <b>내 PC의 이 폴더</b>만 봅니다. 파일을 찾아 읽느라 답변이 느려지고 사용량이 더 들 수 있어요.
        비우면 연결하지 않습니다. (Claude Code 연결 방식에서만 동작)
      </p>

      <label>
        쓰기를 허용할 경로 (쉼표로 구분, 비우면 읽기 전용)
        <input
          value={draft.projectWrite}
          placeholder="예: quiz/**, STUDY_STATUS.md"
          spellCheck={false}
          disabled={!draft.projectDir.trim()}
          onChange={(e) => set({ projectWrite: e.target.value })}
        />
      </label>
      {bad.length > 0 && (
        <p className="error">이 경로는 쓸 수 없어요: {bad.join(", ")} — 폴더 안의 상대 경로만 됩니다 (예: quiz/**).</p>
      )}
      <p className="hint warn">
        여기에 적은 경로에만 AI가 파일을 만들거나 고칠 수 있어요. 그 밖의 파일과 폴더 밖은 쓸 수 없고, 명령 실행도 막혀
        있습니다. 쓴 내용은 내 PC의 파일에만 반영되며 GitHub에는 자동으로 올라가지 않아요. (커밋·푸시는 직접)
      </p>

      <label className="check">
        <input
          type="checkbox"
          checked={draft.projectGit}
          disabled={!draft.projectDir.trim()}
          onChange={(e) => set({ projectGit: e.target.checked })}
        />
        AI가 git을 읽고 로컬 commit까지 하게 허용 (push는 안 돼요)
      </label>
      <label>
        git 브랜치 (commit과 동기화를 이 브랜치에서만)
        <input
          value={draft.projectBranch}
          placeholder="예: main-hkwfct"
          spellCheck={false}
          disabled={!draft.projectDir.trim()}
          onChange={(e) => set({ projectBranch: e.target.value })}
        />
      </label>
      {draft.projectBranch.trim() && !isSafeBranch(draft.projectBranch) && (
        <p className="error">브랜치 이름이 올바르지 않아요 (영문·숫자·. _ - / 만).</p>
      )}
      <p className="hint">
        허용하면 AI가 <code>git status / diff / log / branch --show-current</code>를 쓸 수 있고,{" "}
        <b>쓰기를 허용한 파일 중 파일 이름을 정확히 적은 것</b>(예: <code>quiz/wrong_notes.md</code>)만{" "}
        <code>git add</code>와 <code>git commit -m "…" -- 파일</code>로 커밋할 수 있어요. 현재 브랜치가 위 브랜치가
        아니면 commit은 막힙니다.
        <code>git add .</code>, push, pull, reset, checkout 등은 모두 막혀 있어요. GitHub로 올리는 것은 채팅 창 위의{" "}
        <b>⬆ 동기화</b> 버튼(받아오기 → <code>git push origin 브랜치</code>)으로 직접 하세요. 브랜치를 적어야 그 버튼이
        나타납니다.
      </p>
    </>
  );
}

import { useState } from "react";
import { createClaudeMdTemplate, fetchProjectInfo, type ProjectInfo } from "../lib/bridgeClient";
import { NO_PROJECT, invalidWritePaths, isSafeBranch, type ProjectValues } from "../lib/project";

interface Props {
  /** 이 문서에 지금 적용되는 값 */
  values: ProjectValues;
  /** 이 문서만의 설정인가 (false 면 설정의 기본값을 쓰는 중) */
  isCustom: boolean;
  fileName: string;
  /** 저장. asDefault 면 새 문서의 기본값으로도 저장한다 */
  onSave: (values: ProjectValues, asDefault: boolean) => void;
  /** 이 문서만의 설정을 지우고 기본값으로 돌아간다 */
  onUseDefault: () => void;
  onClose: () => void;
}

/**
 * 이 문서에 연결할 프로젝트 폴더(내 PC의 폴더)와 AI가 쓸 수 있는 것을 정한다. 문서마다 따로 기억한다.
 * 예: 과목마다 다른 공부 폴더, 책마다 다른 메모 폴더.
 */
export function ProjectDialog({ values, isCustom, fileName, onSave, onUseDefault, onClose }: Props) {
  const [v, setV] = useState<ProjectValues>(values);
  const [asDefault, setAsDefault] = useState(false);
  const [info, setInfo] = useState<ProjectInfo | "checking" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const set = (patch: Partial<ProjectValues>) => setV((cur) => ({ ...cur, ...patch }));
  const bad = invalidWritePaths(v.write);
  const hasDir = !!v.dir.trim();

  const check = async () => {
    if (!hasDir) return setInfo(null);
    setInfo("checking");
    setInfo(await fetchProjectInfo(v.dir.trim()));
  };

  const makeTemplate = async (template: "study" | "reference") => {
    setNote(null);
    const r = await createClaudeMdTemplate(v.dir.trim(), template);
    if (!r.ok) return setNote(r.error);
    setNote("CLAUDE.md 예시를 만들었어요. 폴더에서 열어 내 방식에 맞게 고쳐 주세요.");
    await check();
  };

  const valid = bad.length === 0 && (!v.branch.trim() || isSafeBranch(v.branch));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="프로젝트 폴더 연결">
        <h2>📁 프로젝트 폴더 연결</h2>
        <p className="hint">
          <b>{fileName || "이 문서"}</b>에 내 PC의 폴더를 연결하면, AI가 그 폴더의 파일을 직접 읽고(폴더의{" "}
          <b>CLAUDE.md</b> 지침도 따라요) 질문에 답합니다. 문서마다 따로 기억해요.{" "}
          {isCustom ? "지금은 이 문서만의 설정이에요." : "지금은 기본 설정을 쓰는 중이에요."} (Claude Code 연결
          방식에서만 동작)
        </p>

        <label>
          폴더 경로
          <input
            value={v.dir}
            placeholder="예: C:\Users\이름\Documents\내자료"
            spellCheck={false}
            onChange={(e) => {
              set({ dir: e.target.value });
              setInfo(null);
              setNote(null);
            }}
            onBlur={() => hasDir && info === null && void check()}
          />
        </label>
        <div className="project-check">
          <button type="button" className="ghost small" onClick={check} disabled={!hasDir}>
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
        {info && info !== "checking" && info.ok && !info.claudeMd && (
          <div className="project-check">
            <span className="muted">CLAUDE.md가 없어요. AI에게 줄 지침의 예시를 만들까요?</span>
            <button type="button" className="ghost small" onClick={() => makeTemplate("study")}>
              공부용 예시 만들기
            </button>
            <button type="button" className="ghost small" onClick={() => makeTemplate("reference")}>
              읽기 전용 자료용
            </button>
          </div>
        )}
        {note && <p className="hint">{note}</p>}
        <p className="hint">
          AI는 GitHub가 아니라 <b>내 PC의 이 폴더</b>만 봅니다. 파일을 찾아 읽느라 답변이 느려지고 사용량이 더 들 수
          있어요. 비우면 연결하지 않습니다.
        </p>

        <label>
          AI가 쓸 수 있는 파일 (쉼표로 구분, 비우면 읽기 전용)
          <input
            value={v.write}
            placeholder="예: notes/memo.md, STATUS.md"
            spellCheck={false}
            disabled={!hasDir}
            onChange={(e) => set({ write: e.target.value })}
          />
        </label>
        {bad.length > 0 && (
          <p className="error">
            이 경로는 쓸 수 없어요: {bad.join(", ")} — 폴더 안의 상대 경로만 됩니다 (예: notes/**).
          </p>
        )}
        <p className="hint warn">
          여기에 적은 경로에만 AI가 파일을 만들거나 고칠 수 있어요. 그 밖의 파일과 폴더 밖은 쓸 수 없고, 명령 실행도
          막혀 있습니다. 쓴 내용은 내 PC의 파일에만 반영돼요.
        </p>

        <label className="check">
          <input type="checkbox" checked={v.git} disabled={!hasDir} onChange={(e) => set({ git: e.target.checked })} />
          AI가 git을 읽고 로컬 commit까지 하게 허용 (push는 안 돼요)
        </label>
        <label>
          git 브랜치 (commit과 동기화를 이 브랜치에서만)
          <input
            value={v.branch}
            placeholder="예: main"
            spellCheck={false}
            disabled={!hasDir}
            onChange={(e) => set({ branch: e.target.value })}
          />
        </label>
        {v.branch.trim() && !isSafeBranch(v.branch) && (
          <p className="error">브랜치 이름이 올바르지 않아요 (영문·숫자·. _ - / 만).</p>
        )}
        <p className="hint">
          허용하면 AI가 <code>git status / diff / log</code>를 쓸 수 있고,{" "}
          <b>쓰기 허용한 파일 중 파일 이름을 정확히 적은 것</b>만 <code>git add</code>와{" "}
          <code>git commit -m "…" -- 파일</code>로 커밋할 수 있어요. 현재 브랜치가 위 브랜치가 아니면 commit은 막혀요.
          push·pull·reset·checkout 등은 모두 막혀 있고, GitHub로 올리는 것은 채팅 위 <b>⬆ 동기화</b> 버튼으로 직접 해요.
          브랜치를 적어야 그 버튼이 나타납니다.
        </p>

        <label className="check">
          <input type="checkbox" checked={asDefault} onChange={(e) => setAsDefault(e.target.checked)} />이 설정을 새
          문서의 기본값으로도 저장
        </label>

        <div className="modal-actions">
          {isCustom && (
            <button className="ghost" onClick={onUseDefault} title="이 문서만의 설정을 지우고 기본 설정을 씁니다">
              기본값으로 되돌리기
            </button>
          )}
          {hasDir && (
            <button
              className="ghost"
              onClick={() => onSave({ ...NO_PROJECT }, asDefault)}
              title="이 문서에서는 폴더를 연결하지 않아요"
            >
              연결 끊기
            </button>
          )}
          <span className="spacer" />
          <button className="primary" disabled={!valid} onClick={() => onSave(v, asDefault)}>
            저장
          </button>
          <button onClick={onClose}>취소</button>
        </div>
      </div>
    </div>
  );
}

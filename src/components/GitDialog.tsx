import { useCallback, useEffect, useState } from "react";
import { gitAction, type GitStatusInfo, type GitSyncResult } from "../lib/bridgeClient";

interface Props {
  dir: string;
  branch: string;
  onClose: () => void;
}

/**
 * 프로젝트 폴더의 git 상태를 보고, 사용자가 직접 "동기화"(git pull → git push origin <브랜치>)를 누르는 창.
 * AI 는 push 하지 않는다. 올리는 것은 항상 여기서 사용자가 누른 버튼으로만 일어난다.
 */
export function GitDialog({ dir, branch, onClose }: Props) {
  const [status, setStatus] = useState<GitStatusInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GitSyncResult | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const r = await gitAction("status", dir, branch);
    if (r.ok) setStatus(r.data as GitStatusInfo);
    else setError(r.error);
  }, [dir, branch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sync = async () => {
    if (
      !window.confirm(
        `먼저 git pull(받아오기)을 하고, 이어서 "git push origin ${branch}"로 GitHub에 올려요.\n계속할까요?`,
      )
    )
      return;
    setBusy(true);
    setResult(null);
    setError(null);
    const r = await gitAction("sync", dir, branch);
    if (r.ok) setResult(r.data as GitSyncResult);
    else setError(r.error);
    setBusy(false);
    void refresh();
  };

  const wrongBranch = status && status.branchMatches === false;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal wide" role="dialog" aria-label="GitHub 동기화">
        <h2>⬆ GitHub 동기화</h2>
        <p className="hint">
          내 PC의 <b>{dir}</b> 폴더의 변경을 GitHub로 올리는 곳이에요. AI는 올리지 않고, 여기서 직접 누를 때만
          올라갑니다. 순서: 받아오기(<code>git pull</code>) → 올리기(<code>git push origin {branch}</code>)
        </p>

        {error && <div className="error">{error}</div>}
        {!status && !error && <p className="muted">상태를 확인하는 중…</p>}

        {status && (
          <div className="scan-facts">
            <div>
              현재 브랜치 <b>{status.branch || "(없음)"}</b>
              {status.upstream ? ` → ${status.upstream}` : ""}
            </div>
            <div>
              올릴 커밋 <b>{status.ahead}</b>개 · 마지막으로 확인한 원격보다 뒤처진 커밋 <b>{status.behind}</b>개
            </div>
            <div>
              {status.clean
                ? "커밋하지 않은 변경이 없어요."
                : `커밋하지 않은 변경 ${status.changedCount}개 (올라가지 않아요)`}
            </div>
            {status.changed.length > 0 && (
              <ul className="git-changes">
                {status.changed.slice(0, 12).map((c) => (
                  <li key={c.path}>
                    <code>{c.status}</code> {c.path}
                  </li>
                ))}
                {status.changedCount > 12 && <li className="muted">… 외 {status.changedCount - 12}개</li>}
              </ul>
            )}
            {wrongBranch && (
              <div className="warn">
                현재 브랜치가 "{status.branch}"이라 "{branch}"에서만 동기화할 수 있어요. 브랜치는 직접 바꿔 주세요.
              </div>
            )}
          </div>
        )}

        {result && (
          <div className="scan-result">
            <strong>{result.ok ? "✔ 완료했어요" : "✖ 중간에 멈췄어요"}</strong>
            <ul className="git-steps">
              {result.steps.map((s, i) => (
                <li key={i} className={s.ok ? "" : "bad"}>
                  {s.ok ? "✔" : "✖"} {s.label}
                  {s.output && <pre>{s.output}</pre>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="modal-actions">
          <button className="ghost" onClick={() => void refresh()} disabled={busy}>
            상태 새로고침
          </button>
          <span className="spacer" />
          <button className="primary" onClick={sync} disabled={busy || !status || wrongBranch === true}>
            {busy ? "진행 중…" : "받아오고(pull) 올리기(push)"}
          </button>
          <button onClick={onClose} disabled={busy}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

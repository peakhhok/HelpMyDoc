import { useEffect } from "react";
import { formatTokens } from "../lib/usage";
import type { ScanData, ScanEstimate, ScanProgress } from "../lib/scan";

interface Props {
  fileName: string;
  numPages: number;
  /** 지금 스캔에 쓸 AI 이름 */
  providerName: string;
  /** 그 AI 를 쓸 수 없는 이유 (사용 가능하면 null) */
  unavailable: string | null;
  scan: ScanData | null;
  estimate: ScanEstimate | null;
  analyzing: { done: number; total: number } | null;
  remaining: number;
  running: boolean;
  progress: ScanProgress | null;
  error: string | null;
  useOverview: boolean;
  onToggleUseOverview: (v: boolean) => void;
  /** 설정에 저장되는가 (기록 저장이 꺼져 있으면 닫을 때 사라짐) */
  persist: boolean;
  onAnalyze: () => void;
  onStart: () => void;
  onCancel: () => void;
  onClear: () => void;
  onClose: () => void;
}

const range = (c: { from: number; to: number }) => (c.from === c.to ? `p.${c.from}` : `p.${c.from}–${c.to}`);

export function ScanDialog(p: Props) {
  const { estimate, scan, running } = p;
  useEffect(() => {
    p.onAnalyze();
    // 대화상자를 열 때 한 번만 쪽별 글자 수를 센다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = scan?.chunks.length ?? 0;
  const total = estimate?.chunks ?? 0;
  const complete = estimate !== null && total > 0 && p.remaining === 0;
  const pct = p.progress && p.progress.total ? Math.round((p.progress.done / p.progress.total) * 100) : 0;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal wide" role="dialog" aria-label="문서 스캔">
        <h2>🔍 문서 스캔</h2>
        <p className="hint">
          {p.providerName}가 <b>{p.fileName || "문서"}</b>를 구간별로 한 번 읽고, <b>쪽마다 한 줄 요약과 핵심 용어</b>를
          적어 이 PC에 저장해 둬요. 질문할 때는 지금 보는 쪽과 <b>내용이 비슷한 다른 쪽</b>(예: 308쪽을 볼 때 100쪽의
          같은 내용)을 찾아 함께 보내서, AI가 앞에서 나온 내용과 연결해 설명해요.
        </p>
        <p className="hint">
          스캔하지 않아도 비슷한 쪽 찾기는 (이 PC 안에서, 사용량 없이) 동작해요. 스캔하면 표현이 달라도 같은 내용을
          찾고, 찾은 쪽의 한 줄 요약도 함께 보내요.
        </p>

        {p.analyzing && (
          <p className="muted">
            문서 분석 중… {p.analyzing.done}/{p.analyzing.total}쪽
          </p>
        )}

        {estimate && (
          <div className="scan-facts">
            <div>
              <b>{estimate.chunks}</b>번 요청으로 나눠 읽어요
            </div>
            <div>
              읽을 글자 약 <b>{Math.round(estimate.chars / 1000).toLocaleString()}</b>천 자 · 입력 약{" "}
              <b>{formatTokens(estimate.approxTokens)}</b> 토큰
            </div>
            {estimate.emptyPages.length > 0 && (
              <div className="warn">
                글자가 없는 쪽 {estimate.emptyPages.length}개는 읽을 수 없어요 (스캔된 그림 쪽).{" "}
                {estimate.emptyPages.length > 5
                  ? `p.${estimate.emptyPages.slice(0, 5).join(", ")} 외`
                  : `p.${estimate.emptyPages.join(", ")}`}
              </div>
            )}
            {estimate.chunks === 0 && <div className="warn">읽을 수 있는 글자가 없어서 스캔할 수 없어요.</div>}
          </div>
        )}

        <p className="hint warn">
          {p.providerName}의 사용량(구독 한도 또는 API 비용)을 쓰고, 문서가 길면 시간이 꽤 걸려요. 중간에 멈췄다가
          이어서 할 수 있어요.
        </p>

        {(running || p.progress) && total > 0 && (
          <div className="scan-progress">
            <progress max={100} value={running ? pct : complete ? 100 : pct} />
            <span className="muted">
              {running && p.progress?.current
                ? `${range(p.progress.current)} 읽는 중… (${p.progress.done}/${p.progress.total})`
                : complete
                  ? "완료"
                  : `${done}/${total} 구간`}
            </span>
          </div>
        )}
        {p.error && <div className="error">{p.error}</div>}
        {p.unavailable && !running && <div className="error">{p.unavailable}</div>}

        {scan && scan.chunks.length > 0 && (
          <div className="scan-result">
            <strong>
              스캔 결과 ({done}
              {total ? `/${total}` : ""}구간)
            </strong>
            <div className="scan-chunks">
              {scan.chunks.map((c) => (
                <details key={`${c.from}-${c.to}`}>
                  <summary>
                    <span className="muted">{range(c)}</span> {c.title}
                  </summary>
                  <div className="scan-summary">{c.summary}</div>
                </details>
              ))}
            </div>
          </div>
        )}

        <label className="check">
          <input type="checkbox" checked={p.useOverview} onChange={(e) => p.onToggleUseOverview(e.target.checked)} />
          질문할 때 비슷한 쪽·문서 목차·내 메모를 함께 보내기
        </label>
        {!p.persist && <p className="hint warn">기록 저장이 꺼져 있어서 스캔 결과는 창을 닫으면 사라져요.</p>}

        <div className="modal-actions">
          {scan && scan.chunks.length > 0 && !running && (
            <button
              className="ghost"
              onClick={() => window.confirm("저장된 스캔 결과를 지울까요? (메모와 형광펜은 그대로예요)") && p.onClear()}
            >
              결과 지우기
            </button>
          )}
          <span className="spacer" />
          {running ? (
            <button className="primary" onClick={p.onCancel}>
              중지
            </button>
          ) : (
            <button className="primary" onClick={p.onStart} disabled={!estimate || estimate.chunks === 0 || complete}>
              {complete ? "스캔 완료" : done > 0 ? `이어서 스캔 (${p.remaining}구간 남음)` : "스캔 시작"}
            </button>
          )}
          <button onClick={p.onClose}>{running ? "백그라운드로 두기" : "닫기"}</button>
        </div>
      </div>
    </div>
  );
}

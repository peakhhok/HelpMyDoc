import { useEffect, useState } from "react";
import { HL_CSS, exportMarkdown, type Highlight } from "../lib/annotations";

interface Props {
  fileName: string;
  numPages: number;
  currentPage: number;
  notes: Record<number, string>;
  highlights: Highlight[];
  /** 이 PC에 저장되는가 (설정에서 기록 저장을 껐으면 닫을 때 사라진다) */
  persist: boolean;
  onChangeNote: (page: number, text: string) => void;
  onChangeHighlight: (id: string, patch: Partial<Pick<Highlight, "note">>) => void;
  onRemoveHighlight: (id: string) => void;
  onGoToPage: (page: number) => void;
}

const snippet = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

/** 이 문서의 메모: 지금 보는 쪽의 메모 + 형광펜/메모 모아보기 */
export function NotesPanel({
  fileName,
  numPages,
  currentPage,
  notes,
  highlights,
  persist,
  onChangeNote,
  onChangeHighlight,
  onRemoveHighlight,
  onGoToPage,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const pageNotes = Object.keys(notes)
    .map(Number)
    .filter((p) => notes[p]?.trim());
  const pages = [...new Set([...pageNotes, ...highlights.map((h) => h.page)])].sort((a, b) => a - b);
  const empty = pages.length === 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportMarkdown(fileName, notes, highlights));
      setCopied(true);
    } catch {
      window.alert("복사하지 못했어요. 다운로드를 이용해 주세요.");
    }
  };
  const download = () => {
    const blob = new Blob([exportMarkdown(fileName, notes, highlights)], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileName.replace(/\.pdf$/i, "") || "notes"}-메모.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <aside className="notes">
      <div className="notes-body">
        <label className="page-note">
          <span>
            <b>{currentPage}쪽</b> 메모
          </span>
          <textarea
            rows={5}
            value={notes[currentPage] ?? ""}
            placeholder={`${currentPage}쪽에 대한 메모를 적어 두세요. 자동으로 저장돼요.`}
            onChange={(e) => onChangeNote(currentPage, e.target.value)}
          />
        </label>
        {!persist && (
          <p className="hint warn">설정에서 기록 저장이 꺼져 있어서, 이 메모와 형광펜은 창을 닫으면 사라져요.</p>
        )}

        <div className="notes-list-head">
          <strong>메모·형광펜 모아보기</strong>
          <span className="spacer" />
          <button className="ghost small" onClick={copy} disabled={empty}>
            {copied ? "복사됨" : "Markdown 복사"}
          </button>
          <button className="ghost small" onClick={download} disabled={empty}>
            내려받기
          </button>
        </div>

        {empty ? (
          <p className="muted small-text">
            글자를 드래그하면 색을 고를 수 있어요. 칠한 곳을 누르면 그 부분에 메모를 달 수 있고, 여기에 모아서 보여요.
          </p>
        ) : (
          pages.map((p) => (
            <section key={p} className={`notes-page${p === currentPage ? " current" : ""}`}>
              <button className="pagelink" onClick={() => onGoToPage(p)} title={`${p}쪽으로 이동`}>
                p.{p}
                {numPages ? ` / ${numPages}` : ""}
              </button>
              {notes[p]?.trim() && <div className="page-note-text">{snippet(notes[p].trim(), 400)}</div>}
              {highlights
                .filter((h) => h.page === p)
                .sort((a, b) => a.createdAt - b.createdAt)
                .map((h) => (
                  <div key={h.id} className="hl-item">
                    <span className="dot-color" style={{ background: HL_CSS[h.color] }} />
                    <div className="hl-item-main">
                      <button className="hl-text" onClick={() => onGoToPage(h.page)} title="이 쪽으로 이동">
                        {snippet(h.text, 140) || "(글자 없음)"}
                      </button>
                      {editing === h.id ? (
                        <textarea
                          rows={2}
                          autoFocus
                          value={h.note ?? ""}
                          placeholder="이 부분에 메모"
                          onChange={(e) => onChangeHighlight(h.id, { note: e.target.value })}
                          onBlur={() => setEditing(null)}
                        />
                      ) : h.note ? (
                        <div className="hl-note" onClick={() => setEditing(h.id)} title="눌러서 고치기">
                          📝 {h.note}
                        </div>
                      ) : (
                        <button className="ghost small" onClick={() => setEditing(h.id)}>
                          메모 달기
                        </button>
                      )}
                    </div>
                    <button
                      className="ghost small"
                      aria-label="형광펜 지우기"
                      onClick={() => onRemoveHighlight(h.id)}
                      title="지우기"
                    >
                      ✕
                    </button>
                  </div>
                ))}
            </section>
          ))
        )}
      </div>
    </aside>
  );
}

import { useEffect, useState } from "react";
import { clearAllDocs, deleteDoc, listDocs, type DocRecord } from "../lib/docStore";

/** 이 PC에 저장된 문서별 기록 목록. 삭제는 "저장" 버튼과 상관없이 바로 적용된다. */
export function HistoryManager() {
  const [docs, setDocs] = useState<DocRecord[] | null>(null);
  const refresh = () => listDocs().then(setDocs);

  useEffect(() => {
    refresh();
  }, []);

  if (!docs) return null;
  return (
    <div>
      <div className="history-head">
        <strong>저장된 문서 기록</strong>
        {docs.length > 0 && (
          <button
            type="button"
            className="ghost small"
            onClick={async () => {
              if (
                window.confirm("저장된 모든 문서의 대화, 메모, 형광펜, 스캔 결과, 마지막 페이지 기록을 삭제할까요?")
              ) {
                await clearAllDocs();
                refresh();
              }
            }}
          >
            모두 삭제
          </button>
        )}
      </div>
      {docs.length === 0 ? (
        <p className="hint">아직 저장된 기록이 없습니다.</p>
      ) : (
        <div className="history-list">
          {docs.map((d) => (
            <div key={d.id} className="history-item">
              <span className="name" title={d.name}>
                {d.name}
              </span>
              <span className="meta">
                질문 {Math.ceil(d.messages.length / 2)}개 · {d.lastPage}/{d.numPages}쪽
                {(d.highlights?.length ?? 0) + Object.keys(d.notes ?? {}).length > 0 &&
                  ` · 메모·형광펜 ${(d.highlights?.length ?? 0) + Object.keys(d.notes ?? {}).length}개`}
                {d.scan?.chunks.length ? " · 스캔됨" : ""} · {new Date(d.updatedAt).toLocaleDateString()}
              </span>
              <button
                type="button"
                className="ghost small"
                onClick={async () => {
                  await deleteDoc(d.id);
                  refresh();
                }}
                aria-label={`${d.name} 기록 삭제`}
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfViewer, type PdfViewerHandle } from "./components/PdfViewer";
import { ChatPanel } from "./components/ChatPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { fetchBridgeStatus, type BridgeStatus } from "./lib/bridgeClient";
import { sha256Hex } from "./lib/docId";
import { loadDoc, updateDoc } from "./lib/docStore";
import type { UiMessage } from "./lib/history";
import { openPdf } from "./lib/pdf";
import { loadSettings, saveSettings, type Settings } from "./lib/settings";

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

export default function App() {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [fileName, setFileName] = useState("");
  /** 문서 지문(저장의 키)과, 저장돼 있던 대화·마지막 페이지 */
  const [docId, setDocId] = useState("");
  const [restored, setRestored] = useState<{ messages: UiMessage[]; lastPage: number }>({ messages: [], lastPage: 1 });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(1.25);
  const [selection, setSelection] = useState("");
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [chatWidth, setChatWidth] = useState(440);
  const [dragOver, setDragOver] = useState(false);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  // 드래그&드롭 핸들러는 처음 렌더의 openFile 을 잡고 있으므로 최신 설정은 ref 로 읽는다.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const hasRecord = useRef(false);
  const viewerRef = useRef<PdfViewerHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refreshBridge = useCallback(() => {
    setBridge(null);
    fetchBridgeStatus().then(setBridge);
  }, []);

  useEffect(() => {
    fetchBridgeStatus().then(setBridge);
  }, []);

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setLoadError("PDF 파일만 열 수 있습니다.");
      return;
    }
    try {
      setLoadError(null);
      const buffer = await file.arrayBuffer();
      // 이름이 아니라 파일 내용의 해시로 같은 문서인지 알아본다.
      // (pdf.js 는 버퍼를 워커로 넘겨 쓸 수 없게 만들 수 있으므로 해시를 먼저 계산한다)
      const hash = await sha256Hex(buffer);
      const next = await openPdf(buffer);
      const id = hash ?? next.fingerprints[0] ?? "";
      const record = settingsRef.current.saveHistory && id ? await loadDoc(id) : undefined;
      const lastPage = Math.min(Math.max(1, record?.lastPage ?? 1), next.numPages);
      hasRecord.current = !!record;
      docRef.current?.loadingTask.destroy();
      docRef.current = next;
      // 한 번에 반영해야 채팅창이 저장된 대화로 시작하고 뷰어가 저장된 페이지로 열린다.
      setDoc(next);
      setFileName(file.name);
      setDocId(id);
      setRestored({ messages: record?.messages ?? [], lastPage });
      setPage(lastPage);
      setPageInput(String(lastPage));
      setSelection("");
    } catch (e) {
      setLoadError(`PDF를 열지 못했습니다: ${(e as Error).message}`);
    }
  };

  const onPageChange = useCallback((p: number) => {
    setPage(p);
    setPageInput(String(p));
  }, []);

  // 마지막으로 본 페이지를 저장한다. (스크롤 중에는 잦은 쓰기를 피하려고 잠시 기다린다)
  useEffect(() => {
    if (!doc || !docId || !settings.saveHistory) return;
    if (page === 1 && !hasRecord.current) return; // 기록 없는 문서를 열기만 한 경우는 남기지 않는다
    const t = setTimeout(() => {
      hasRecord.current = true;
      updateDoc(docId, { name: fileName, numPages: doc.numPages }, { lastPage: page });
    }, 600);
    return () => clearTimeout(t);
  }, [page, doc, docId, fileName, settings.saveHistory]);

  // 창 어디에 놓아도 열리도록 드래그&드롭
  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragOver(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      openFile(e.dataTransfer?.files?.[0]);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const zoom = (d: number) =>
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((s + d) * 100) / 100)));

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => setChatWidth(Math.min(800, Math.max(320, window.innerWidth - ev.clientX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="app">
      <header className="toolbar">
        <button className="primary" onClick={() => fileInput.current?.click()}>
          PDF 열기
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            openFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <span className="filename" title={fileName}>
          {fileName || "HelpMyDoc"}
        </span>
        <span className="spacer" />
        {doc && (
          <>
            <form
              className="pager"
              onSubmit={(e) => {
                e.preventDefault();
                const n = parseInt(pageInput, 10);
                if (!Number.isNaN(n)) viewerRef.current?.goTo(n);
              }}
            >
              <input
                value={pageInput}
                inputMode="numeric"
                aria-label="페이지 번호"
                onChange={(e) => setPageInput(e.target.value)}
                onFocus={(e) => e.target.select()}
              />
              <span>/ {doc.numPages}</span>
            </form>
            <div className="zoom">
              <button className="ghost" onClick={() => zoom(-0.25)} aria-label="축소">
                −
              </button>
              <span>{Math.round(scale * 100)}%</span>
              <button className="ghost" onClick={() => zoom(0.25)} aria-label="확대">
                +
              </button>
            </div>
          </>
        )}
        <button className="ghost" onClick={() => setShowSettings(true)}>
          ⚙ 설정{settings.provider === "api" && !settings.apiKey && <span className="dot" />}
        </button>
      </header>

      <main className="split" style={{ gridTemplateColumns: `1fr 6px ${chatWidth}px` }}>
        <section className="left">
          {doc ? (
            <PdfViewer
              key={fileName + doc.fingerprints[0]}
              ref={viewerRef}
              doc={doc}
              initialPage={restored.lastPage}
              scale={scale}
              onPageChange={onPageChange}
              onSelect={setSelection}
            />
          ) : (
            <div className="dropzone" onClick={() => fileInput.current?.click()}>
              <div className="big">📄</div>
              <p>PDF 파일을 여기에 끌어다 놓거나 클릭해서 여세요</p>
              <p className="muted">파일은 서버에 업로드되지 않고 이 브라우저에서만 처리됩니다.</p>
              {loadError && <p className="error">{loadError}</p>}
            </div>
          )}
        </section>
        <div className="resizer" onPointerDown={startResize} role="separator" aria-orientation="vertical" />
        <ChatPanel
          key={fileName + docId}
          docId={docId}
          initialMessages={restored.messages}
          onGoToPage={(n) => viewerRef.current?.goTo(n)}
          doc={doc}
          fileName={fileName}
          currentPage={page}
          selection={selection}
          onClearSelection={() => setSelection("")}
          settings={settings}
          bridge={bridge}
          onOpenSettings={() => setShowSettings(true)}
        />
      </main>

      {dragOver && <div className="drop-overlay">PDF를 놓아서 열기</div>}
      {showSettings && (
        <SettingsDialog
          settings={settings}
          bridge={bridge}
          onRefreshBridge={refreshBridge}
          onClose={() => setShowSettings(false)}
          onSave={(s) => {
            setSettings(s);
            saveSettings(s);
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}

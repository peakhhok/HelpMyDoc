import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfViewer, type PdfViewerHandle } from "./components/PdfViewer";
import { ChatPanel } from "./components/ChatPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { openPdf } from "./lib/pdf";
import { loadSettings, saveSettings, type Settings } from "./lib/settings";

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

export default function App() {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [fileName, setFileName] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(1.25);
  const [selection, setSelection] = useState("");
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [chatWidth, setChatWidth] = useState(440);
  const [dragOver, setDragOver] = useState(false);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const viewerRef = useRef<PdfViewerHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setLoadError("PDF 파일만 열 수 있습니다.");
      return;
    }
    try {
      setLoadError(null);
      const next = await openPdf(await file.arrayBuffer());
      docRef.current?.loadingTask.destroy();
      docRef.current = next;
      setDoc(next);
      setFileName(file.name);
      setPage(1);
      setPageInput("1");
      setSelection("");
    } catch (e) {
      setLoadError(`PDF를 열지 못했습니다: ${(e as Error).message}`);
    }
  };

  const onPageChange = useCallback((p: number) => {
    setPage(p);
    setPageInput(String(p));
  }, []);

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

  const zoom = (d: number) => setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((s + d) * 100) / 100)));

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
          ⚙ 설정{!settings.apiKey && <span className="dot" />}
        </button>
      </header>

      <main className="split" style={{ gridTemplateColumns: `1fr 6px ${chatWidth}px` }}>
        <section className="left">
          {doc ? (
            <PdfViewer
              key={fileName + doc.fingerprints[0]}
              ref={viewerRef}
              doc={doc}
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
          key={fileName}
          doc={doc}
          fileName={fileName}
          currentPage={page}
          selection={selection}
          onClearSelection={() => setSelection("")}
          settings={settings}
          onOpenSettings={() => setShowSettings(true)}
        />
      </main>

      {dragOver && <div className="drop-overlay">PDF를 놓아서 열기</div>}
      {showSettings && (
        <SettingsDialog
          settings={settings}
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

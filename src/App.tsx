import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DocViewer, type DocViewerHandle, type NewHighlight } from "./components/DocViewer";
import { ChatPanel } from "./components/ChatPanel";
import { NotesPanel } from "./components/NotesPanel";
import { ScanDialog } from "./components/ScanDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { SetupScreen } from "./components/SetupScreen";
import { UpdateBanner } from "./components/UpdateBanner";
import { fetchBridgeStatus, type BridgeStatus, type CliId } from "./lib/bridgeClient";
import { sha256Hex } from "./lib/docId";
import {
  HL_COLORS,
  HL_CSS,
  HL_LABEL,
  newId,
  sanitizeHighlights,
  sanitizeNotes,
  type Highlight,
  type HlColor,
} from "./lib/annotations";
import { loadDoc, updateDoc } from "./lib/docStore";
import { sanitizeScan, type ScanData } from "./lib/scan";
import { useDocIndex } from "./lib/useDocIndex";
import { useClaudeVerify } from "./lib/useVerify";
import { useScan } from "./lib/useScan";
import type { UiMessage } from "./lib/history";
import { sanitizeAttachments, type Attachment } from "./lib/attach";
import { pdfSource, pptxSource, type DocSource } from "./lib/docSource";
import { openPdf } from "./lib/pdf";
import { getProvider } from "./lib/providers";
import { loadSettings, saveSettings, type ProviderId, type Settings } from "./lib/settings";
import { evaluateSetup } from "./lib/setup";
import { dropExpired, loadLimits, mergeLimits, saveLimits, type UsageLimits } from "./lib/usage";

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const DEFAULT_SCALE = 1.25;

export default function App() {
  const [doc, setDoc] = useState<DocSource | null>(null);
  const [fileName, setFileName] = useState("");
  /** 문서 지문(저장의 키)과, 저장돼 있던 대화·마지막 페이지 */
  const [docId, setDocId] = useState("");
  const [restored, setRestored] = useState<{ messages: UiMessage[]; lastPage: number; attachments: Attachment[] }>({
    messages: [],
    lastPage: 1,
    attachments: [],
  });
  /** 이 문서의 형광펜·페이지 메모·스캔 결과 (문서별로 저장) */
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [scan, setScan] = useState<ScanData | null>(null);
  const [penColor, setPenColor] = useState<HlColor | null>(null);
  const [rightTab, setRightTab] = useState<"chat" | "notes">("chat");
  const [showScan, setShowScan] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [selection, setSelection] = useState("");
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  /** 설정창을 열 때 먼저 보여줄 연결 방식 (준비가 안 된 연결을 골랐을 때) */
  const [settingsProvider, setSettingsProvider] = useState<ProviderId | undefined>(undefined);
  /** Claude Code 상태 */
  const [bridgeRaw, setBridge] = useState<BridgeStatus | null>(null);
  /** Codex 상태 (Codex 연결을 켠 경우에만 확인한다) */
  const [codex, setCodex] = useState<BridgeStatus | null>(null);
  /** 마지막으로 알려진 구독 한도 사용률 (이미 초기화된 창은 제외) */
  const [limits, setLimits] = useState<UsageLimits | null>(() => loadLimits());
  const limitsRef = useRef(limits);
  /** 답변을 받았는데도 한도 정보가 오지 않음 (옛 Claude Code 버전) */
  const [limitsMissing, setLimitsMissing] = useState(false);
  /** 시작 화면(연결 설정)을 사용자가 직접 열었음 */
  const [forceSetup, setForceSetup] = useState(false);
  /** 시작할 때 연결이 안 돼 있어 시작 화면을 띄운 뒤, 사용자가 닫을 때까지 유지 */
  const [sticky, setSticky] = useState(false);
  /** 시작 시 연결 점검을 한 번 마쳤는가 (이후 로그인이 풀리면 화면을 막지 않고 배너로 알린다) */
  const [startupDone, setStartupDone] = useState(false);
  /** 이번 실행 동안만 연결 점검을 건너뜀 */
  const [skipGate, setSkipGate] = useState(false);
  const [chatWidth, setChatWidth] = useState(440);
  const [dragOver, setDragOver] = useState(false);
  const docRef = useRef<DocSource | null>(null);
  // 드래그&드롭 핸들러는 처음 렌더의 openFile 을 잡고 있으므로 최신 설정은 ref 로 읽는다.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const hasRecord = useRef(false);
  const viewerRef = useRef<DocViewerHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const leftRef = useRef<HTMLElement>(null);

  const refreshBridge = useCallback((silent?: boolean) => {
    if (!silent) setBridge(null);
    fetchBridgeStatus("claude-code").then(setBridge);
  }, []);

  const refreshCodex = useCallback((silent?: boolean) => {
    if (!silent) setCodex(null);
    fetchBridgeStatus("codex").then(setCodex);
  }, []);

  const refreshCli = useCallback(
    (id: CliId) => (id === "codex" ? refreshCodex() : refreshBridge()),
    [refreshBridge, refreshCodex],
  );

  useEffect(() => {
    fetchBridgeStatus("claude-code").then(setBridge);
    // Codex 는 사용자가 켠 경우에만 실행해 본다.
    if (settingsRef.current.enableCodex) fetchBridgeStatus("codex").then(setCodex);
  }, []);

  const openSettings = useCallback((provider?: ProviderId) => {
    setSettingsProvider(provider);
    setShowSettings(true);
  }, []);

  const switchProvider = (id: ProviderId) => {
    const next = { ...settings, provider: id };
    setSettings(next);
    saveSettings(next);
  };

  const onLimits = useCallback((next: UsageLimits) => {
    const merged = mergeLimits(limitsRef.current, next);
    limitsRef.current = merged;
    setLimits(merged);
    setLimitsMissing(false);
    saveLimits(merged);
  }, []);

  // 한도가 초기화될 시각이 지나면 낡은 값을 화면에서 치운다.
  useEffect(() => {
    const t = setInterval(() => {
      const alive = dropExpired(limitsRef.current, Date.now());
      if (JSON.stringify(alive) !== JSON.stringify(limitsRef.current)) {
        limitsRef.current = alive;
        setLimits(alive);
      }
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const claudeMode = settings.provider === "claude-code";

  // 실행할 때(와 오래 비워 둔 뒤) Claude Code 로 짧은 요청을 실제로 보내 로그인이 유효한지 확인한다.
  // `claude auth status` 는 로그인 정보가 남아 있는지만 알 뿐, 재부팅 등으로 풀린 것은 모른다.
  const verify = useClaudeVerify({
    enabled: claudeMode && settings.verifyOnLaunch && !!bridgeRaw?.available && bridgeRaw.loggedIn !== false,
    onLimits,
  });
  const authBroken = verify.state.phase === "auth";
  const bridge = useMemo(
    () => (authBroken && bridgeRaw ? { ...bridgeRaw, loggedIn: false } : bridgeRaw),
    [authBroken, bridgeRaw],
  );
  // 로그인이 풀린 것을 알아내면 연결 화면(로그인 단계)을 바로 띄운다.
  useEffect(() => {
    if (authBroken && claudeMode) setSticky(true);
  }, [authBroken, claudeMode]);

  const setup = evaluateSetup(bridge);

  // 시작할 때 한 번: Claude Code 방식인데 준비가 안 됐다면 시작 화면을 띄운다.
  useEffect(() => {
    if (bridge === null || startupDone) return;
    setStartupDone(true);
    if (claudeMode && !skipGate && setup.step !== "ready") setSticky(true);
  }, [bridge, startupDone, claudeMode, skipGate, setup.step]);

  // 창으로 돌아올 때마다 조용히 다시 확인한다. (터미널에서 로그인하고 돌아오면 바로 반영, 로그인이 풀렸으면 배너)
  const codexMode = settings.provider === "codex" && settings.enableCodex;
  useEffect(() => {
    if (!claudeMode && !codexMode) return;
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      if (claudeMode) refreshBridge(true);
      if (codexMode) refreshCodex(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [claudeMode, codexMode, refreshBridge, refreshCodex]);

  const showSetup = !settings.onboarded || forceSetup || sticky || (claudeMode && !startupDone && !skipGate);
  const closeSetup = () => {
    setForceSetup(false);
    setSticky(false);
  };
  const completeSetup = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
    closeSetup();
  };
  const skipSetup = () => {
    // 처음 실행이면 '설정 마침'으로 기록해 매번 묻지 않고, 이후에는 이번 실행에만 건너뛴다.
    if (!settings.onboarded) completeSetup({ onboarded: true });
    else {
      setSkipGate(true);
      closeSetup();
    }
  };

  // 형광펜·메모·스캔 결과를 바꿀 때마다 잠시 뒤 이 문서의 기록에 저장한다 (기록 저장을 껐으면 저장하지 않는다).
  const ann = useRef({ highlights, notes, scan });
  const annTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const annPending = useRef<(() => void) | null>(null);
  /** 아직 저장하지 않은 변경이 있으면 지금 바로 저장한다 (다른 문서를 열거나 창을 닫기 전) */
  const flushAnn = useCallback(() => {
    clearTimeout(annTimer.current);
    const run = annPending.current;
    annPending.current = null;
    run?.();
  }, []);
  const saveAnn = useCallback(() => {
    clearTimeout(annTimer.current);
    const target = { id: docId, name: fileName, numPages: doc?.numPages ?? 0 };
    const data = ann.current;
    annPending.current = () => {
      if (!settingsRef.current.saveHistory || !target.id || !target.numPages) return;
      hasRecord.current = true;
      updateDoc(target.id, { name: target.name, numPages: target.numPages }, { ...data });
    };
    annTimer.current = setTimeout(flushAnn, 500);
  }, [docId, fileName, doc, flushAnn]);
  useEffect(() => {
    window.addEventListener("beforeunload", flushAnn);
    return () => window.removeEventListener("beforeunload", flushAnn);
  }, [flushAnn]);
  const changeHighlights = useCallback(
    (update: (prev: Highlight[]) => Highlight[]) => {
      ann.current.highlights = update(ann.current.highlights);
      setHighlights(ann.current.highlights);
      saveAnn();
    },
    [saveAnn],
  );
  const changeNote = useCallback(
    (pg: number, text: string) => {
      const next = { ...ann.current.notes };
      if (text.trim()) next[pg] = text;
      else delete next[pg];
      ann.current.notes = next;
      setNotes(next);
      saveAnn();
    },
    [saveAnn],
  );
  const changeScan = useCallback(
    (update: (prev: ScanData | null) => ScanData | null) => {
      ann.current.scan = update(ann.current.scan);
      setScan(ann.current.scan);
      saveAnn();
    },
    [saveAnn],
  );
  const addHighlight = useCallback(
    (h: NewHighlight) => changeHighlights((prev) => [...prev, { ...h, id: newId(), createdAt: Date.now() }]),
    [changeHighlights],
  );
  const changeHighlight = useCallback(
    (id: string, patch: Partial<Pick<Highlight, "color" | "note">>) =>
      changeHighlights((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h))),
    [changeHighlights],
  );
  const removeHighlight = useCallback(
    (id: string) => changeHighlights((prev) => prev.filter((h) => h.id !== id)),
    [changeHighlights],
  );

  const getIndex = useDocIndex(doc, scan);
  const scanProvider = getProvider(settings.provider);
  const scanUnavailable = scanProvider.unavailableReason({ settings, bridge, codex });
  const scanner = useScan({ doc, fileName, settings, unavailable: scanUnavailable, scan, changeScan, onLimits });

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    const lower = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || lower.endsWith(".pdf");
    const isPptx = lower.endsWith(".pptx");
    if (!isPdf && !isPptx) {
      setLoadError(
        lower.endsWith(".ppt")
          ? "옛 PowerPoint(.ppt)는 열 수 없어요. PowerPoint에서 .pptx 또는 PDF로 저장해서 열어 주세요."
          : "PDF 또는 PowerPoint(.pptx) 파일만 열 수 있습니다.",
      );
      return;
    }
    try {
      setLoadError(null);
      const buffer = await file.arrayBuffer();
      // 이름이 아니라 파일 내용의 해시로 같은 문서인지 알아본다.
      // (pdf.js 는 버퍼를 워커로 넘겨 쓸 수 없게 만들 수 있으므로 해시를 먼저 계산한다)
      const hash = await sha256Hex(buffer);
      const next = isPptx ? pptxSource(buffer, hash ?? file.name) : pdfSource(await openPdf(buffer));
      const id = hash ?? next.key;
      const record = settingsRef.current.saveHistory && id ? await loadDoc(id) : undefined;
      const lastPage = Math.min(Math.max(1, record?.lastPage ?? 1), next.numPages);
      hasRecord.current = !!record;
      flushAnn();
      docRef.current?.destroy();
      docRef.current = next;
      // 한 번에 반영해야 채팅창이 저장된 대화로 시작하고 뷰어가 저장된 페이지로 열린다.
      setDoc(next);
      setFileName(file.name);
      setDocId(id);
      setRestored({
        messages: record?.messages ?? [],
        lastPage,
        attachments: sanitizeAttachments(record?.attachments),
      });
      ann.current = {
        highlights: sanitizeHighlights(record?.highlights),
        notes: sanitizeNotes(record?.notes),
        scan: sanitizeScan(record?.scan),
      };
      setHighlights(ann.current.highlights);
      setNotes(ann.current.notes);
      setScan(ann.current.scan);
      setPenColor(null);
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
    // 채팅창에 놓는 파일은 "첨부"이므로 문서로 열지 않는다. (채팅창이 직접 처리한다)
    const inChat = (e: DragEvent) => !!(e.target as Element | null)?.closest?.(".chat");
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(!inChat(e));
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragOver(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (inChat(e)) return;
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

  // Ctrl+마우스 휠(터치패드 핀치 포함)과 Ctrl +/-/0 으로 확대·축소한다. 화면 전체가 아니라 PDF 영역만 바뀐다.
  useEffect(() => {
    const el = leftRef.current;
    if (!el || !doc) return;
    const clamp = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(v * 100) / 100));
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setScale((s) => clamp(s * Math.exp(-e.deltaY * 0.002)));
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === "+" || e.key === "=") setScale((s) => clamp(s + 0.1));
      else if (e.key === "-" || e.key === "_") setScale((s) => clamp(s - 0.1));
      else if (e.key === "0") setScale(DEFAULT_SCALE);
      else return;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [doc]);

  const noteCount = Object.keys(notes).length + highlights.length;
  const scanned = scan?.chunks.length ?? 0;
  const scanLabel = scanner.running
    ? ` ${scanner.progress?.done ?? 0}/${scanner.progress?.total ?? "…"}`
    : scanned === 0
      ? ""
      : scanner.estimate && scanner.remaining === 0
        ? " ✓"
        : " (일부)";

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
          accept="application/pdf,.pdf,.pptx"
          hidden
          onChange={(e) => {
            openFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <span className="filename" title={fileName}>
          {fileName || "HelpMyDoc"}
        </span>
        {doc && (
          <div className="tools">
            <span className="tool-label">형광펜</span>
            {HL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch${penColor === c ? " on" : ""}`}
                style={{ background: HL_CSS[c] }}
                title={`${HL_LABEL[c]} — 글자를 고른 채 누르면 바로 칠하고, 고르지 않고 누르면 형광펜 모드가 켜져요 (한 번 더 누르면 꺼짐)`}
                aria-label={`${HL_LABEL[c]} 형광펜`}
                aria-pressed={penColor === c}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (viewerRef.current?.highlightSelection(c)) return;
                  setPenColor((cur) => (cur === c ? null : c));
                }}
              />
            ))}
            <button className="ghost" onClick={() => setRightTab("notes")} title="이 문서의 메모와 형광펜 보기">
              📝 메모{noteCount > 0 ? ` ${noteCount}` : ""}
            </button>
            <button
              className="ghost"
              onClick={() => setShowScan(true)}
              title="AI가 문서를 한 번 훑어 개요를 만들어 둬요"
            >
              🔍 문서 스캔{scanLabel}
            </button>
          </div>
        )}
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
        <button className="ghost" onClick={() => openSettings()}>
          ⚙ 설정
          {settings.provider !== "claude-code" &&
            settings.provider !== "codex" &&
            getProvider(settings.provider).unavailableReason({ settings, bridge, codex }) !== null && (
              <span className="dot" />
            )}
        </button>
      </header>

      <UpdateBanner />

      <main className="split" style={{ gridTemplateColumns: `1fr 6px ${chatWidth}px` }}>
        <section className="left" ref={leftRef}>
          {doc ? (
            <DocViewer
              key={fileName + doc.key}
              ref={viewerRef}
              doc={doc}
              initialPage={restored.lastPage}
              scale={scale}
              onPageChange={onPageChange}
              onSelect={setSelection}
              highlights={highlights}
              penColor={penColor}
              onAddHighlight={addHighlight}
              onChangeHighlight={changeHighlight}
              onRemoveHighlight={removeHighlight}
            />
          ) : (
            <div className="dropzone" onClick={() => fileInput.current?.click()}>
              <div className="big">📄</div>
              <p>PDF 또는 PowerPoint(.pptx) 파일을 여기에 끌어다 놓거나 클릭해서 여세요</p>
              <p className="muted">파일은 서버에 업로드되지 않고 이 브라우저에서만 처리됩니다.</p>
              {loadError && <p className="error">{loadError}</p>}
            </div>
          )}
        </section>
        <div className="resizer" onPointerDown={startResize} role="separator" aria-orientation="vertical" />
        <div className="right">
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={rightTab === "chat"}
              className={rightTab === "chat" ? "on" : ""}
              onClick={() => setRightTab("chat")}
            >
              💬 채팅
            </button>
            <button
              role="tab"
              aria-selected={rightTab === "notes"}
              className={rightTab === "notes" ? "on" : ""}
              onClick={() => setRightTab("notes")}
            >
              📝 메모{noteCount > 0 ? ` (${noteCount})` : ""}
            </button>
          </div>
          <div className="tab-pane" hidden={rightTab !== "chat"}>
            <ChatPanel
              key={fileName + docId}
              docId={docId}
              initialMessages={restored.messages}
              initialAttachments={restored.attachments}
              onGoToPage={(n) => viewerRef.current?.goTo(n)}
              doc={doc}
              fileName={fileName}
              currentPage={page}
              selection={selection}
              onClearSelection={() => setSelection("")}
              settings={settings}
              bridge={bridge}
              codex={codex}
              onOpenSettings={openSettings}
              onSwitchProvider={switchProvider}
              onOpenSetup={() => setForceSetup(true)}
              verifyPhase={verify.state.phase}
              onAuthFailed={(message) => {
                verify.markAuthFailed(message);
                setSticky(true);
              }}
              onRecheckBridge={() => {
                refreshBridge(true);
                if (settingsRef.current.enableCodex) refreshCodex(true);
              }}
              limits={limits}
              onLimits={onLimits}
              limitsMissing={limitsMissing}
              scan={scan}
              notes={notes}
              highlights={highlights}
              getIndex={getIndex}
              onLimitsMissing={() => setLimitsMissing(true)}
            />
          </div>
          <div className="tab-pane" hidden={rightTab !== "notes"}>
            <NotesPanel
              fileName={fileName}
              numPages={doc?.numPages ?? 0}
              currentPage={page}
              notes={notes}
              highlights={highlights}
              persist={settings.saveHistory}
              onChangeNote={changeNote}
              onChangeHighlight={changeHighlight}
              onRemoveHighlight={removeHighlight}
              onGoToPage={(n) => viewerRef.current?.goTo(n)}
            />
          </div>
        </div>
      </main>

      {showScan && doc && (
        <ScanDialog
          fileName={fileName}
          numPages={doc.numPages}
          providerName={scanProvider.short}
          unavailable={scanUnavailable}
          scan={scan}
          estimate={scanner.estimate}
          analyzing={scanner.analyzing}
          remaining={scanner.remaining}
          running={scanner.running}
          progress={scanner.progress}
          error={scanner.error}
          useOverview={settings.useOverview}
          onToggleUseOverview={(v) => {
            const next = { ...settings, useOverview: v };
            setSettings(next);
            saveSettings(next);
          }}
          persist={settings.saveHistory}
          onAnalyze={() => void scanner.analyze()}
          onStart={() => void scanner.start()}
          onCancel={scanner.cancel}
          onClear={() => changeScan(() => null)}
          onClose={() => setShowScan(false)}
        />
      )}
      {dragOver && <div className="drop-overlay">파일을 놓아서 열기</div>}
      {showSetup && (
        <SetupScreen
          mode={settings.onboarded ? "repair" : "first-run"}
          settings={settings}
          bridge={bridge}
          onRefresh={(silent) => {
            refreshBridge(silent);
            // "다시 확인"을 눌렀을 때 로그인이 풀린 상태였다면 실제로 다시 확인한다.
            if (!silent && authBroken) void verify.run();
          }}
          onComplete={completeSetup}
          onSkip={skipSetup}
          loginExpired={authBroken}
          onLoginFinished={() => {
            refreshBridge(true);
            void verify.run();
          }}
        />
      )}
      {showSettings && (
        <SettingsDialog
          settings={settings}
          bridge={bridge}
          codex={codex}
          initialProvider={settingsProvider}
          onRefreshBridge={refreshCli}
          onOpenSetup={() => {
            setShowSettings(false);
            setForceSetup(true);
          }}
          onClose={() => setShowSettings(false)}
          onSave={(s) => {
            const next = { ...s, onboarded: true };
            setSettings(next);
            saveSettings(next);
            setShowSettings(false);
            if (next.enableCodex) refreshCodex(true);
          }}
        />
      )}
    </div>
  );
}

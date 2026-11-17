import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DocSource } from "../lib/docSource";
import { ClaudeError } from "../lib/anthropicApi";
import { LimitsBadge } from "./LimitsBadge";
import { ProviderSwitcher } from "./ProviderSwitcher";
import { ClaudeCodeError, type BridgeStatus } from "../lib/bridgeClient";
import type { Highlight } from "../lib/annotations";
import { fitAttachments, readAttachment, type Attachment } from "../lib/attach";
import { buildPrompt, type RelatedEntry } from "../lib/context";
import { buildOverview, digestMap, type ScanData } from "../lib/scan";
import { isAuthError } from "../lib/verify";
import { projectFromValues, projectName, type ProjectValues } from "../lib/project";
import { GitDialog } from "./GitDialog";
import { ProjectDialog } from "./ProjectDialog";
import type { VerifyPhase } from "../lib/useVerify";
import { bestExcerpt, findRelated, type PageIndex } from "../lib/related";
import { updateDoc } from "../lib/docStore";
import { linkifyPages, trimHistory, type UiMessage } from "../lib/history";
import { getProvider } from "../lib/providers";
import type { ProviderId } from "../lib/settings";
import { evaluateSetup } from "../lib/setup";
import type { Settings } from "../lib/settings";
import { formatTokens, type UsageLimits } from "../lib/usage";

interface Props {
  doc: DocSource | null;
  fileName: string;
  currentPage: number;
  selection: string;
  onClearSelection: () => void;
  /** 문서 지문 (대화 저장의 키). 비어 있으면 저장하지 않는다 */
  docId: string;
  /** 저장된 이전 대화 */
  initialMessages: UiMessage[];
  /** 답변 속 p.N 링크를 눌렀을 때 */
  onGoToPage: (page: number) => void;
  settings: Settings;
  /** Claude Code 상태 */
  bridge: BridgeStatus | null;
  /** Codex 상태 */
  codex: BridgeStatus | null;
  /** 설정 열기 (id 를 주면 그 연결 방식의 탭으로) */
  onOpenSettings: (provider?: ProviderId) => void;
  /** 준비된 연결 방식으로 바꾼다 */
  onSwitchProvider: (id: ProviderId) => void;
  /** 연결 설정(시작 화면) 열기 */
  onOpenSetup: () => void;
  /** Claude Code 상태를 조용히 다시 확인 (오류가 났을 때 로그인 풀림 등을 알아채기 위해) */
  onRecheckBridge: () => void;
  /** 구독 한도 사용률 (Claude Code 방식에서 답변마다 갱신) */
  limits: UsageLimits | null;
  onLimits: (limits: UsageLimits) => void;
  /** 답변을 받았는데 한도 정보가 하나도 오지 않았음 (옛 Claude Code 버전) */
  limitsMissing: boolean;
  onLimitsMissing: () => void;
  /** 실행할 때 하는 연결 확인의 진행 상태 (Claude Code 방식) */
  verifyPhase: VerifyPhase;
  /** 질문 중에 로그인이 풀렸다는 오류를 만났을 때 */
  onAuthFailed: (message: string) => void;
  /** 이 문서에 적용되는 프로젝트 폴더 설정과, 그것이 이 문서만의 설정인지 */
  projectValues: ProjectValues;
  projectIsCustom: boolean;
  onProjectSave: (values: ProjectValues, asDefault: boolean) => void;
  onProjectUseDefault: () => void;
  /** 문서 스캔 결과, 페이지 메모, 형광펜 (질문에 함께 보낼 수 있다) */
  scan: ScanData | null;
  notes: Record<number, string>;
  highlights: Highlight[];
  /** "비슷한 쪽 찾기" 색인 (문서를 열 때 백그라운드로 만든다) */
  getIndex: () => Promise<PageIndex | null>;
}

const toolIcon = (name?: string) =>
  name === "Write" || name === "Edit" ? "✏️" : name === "Grep" ? "🔍" : name === "Glob" ? "🗂" : "📖";

const QUICK_PROMPTS = ["여기서 중요한 부분을 요약해줘", "이 페이지를 쉽게 설명해줘", "핵심 개념을 정리해줘"];

export function ChatPanel({
  doc,
  fileName,
  currentPage,
  selection,
  onClearSelection,
  docId,
  initialMessages,
  onGoToPage,
  settings,
  bridge,
  codex,
  onOpenSettings,
  onSwitchProvider,
  onOpenSetup,
  onRecheckBridge,
  limits,
  onLimits,
  limitsMissing,
  onLimitsMissing,
  verifyPhase,
  onAuthFailed,
  projectValues,
  projectIsCustom,
  onProjectSave,
  onProjectUseDefault,
  scan,
  notes,
  highlights,
  getIndex,
}: Props) {
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  /** 채팅창에 올린 파일 (글로 바꾼 것). 다음에 보내는 질문 한 번에 함께 전송되고, 보내면 비워진다 */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachNote, setAttachNote] = useState<string | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const attachInput = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const provider = getProvider(settings.provider);
  const project = projectFromValues(projectValues);
  const [showGit, setShowGit] = useState(false);
  const [showProject, setShowProject] = useState(false);
  const persist = settings.saveHistory && !!docId && !!doc;
  // 사용 중에 Claude Code 연결이 끊기면(로그아웃 등) 화면을 막지 않고 배너로 알린다.
  const setupStep = evaluateSetup(bridge).step;
  const env = { settings, bridge, codex };
  const claudeIssue = provider.id === "claude-code" && setupStep !== "ready" && setupStep !== "checking";
  // 그 밖의 연결(Codex, API 키들)은 준비가 안 된 이유를 그대로 보여준다. (Codex 상태를 아직 확인 중일 땐 조용히)
  const otherReason =
    provider.id === "claude-code" || (provider.id === "codex" && !codex) ? null : provider.unavailableReason(env);
  const connectionIssue = claudeIssue || !!otherReason;

  // 답변이 끝날 때마다(스트리밍 중에는 저장하지 않음) 이 문서의 대화를 저장한다.
  const loadedMessages = useRef(initialMessages);
  useEffect(() => {
    if (busy || !persist || !doc || messages === loadedMessages.current) return;
    updateDoc(docId, { name: fileName, numPages: doc.numPages }, { messages });
  }, [messages, busy, persist, doc, docId, fileName]);

  const addFiles = async (list: FileList | File[] | null | undefined) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    if (!doc) return setAttachNote("먼저 문서를 열어 주세요. 첨부 파일은 열려 있는 문서의 대화에 붙어요.");
    setAttachBusy(true);
    const problems: string[] = [];
    const added: Attachment[] = [];
    for (const f of files) {
      try {
        added.push(await readAttachment(f));
      } catch (e) {
        problems.push((e as Error).message || `${f.name}: 읽지 못했어요.`);
      }
    }
    if (added.length) setAttachments((cur) => [...cur, ...added]);
    setAttachNote(
      problems.length
        ? problems.join("\n")
        : added.some((a) => a.truncated)
          ? "너무 긴 파일은 앞부분만 담았어요."
          : null,
    );
    setAttachBusy(false);
  };

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || busy) return;
    if (!doc) return setError("먼저 PDF 파일을 열어 주세요.");
    const reason = provider.unavailableReason(env);
    if (reason) {
      setError(reason);
      return provider.id === "claude-code" ? onOpenSetup() : onOpenSettings(provider.id);
    }

    setError(null);
    setInput("");
    // 올려 둔 파일은 이번 질문에만 함께 보내고 입력창에서는 비운다. (실패하면 아래에서 되돌린다)
    const sentAttachments = attachments;
    setAttachments([]);
    setAttachNote(null);
    let received = false;
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const history = messages;
    let sawLimits = false;

    try {
      // 문서 스캔 개요와 내 메모 (설정에서 끌 수 있다). 메모는 질문에 포함되는 쪽의 것만 보낸다.
      const from = Math.max(1, currentPage - settings.radius);
      const to = Math.min(doc.numPages, currentPage + settings.radius);
      const memos: Array<{ page: number; text: string }> = [];
      if (settings.useOverview) {
        for (let p = from; p <= to; p++) {
          if (notes[p]?.trim()) memos.push({ page: p, text: notes[p] });
          for (const h of highlights) {
            if (h.page === p && h.note?.trim()) memos.push({ page: p, text: `"${h.text.slice(0, 80)}" → ${h.note}` });
          }
        }
      }
      // 지금 쪽(과 선택·질문)과 내용이 비슷한 다른 쪽을 찾아 함께 보낸다. (이 PC 안에서 계산하며 AI 사용량을 쓰지 않는다)
      let related: RelatedEntry[] = [];
      if (settings.useOverview) {
        const index = await getIndex();
        if (index) {
          const digests = digestMap(scan);
          const found = findRelated(
            index,
            [{ text: await doc.getText(currentPage) }, { text: selection, weight: 3 }, { text: question, weight: 3 }],
            { exclude: (p) => p >= from && p <= to, k: 4 },
          );
          related = found.map((r) => ({
            page: r.page,
            terms: r.terms,
            point: digests.get(r.page)?.point,
            excerpt: bestExcerpt(index.texts[r.page - 1] ?? "", r.matches, 400),
          }));
        }
      }
      const ctx = await buildPrompt({
        attachments: fitAttachments(sentAttachments),
        related,
        overview: settings.useOverview ? buildOverview(scan, currentPage) : "",
        notes: memos,
        numPages: doc.numPages,
        getPageText: (p) => doc.getText(p),
        fileName,
        currentPage,
        radius: settings.radius,
        selection,
        question,
      });
      const userMsg: UiMessage = {
        role: "user",
        content: question,
        ref: {
          from: ctx.from,
          to: ctx.to,
          selection: !!selection.trim(),
          emptyPages: ctx.emptyPages,
          overview: ctx.overview,
          notes: ctx.notes,
          related: ctx.related,
          attached: ctx.attached,
        },
      };
      setMessages([...history, userMsg, { role: "assistant", content: "" }]);

      // 이전 턴은 질문 원문만, 이번 턴에만 현재 페이지 문맥을 붙인다.
      await provider.stream(settings, {
        project,
        // 화면에는 전체 대화가 남지만, AI 에게는 최근 대화만 보내 비용이 계속 늘지 않게 한다.
        history: trimHistory(history.map(({ role, content }) => ({ role, content }))),
        prompt: ctx.prompt,
        signal: ac.signal,
        onLimits: (l) => {
          sawLimits = true;
          onLimits(l);
        },
        onTool: (tool) =>
          setMessages((cur) => {
            const next = cur.slice();
            const last = next[next.length - 1];
            if (last?.role !== "assistant") return cur;
            const tools = (last.tools ?? []).slice();
            const i = tools.findIndex((t) => t.id === tool.id);
            if (i >= 0) tools[i] = { ...tools[i], ...tool };
            else tools.push(tool);
            next[next.length - 1] = { ...last, tools };
            return next;
          }),
        onNotice: (notice) =>
          setMessages((cur) => {
            const next = cur.slice();
            const last = next[next.length - 1];
            if (last?.role === "assistant") next[next.length - 1] = { ...last, notice };
            return next;
          }),
        // 답변이 끝나면 이번 답변에 쓰인 토큰 수를 마지막 답변 메시지에 붙인다.
        onUsage: (usage) =>
          setMessages((cur) => {
            const next = cur.slice();
            const last = next[next.length - 1];
            if (last?.role === "assistant") next[next.length - 1] = { ...last, usage };
            return next;
          }),
        onText: (delta) => {
          received = true;
          setMessages((cur) => {
            const next = cur.slice();
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content + delta };
            return next;
          });
        },
      });
      // 답변이 끝났는데 한도 정보가 하나도 안 왔다면 알려 준다. (옛 Claude Code 는 보내지 않는다)
      if (provider.id === "claude-code" && !sawLimits) onLimitsMissing();
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      if (!aborted) {
        if (provider.id === "claude-code" || provider.id === "codex") onRecheckBridge(); // 로그인이 풀렸는지 등을 다시 확인
        const message =
          e instanceof ClaudeError || e instanceof ClaudeCodeError ? e.message : `오류: ${(e as Error).message}`;
        // 로그인이 풀렸다는 오류면 연결 화면(로그인 단계)으로 안내한다.
        if (provider.id === "claude-code" && isAuthError(message)) onAuthFailed(message);
        setError(message);
      }
      // 답변이 하나도 없으면(오류든 중지든) 이번 턴을 되돌리고 질문을 입력창에 복원한다.
      // 일부라도 받았다면 받은 만큼만 남긴다.
      setMessages((cur) => {
        const last = cur[cur.length - 1];
        if (last?.role === "assistant" && last.content === "") return cur.slice(0, -2);
        return cur;
      });
      setInput((v) => v || question);
      // 답변이 하나도 없었다면 첨부도 되돌려서 다시 보낼 수 있게 한다.
      if (!received) setAttachments((cur) => (cur.length ? cur : sentAttachments));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <aside
      className="chat"
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        void addFiles(e.dataTransfer.files);
      }}
    >
      <div className="chat-head">
        <ProviderSwitcher env={env} onSwitch={onSwitchProvider} onNeedSetup={(id) => onOpenSettings(id)} />
        <span className="muted">{provider.describe(settings)}</span>
        {provider.id === "claude-code" && (
          <LimitsBadge limits={limits} missing={limitsMissing} version={bridge?.version?.split(" ")[0]} />
        )}
        {provider.id === "claude-code" && doc && !project && (
          <button
            type="button"
            className="ghost small project-chip"
            onClick={() => setShowProject(true)}
            title="내 PC의 폴더를 이 문서에 연결해서 AI가 폴더의 파일을 읽게 해요"
          >
            📁 폴더 연결
          </button>
        )}
        {provider.id === "claude-code" && project && (
          <button
            type="button"
            className="ghost small project-chip"
            onClick={() => setShowProject(true)}
            title={`프로젝트 폴더: ${project.dir}\n${project.allowWrite.length ? `쓰기 허용: ${project.allowWrite.join(", ")}` : "읽기 전용"}`}
          >
            📁 {projectName(project.dir)}
            {project.allowWrite.length > 0 ? " · ✏️ 쓰기" : " · 읽기"}
          </button>
        )}
        {provider.id === "claude-code" && project && project.branch && (
          <button
            type="button"
            className="ghost small"
            onClick={() => setShowGit(true)}
            title="GitHub로 올리기 (받아오기 → push). AI는 push하지 않고 이 버튼으로만 올라가요"
          >
            ⬆ 동기화
          </button>
        )}
        {provider.id === "claude-code" && verifyPhase === "checking" && (
          <span className="muted small-text" role="status">
            연결 확인 중…
          </span>
        )}
        <span className="spacer" />
        {persist && (
          <span className="muted small-text" title="이 문서의 대화와 마지막으로 본 페이지가 이 PC에 저장됩니다">
            💾 저장 중
          </span>
        )}
        {messages.length > 0 && (
          <button className="ghost small" onClick={() => !busy && setMessages([])} disabled={busy}>
            대화 지우기
          </button>
        )}
      </div>

      <div className="chat-body">
        {messages.length === 0 && (
          <div className="empty">
            <p>
              {doc ? (
                <>
                  지금 보고 있는 <b>{currentPage}쪽</b> 근처를 자동으로 읽고 답해요.
                  <br />
                  페이지를 말하지 않아도 됩니다.
                  {persist && (
                    <>
                      <br />
                      <span className="small-text">이 문서의 대화는 이 PC에 저장되어 다음에 이어집니다.</span>
                    </>
                  )}
                </>
              ) : (
                "PDF를 열면 여기서 바로 질문할 수 있어요."
              )}
            </p>
            {doc && (
              <div className="quick">
                {QUICK_PROMPTS.map((q) => (
                  <button key={q} className="chip" onClick={() => send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === "user" && m.ref && (
              <div className="ref">
                📄 {m.ref.from === m.ref.to ? `p.${m.ref.from}` : `p.${m.ref.from}–${m.ref.to}`} 참조
                {m.ref.selection && " · 선택 텍스트 포함"}
                {m.ref.overview && " · 📚 문서 개요 포함"}
                {m.ref.notes && " · 📝 내 메모 포함"}
                {m.ref.attached && m.ref.attached.length > 0 && ` · 📎 ${m.ref.attached.join(", ")}`}
                {m.ref.related && m.ref.related.length > 0 && (
                  <>
                    {" · 🔗 비슷한 내용: "}
                    {m.ref.related.map((p) => (
                      <button key={p} type="button" className="pagelink" onClick={() => onGoToPage(p)}>
                        p.{p}
                      </button>
                    ))}
                  </>
                )}
                {m.ref.emptyPages.length > 0 && ` · 텍스트 없는 쪽: ${m.ref.emptyPages.join(", ")}`}
              </div>
            )}
            {m.role === "assistant" ? (
              m.content ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    // 답변 속 (p.120) 은 눌러서 그 쪽으로 이동, 그 밖의 링크는 새 창(기본 브라우저)으로
                    a: ({ href, children }) =>
                      href?.startsWith("#page-") ? (
                        <button type="button" className="pagelink" onClick={() => onGoToPage(Number(href.slice(6)))}>
                          {children}
                        </button>
                      ) : (
                        <a href={href} target="_blank" rel="noreferrer">
                          {children}
                        </a>
                      ),
                  }}
                >
                  {linkifyPages(m.content, doc?.numPages ?? 0)}
                </ReactMarkdown>
              ) : (
                <span className="muted">생각 중…</span>
              )
            ) : (
              <div className="plain">{m.content}</div>
            )}
            {m.role === "assistant" && m.tools && m.tools.length > 0 && (
              <ul className="tool-log" aria-label="AI가 폴더에서 한 일">
                {m.tools.map((t) => (
                  <li key={t.id} className={t.error ? "bad" : ""} title={t.error}>
                    {toolIcon(t.name)} {t.name} <code>{t.target}</code>
                    {t.error && <span> · 거부됨(허용된 경로가 아니에요)</span>}
                  </li>
                ))}
              </ul>
            )}
            {m.role === "assistant" && m.usage && (
              <div
                className="usage-note"
                title="이번 답변에 쓰인 토큰입니다. 입력에는 현재 페이지 문서, 이전 대화, 캐시된 분량이 포함됩니다."
              >
                입력 {formatTokens(m.usage.inputTokens)} · 출력 {formatTokens(m.usage.outputTokens)} 토큰
              </div>
            )}
            {m.role === "assistant" && m.notice && <div className="usage-note notice">⚠ {m.notice}</div>}
          </div>
        ))}
        {error && <div className="error">{error}</div>}
        <div ref={bottomRef} />
      </div>

      {connectionIssue && (
        <div className="banner" role="alert">
          <span>
            {claudeIssue
              ? setupStep === "login"
                ? "Claude Code 로그인이 필요해요."
                : setupStep === "install"
                  ? "Claude Code를 찾을 수 없어요."
                  : "내 PC의 Claude Code에 연결할 수 없어요."
              : otherReason}
          </span>
          <button
            type="button"
            className="small"
            onClick={() => (claudeIssue ? onOpenSetup() : onOpenSettings(provider.id))}
          >
            {claudeIssue ? "연결 점검" : "설정"}
          </button>
        </div>
      )}

      <div className="composer">
        {attachments.length > 0 && (
          <div className="attach-chips">
            {attachments.map((a) => (
              <span
                key={a.id}
                className="attach-chip"
                title={`${a.name} · ${a.chars.toLocaleString()}자${a.truncated ? " (앞부분만 전송)" : ""}`}
              >
                📎 {a.name}
                <small>
                  {" "}
                  {formatTokens(Math.round(a.text.length / 2))}토큰{a.truncated ? " · 일부" : ""}
                </small>
                <button
                  type="button"
                  className="ghost small"
                  aria-label={`${a.name} 첨부 빼기`}
                  onClick={() => setAttachments((cur) => cur.filter((x) => x.id !== a.id))}
                >
                  ✕
                </button>
              </span>
            ))}
            <span className="muted small-text">다음에 보내는 질문과 함께 전송돼요 (보내면 비워져요)</span>
          </div>
        )}
        {attachNote && (
          <div className="attach-note" role="alert">
            {attachNote}
          </div>
        )}
        {selection.trim() && (
          <div className="selection-chip" title={selection}>
            <span>
              ✂ 선택한 텍스트 포함: “{selection.trim().slice(0, 60)}
              {selection.trim().length > 60 ? "…" : ""}”
            </span>
            <button className="ghost small" onClick={onClearSelection} aria-label="선택 해제">
              ✕
            </button>
          </div>
        )}
        <div className="composer-row">
          <input
            ref={attachInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="ghost attach-btn"
            title={
              doc
                ? "파일 첨부 (문서, md, txt, PDF, PowerPoint, Word …). 이 창에 끌어다 놓아도 돼요"
                : "먼저 문서를 열어 주세요"
            }
            aria-label="파일 첨부"
            disabled={attachBusy || !doc}
            onClick={() => attachInput.current?.click()}
          >
            {attachBusy ? "…" : "📎"}
          </button>
          <textarea
            rows={2}
            value={input}
            placeholder={doc ? `${currentPage}쪽을 보고 있어요. 무엇이든 물어보세요` : "PDF를 먼저 열어 주세요"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // 한글 입력(IME) 조합 중 Enter 는 전송하지 않는다.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          {busy ? (
            <button className="primary" onClick={() => abortRef.current?.abort()}>
              중지
            </button>
          ) : (
            <button className="primary" onClick={() => send(input)} disabled={!input.trim()}>
              전송
            </button>
          )}
        </div>
      </div>
      {showProject && (
        <ProjectDialog
          values={projectValues}
          isCustom={projectIsCustom}
          fileName={fileName}
          onSave={(v, asDefault) => {
            onProjectSave(v, asDefault);
            setShowProject(false);
          }}
          onUseDefault={() => {
            onProjectUseDefault();
            setShowProject(false);
          }}
          onClose={() => setShowProject(false)}
        />
      )}
      {showGit && project && project.branch && (
        <GitDialog dir={project.dir} branch={project.branch} onClose={() => setShowGit(false)} />
      )}
    </aside>
  );
}

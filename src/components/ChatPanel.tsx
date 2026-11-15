import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ClaudeError } from "../lib/anthropicApi";
import { LimitsBadge } from "./LimitsBadge";
import { ClaudeCodeError, type BridgeStatus } from "../lib/bridgeClient";
import { buildPrompt } from "../lib/context";
import { updateDoc } from "../lib/docStore";
import { linkifyPages, trimHistory, type UiMessage } from "../lib/history";
import { getPageText } from "../lib/pdf";
import { getProvider } from "../lib/providers";
import { evaluateSetup } from "../lib/setup";
import type { Settings } from "../lib/settings";
import { formatTokens, type UsageLimits } from "../lib/usage";

interface Props {
  doc: PDFDocumentProxy | null;
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
  bridge: BridgeStatus | null;
  onOpenSettings: () => void;
  /** 연결 설정(시작 화면) 열기 */
  onOpenSetup: () => void;
  /** Claude Code 상태를 조용히 다시 확인 (오류가 났을 때 로그인 풀림 등을 알아채기 위해) */
  onRecheckBridge: () => void;
  /** 구독 한도 사용률 (Claude Code 방식에서 답변마다 갱신) */
  limits: UsageLimits | null;
  onLimits: (limits: UsageLimits) => void;
}

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
  onOpenSettings,
  onOpenSetup,
  onRecheckBridge,
  limits,
  onLimits,
}: Props) {
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const provider = getProvider(settings.provider);
  const persist = settings.saveHistory && !!docId && !!doc;
  // 사용 중에 Claude Code 연결이 끊기면(로그아웃 등) 화면을 막지 않고 배너로 알린다.
  const setupStep = evaluateSetup(bridge).step;
  const connectionIssue = provider.id === "claude-code" && setupStep !== "ready" && setupStep !== "checking";

  // 답변이 끝날 때마다(스트리밍 중에는 저장하지 않음) 이 문서의 대화를 저장한다.
  const loadedMessages = useRef(initialMessages);
  useEffect(() => {
    if (busy || !persist || !doc || messages === loadedMessages.current) return;
    updateDoc(docId, { name: fileName, numPages: doc.numPages }, { messages });
  }, [messages, busy, persist, doc, docId, fileName]);

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || busy) return;
    if (!doc) return setError("먼저 PDF 파일을 열어 주세요.");
    const reason = provider.unavailableReason({ settings, bridge });
    if (reason) {
      setError(reason);
      return provider.id === "claude-code" ? onOpenSetup() : onOpenSettings();
    }

    setError(null);
    setInput("");
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const history = messages;

    try {
      const ctx = await buildPrompt({
        numPages: doc.numPages,
        getPageText: (p) => getPageText(doc, p),
        fileName,
        currentPage,
        radius: settings.radius,
        selection,
        question,
      });
      const userMsg: UiMessage = {
        role: "user",
        content: question,
        ref: { from: ctx.from, to: ctx.to, selection: !!selection.trim(), emptyPages: ctx.emptyPages },
      };
      setMessages([...history, userMsg, { role: "assistant", content: "" }]);

      // 이전 턴은 질문 원문만, 이번 턴에만 현재 페이지 문맥을 붙인다.
      await provider.stream(settings, {
        // 화면에는 전체 대화가 남지만, AI 에게는 최근 대화만 보내 비용이 계속 늘지 않게 한다.
        history: trimHistory(history.map(({ role, content }) => ({ role, content }))),
        prompt: ctx.prompt,
        signal: ac.signal,
        onLimits,
        // 답변이 끝나면 이번 답변에 쓰인 토큰 수를 마지막 답변 메시지에 붙인다.
        onUsage: (usage) =>
          setMessages((cur) => {
            const next = cur.slice();
            const last = next[next.length - 1];
            if (last?.role === "assistant") next[next.length - 1] = { ...last, usage };
            return next;
          }),
        onText: (delta) =>
          setMessages((cur) => {
            const next = cur.slice();
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content + delta };
            return next;
          }),
      });
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      if (!aborted) {
        if (provider.id === "claude-code") onRecheckBridge(); // 로그인이 풀렸는지 등을 다시 확인
        setError(
          e instanceof ClaudeError || e instanceof ClaudeCodeError ? e.message : `오류: ${(e as Error).message}`,
        );
      }
      // 답변이 하나도 없으면(오류든 중지든) 이번 턴을 되돌리고 질문을 입력창에 복원한다.
      // 일부라도 받았다면 받은 만큼만 남긴다.
      setMessages((cur) => {
        const last = cur[cur.length - 1];
        if (last?.role === "assistant" && last.content === "") return cur.slice(0, -2);
        return cur;
      });
      setInput((v) => v || question);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <aside className="chat">
      <div className="chat-head">
        <strong>Claude</strong>
        <span className="muted">{provider.describe(settings)}</span>
        {provider.id === "claude-code" && <LimitsBadge limits={limits} />}
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
            {m.role === "assistant" && m.usage && (
              <div
                className="usage-note"
                title="이번 답변에 쓰인 토큰입니다. 입력에는 현재 페이지 문서, 이전 대화, 캐시된 분량이 포함됩니다."
              >
                입력 {formatTokens(m.usage.inputTokens)} · 출력 {formatTokens(m.usage.outputTokens)} 토큰
              </div>
            )}
          </div>
        ))}
        {error && <div className="error">{error}</div>}
        <div ref={bottomRef} />
      </div>

      {connectionIssue && (
        <div className="banner" role="alert">
          <span>
            {setupStep === "login"
              ? "Claude Code 로그인이 필요해요."
              : setupStep === "install"
                ? "Claude Code를 찾을 수 없어요."
                : "내 PC의 Claude Code에 연결할 수 없어요."}
          </span>
          <button type="button" className="small" onClick={onOpenSetup}>
            연결 점검
          </button>
        </div>
      )}

      <div className="composer">
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
    </aside>
  );
}

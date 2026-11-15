import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ClaudeError, type ChatMessage } from "../lib/anthropicApi";
import { ClaudeCodeError, type BridgeStatus } from "../lib/bridgeClient";
import { buildPrompt } from "../lib/context";
import { getPageText } from "../lib/pdf";
import { getProvider } from "../lib/providers";
import type { Settings } from "../lib/settings";

interface UiMessage extends ChatMessage {
  /** 이 질문에 실제로 AI에게 보여준 문서 범위 */
  ref?: { from: number; to: number; selection: boolean; emptyPages: number[] };
}

interface Props {
  doc: PDFDocumentProxy | null;
  fileName: string;
  currentPage: number;
  selection: string;
  onClearSelection: () => void;
  settings: Settings;
  bridge: BridgeStatus | null;
  onOpenSettings: () => void;
}

const QUICK_PROMPTS = ["여기서 중요한 부분을 요약해줘", "이 페이지를 쉽게 설명해줘", "핵심 개념을 정리해줘"];

export function ChatPanel({
  doc,
  fileName,
  currentPage,
  selection,
  onClearSelection,
  settings,
  bridge,
  onOpenSettings,
}: Props) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const provider = getProvider(settings.provider);

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || busy) return;
    if (!doc) return setError("먼저 PDF 파일을 열어 주세요.");
    const reason = provider.unavailableReason({ settings, bridge });
    if (reason) {
      setError(reason);
      return onOpenSettings();
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
        history: history.map(({ role, content }) => ({ role, content })),
        prompt: ctx.prompt,
        signal: ac.signal,
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
        <span className="spacer" />
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
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              ) : (
                <span className="muted">생각 중…</span>
              )
            ) : (
              <div className="plain">{m.content}</div>
            )}
          </div>
        ))}
        {error && <div className="error">{error}</div>}
        <div ref={bottomRef} />
      </div>

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

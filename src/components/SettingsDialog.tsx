import { useState } from "react";
import { CC_MODELS, MODELS, type ProviderId, type Settings } from "../lib/settings";
import type { BridgeStatus } from "../lib/claudeCode";

interface Props {
  settings: Settings;
  bridge: BridgeStatus | null;
  onRefreshBridge: () => void;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

function bridgeLine(b: BridgeStatus | null): { ok: boolean; text: string } {
  if (!b) return { ok: false, text: "확인 중…" };
  if (!b.available)
    return {
      ok: false,
      text: "사용할 수 없음 — 이 앱을 `npm run dev` 또는 `npm start`로 내 PC에서 실행하고, Claude Code(claude)가 설치되어 있어야 합니다.",
    };
  if (b.loggedIn === false) return { ok: false, text: `Claude Code ${b.version ?? ""} 감지됨 — 로그인이 필요합니다. 터미널에서 \`claude\` 를 실행해 로그인하세요.` };
  const via = b.authMethod === "oauth_token" ? "구독 로그인" : b.authMethod ? `인증: ${b.authMethod}` : "로그인됨";
  return { ok: true, text: `Claude Code ${b.version ?? ""} · ${via}` };
}

export function SettingsDialog({ settings, bridge, onRefreshBridge, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(settings);
  const line = bridgeLine(bridge);

  const choose = (provider: ProviderId) => {
    setDraft({ ...draft, provider });
    if (provider === "claude-code") onRefreshBridge();
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...draft, apiKey: draft.apiKey.trim() });
        }}
      >
        <h2>설정</h2>

        <div className="provider-tabs" role="radiogroup" aria-label="AI 연결 방식">
          <button type="button" role="radio" aria-checked={draft.provider === "api"} className={draft.provider === "api" ? "tab on" : "tab"} onClick={() => choose("api")}>
            API 키
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={draft.provider === "claude-code"}
            className={draft.provider === "claude-code" ? "tab on" : "tab"}
            onClick={() => choose("claude-code")}
          >
            내 PC의 Claude Code
          </button>
        </div>

        {draft.provider === "api" ? (
          <>
            <label>
              Anthropic API 키
              <input
                type="password"
                autoComplete="off"
                placeholder="sk-ant-..."
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                autoFocus
              />
            </label>
            <p className="hint">
              키는 이 브라우저의 localStorage에만 저장되고, Anthropic API(api.anthropic.com)로만 전송됩니다. 키는{" "}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                Anthropic Console
              </a>
              에서 발급할 수 있습니다.
            </p>
            <label>
              모델
              <select value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <div className={line.ok ? "status ok" : "status bad"}>
              {line.ok ? "● " : "○ "}
              {line.text}
              <button type="button" className="ghost small" onClick={onRefreshBridge}>
                다시 확인
              </button>
            </div>
            <label>
              모델
              <select value={draft.ccModel} onChange={(e) => setDraft({ ...draft, ccModel: e.target.value })}>
                {CC_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              내 컴퓨터에 설치된 Claude Code를 수정 없이 그대로 실행하고, 로그인과 사용량은 Claude Code가 직접 처리합니다(HelpMyDoc은 로그인 정보를 읽거나 저장하지 않습니다). 본인 PC에서 본인 계정으로만 사용하세요. 이 앱을
              서버로 호스팅해 다른 사람이 쓰게 하거나 구독을 공유하는 것은 Anthropic 사용 정책에 어긋납니다.
            </p>
          </>
        )}

        <label>
          AI에게 보여줄 페이지 범위
          <select value={draft.radius} onChange={(e) => setDraft({ ...draft, radius: Number(e.target.value) })}>
            <option value={0}>현재 페이지만</option>
            <option value={1}>현재 페이지 ±1쪽 (기본)</option>
            <option value={2}>현재 페이지 ±2쪽</option>
            <option value={4}>현재 페이지 ±4쪽 (토큰 많이 사용)</option>
          </select>
        </label>
        <p className="hint">질문할 때마다 이 범위의 텍스트가 Claude에게 전송됩니다. 범위가 넓을수록 사용량이 늘어납니다.</p>

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary">
            저장
          </button>
        </div>
      </form>
    </div>
  );
}

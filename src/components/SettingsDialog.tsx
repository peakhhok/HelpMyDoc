import { UpdateCheck } from "./UpdateCheck";
import { useState } from "react";
import { CC_MODELS, MODELS, type ProviderId, type Settings } from "../lib/settings";
import type { BridgeStatus, CliId } from "../lib/bridgeClient";
import { listGeminiModels } from "../lib/geminiApi";
import { listOpenAIModels } from "../lib/openaiApi";
import { PROVIDER_ORDER, PROVIDERS, providerTitle } from "../lib/providers";
import { describeAuth, evaluateSetup } from "../lib/setup";
import { CommandBox } from "./CommandBox";
import { HistoryManager } from "./HistoryManager";
import { ModelPicker } from "./ModelPicker";

interface Props {
  settings: Settings;
  /** Claude Code 상태 */
  bridge: BridgeStatus | null;
  /** Codex 상태 */
  codex: BridgeStatus | null;
  /** 처음에 열어 둘 연결 방식 (준비가 안 된 연결을 골랐을 때) */
  initialProvider?: ProviderId;
  onRefreshBridge: (id: CliId) => void;
  /** Claude Code 연결 점검(시작 화면) 열기 */
  onOpenSetup: () => void;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

/** CLI 연결 상태 한 줄 */
function cliLine(name: string, b: BridgeStatus | null): { ok: boolean; text: string } {
  const setup = evaluateSetup(b);
  switch (setup.step) {
    case "checking":
      return { ok: false, text: "확인 중…" };
    case "bridge":
      return {
        ok: false,
        text: "이 PC와 연결할 수 없음 — 데스크톱 앱 또는 내 PC에서 `npm run dev` / `npm start`로 실행해야 합니다.",
      };
    case "install":
      return {
        ok: false,
        text: b?.shimOnly
          ? `${name} 실행 파일을 찾지 못했습니다. (npm 래퍼만 있고 실제 진입점을 찾을 수 없음)`
          : `${name}가 설치되어 있지 않습니다.`,
      };
    case "login":
      return { ok: false, text: `${name} ${b?.version ?? ""} 감지됨 — 로그인이 필요합니다.` };
    case "ready": {
      const via = describeAuth(setup.authKind, b?.authMethod);
      return { ok: true, text: `${name} ${b?.version ?? ""} · ${via}${setup.warnings.length ? " ⚠" : ""}` };
    }
  }
}

function StatusLine({
  line,
  onRefresh,
  onFix,
}: {
  line: { ok: boolean; text: string };
  onRefresh: () => void;
  onFix?: () => void;
}) {
  return (
    <div className={line.ok ? "status ok" : "status bad"}>
      <span>
        {line.ok ? "● " : "○ "}
        {line.text}
      </span>
      <span className="status-actions">
        {!line.ok && onFix && (
          <button type="button" className="ghost small" onClick={onFix}>
            연결 점검
          </button>
        )}
        <button type="button" className="ghost small" onClick={onRefresh}>
          다시 확인
        </button>
      </span>
    </div>
  );
}

export function SettingsDialog({
  settings,
  bridge,
  codex,
  initialProvider,
  onRefreshBridge,
  onOpenSetup,
  onSave,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<Settings>({ ...settings, provider: initialProvider ?? settings.provider });
  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));
  const env = { settings: draft, bridge, codex };

  const choose = (provider: ProviderId) => {
    set({ provider });
    if (provider === "claude-code" || provider === "codex") onRefreshBridge(provider);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            ...draft,
            apiKey: draft.apiKey.trim(),
            openaiKey: draft.openaiKey.trim(),
            geminiKey: draft.geminiKey.trim(),
            codexModel: draft.codexModel.trim(),
          });
        }}
      >
        <h2>설정</h2>

        <div className="provider-groups" role="radiogroup" aria-label="AI 연결 방식">
          {(["subscription", "api"] as const).map((g) => (
            <div key={g} className="provider-group">
              <div className="small-text muted">
                {g === "subscription" ? "구독으로 쓰기 (내 PC의 프로그램)" : "API 키로 쓰기"}
              </div>
              <div className="provider-tabs wrap">
                {PROVIDER_ORDER.filter((id) => PROVIDERS[id].group === g).map((id) => {
                  const ready = PROVIDERS[id].unavailableReason(env) === null;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={draft.provider === id}
                      className={draft.provider === id ? "tab on" : "tab"}
                      onClick={() => choose(id)}
                      title={PROVIDERS[id].unavailableReason(env) ?? "사용 가능"}
                    >
                      {ready ? "● " : "○ "}
                      {providerTitle(PROVIDERS[id])}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {draft.provider === "claude-code" && (
          <>
            <StatusLine
              line={cliLine("Claude Code", bridge)}
              onRefresh={() => onRefreshBridge("claude-code")}
              onFix={onOpenSetup}
            />
            <label>
              모델
              <select value={draft.ccModel} onChange={(e) => set({ ccModel: e.target.value })}>
                {CC_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              Sonnet을 권장합니다. 문서 질문에는 충분하고, 일반적으로 구독 한도를 덜 씁니다. 'Claude Code 기본값'은
              모델을 앱이 정하지 않고 Claude Code 자체 설정(계정·플랜에 따라 다름)을 따릅니다.
            </p>
            <p className="hint">
              프로젝트 폴더(내 PC의 폴더를 AI가 읽게 하기)는 문서마다 따로 정해요. 문서를 연 뒤 채팅 창 위의{" "}
              <b>📁 폴더 연결</b> 버튼에서 설정하세요.
            </p>
            <p className="hint">
              내 컴퓨터에 설치된 Claude Code를 수정 없이 그대로 실행하고, 로그인과 사용량은 Claude Code가 직접
              처리합니다(HelpMyDoc은 로그인 정보를 읽거나 저장하지 않습니다). 본인 PC에서 본인 계정으로만 사용하세요. 이
              앱을 서버로 호스팅해 다른 사람이 쓰게 하거나 구독을 공유하는 것은 Anthropic 사용 정책에 어긋납니다.
            </p>
          </>
        )}

        {draft.provider === "codex" && (
          <>
            <div className="risk" role="note">
              <strong>⚠ 실험 기능입니다. 켜기 전에 읽어 주세요.</strong>
              <ul>
                <li>
                  OpenAI가 "공식 Codex CLI를 다른 앱이 대신 실행하는 방식"을 명시적으로 허용하는지는 확인하지
                  못했습니다. 약관 해석과 책임은 사용자에게 있습니다.
                </li>
                <li>
                  Codex는 도구를 완전히 끌 수 없습니다. 그래서 <b>파일 수정이 막힌 읽기 전용 샌드박스</b>에서, 도구를
                  쓰지 말라는 지침과 함께 실행합니다. 그래도 PDF 속 악성 문구가 모델에게 내 PC의 파일을 읽게 시도할
                  가능성은 남으므로 <b>출처를 모르는 PDF에는 쓰지 마세요.</b> 모델이 도구를 쓰려 하면 답변 아래에 알려
                  드립니다.
                </li>
                <li>본인 PC에서 본인 계정으로만 사용하세요. 서버로 호스팅하거나 구독을 공유하지 마세요.</li>
              </ul>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.enableCodex}
                  onChange={(e) => {
                    set({ enableCodex: e.target.checked });
                    if (e.target.checked) onRefreshBridge("codex");
                  }}
                />
                위 내용을 이해했고, ChatGPT(Codex) 연결을 켭니다
              </label>
            </div>

            {draft.enableCodex && (
              <>
                <StatusLine line={cliLine("Codex", codex)} onRefresh={() => onRefreshBridge("codex")} />
                {!cliLine("Codex", codex).ok && codex?.bridgeReachable && (
                  <div className="step-body">
                    {!codex.available && <CommandBox label="Codex 설치 (터미널)" command="npm i -g @openai/codex" />}
                    {codex.available && codex.loggedIn === false && (
                      <CommandBox label="ChatGPT 계정으로 로그인 (터미널)" command="codex login" />
                    )}
                    <p className="hint">
                      자세한 안내는{" "}
                      <a href="https://developers.openai.com/codex/auth" target="_blank" rel="noreferrer">
                        OpenAI Codex 문서
                      </a>
                      를 보세요. 설치·로그인을 마치고 돌아오면 자동으로 다시 확인합니다.
                    </p>
                  </div>
                )}
                <label>
                  모델 (선택)
                  <input
                    value={draft.codexModel}
                    placeholder="비워 두면 Codex 기본 모델"
                    onChange={(e) => set({ codexModel: e.target.value })}
                  />
                </label>
                <p className="hint">
                  Codex가 알고 있는 모델 이름을 직접 적습니다. 모르면 비워 두세요. 로그인과 사용량은 Codex가 직접
                  처리하며 HelpMyDoc은 로그인 정보를 읽거나 저장하지 않습니다.
                </p>
              </>
            )}
          </>
        )}

        {draft.provider === "api" && (
          <>
            <label>
              Anthropic API 키
              <input
                type="password"
                autoComplete="off"
                placeholder="sk-ant-..."
                value={draft.apiKey}
                onChange={(e) => set({ apiKey: e.target.value })}
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
              <select value={draft.model} onChange={(e) => set({ model: e.target.value })}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {draft.provider === "openai" && (
          <>
            <label>
              OpenAI API 키
              <input
                type="password"
                autoComplete="off"
                placeholder="sk-..."
                value={draft.openaiKey}
                onChange={(e) => set({ openaiKey: e.target.value })}
                autoFocus
              />
            </label>
            <p className="hint">
              키는 이 PC에만 저장되고 OpenAI API(api.openai.com)로만 전송됩니다.{" "}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
                OpenAI 플랫폼
              </a>
              에서 발급하세요. ChatGPT 구독과는 별개의 종량제 결제입니다.
            </p>
            <div className="field">
              모델
              <ModelPicker
                apiKey={draft.openaiKey}
                value={draft.openaiModel}
                onChange={(m) => set({ openaiModel: m })}
                load={listOpenAIModels}
              />
            </div>
          </>
        )}

        {draft.provider === "gemini" && (
          <>
            <label>
              Gemini API 키
              <input
                type="password"
                autoComplete="off"
                placeholder="AIza..."
                value={draft.geminiKey}
                onChange={(e) => set({ geminiKey: e.target.value })}
                autoFocus
              />
            </label>
            <p className="hint">
              키는 이 PC에만 저장되고 Google(generativelanguage.googleapis.com)로만 전송됩니다.{" "}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                Google AI Studio
              </a>
              에서 발급하세요. 무료 티어를 쓰면 입력 내용이 Google 제품 개선에 사용될 수 있으니 Google 정책을
              확인하세요.
            </p>
            <div className="field">
              모델
              <ModelPicker
                apiKey={draft.geminiKey}
                value={draft.geminiModel}
                onChange={(m) => set({ geminiModel: m })}
                load={listGeminiModels}
              />
            </div>
            <p className="hint">
              Google 계정 로그인(구독) 방식은 Google 약관이 서드파티 도구의 접근을 금지하고 있어 지원하지 않습니다.
            </p>
          </>
        )}

        <label>
          AI에게 보여줄 페이지 범위
          <select value={draft.radius} onChange={(e) => set({ radius: Number(e.target.value) })}>
            <option value={0}>현재 페이지만</option>
            <option value={1}>현재 페이지 ±1쪽 (기본)</option>
            <option value={2}>현재 페이지 ±2쪽</option>
            <option value={4}>현재 페이지 ±4쪽 (토큰 많이 사용)</option>
          </select>
        </label>
        <p className="hint">
          질문할 때마다 이 범위의 텍스트가 선택한 AI에게 전송됩니다. 범위가 넓을수록 사용량이 늘어납니다.
        </p>

        <label className="check">
          <input
            type="checkbox"
            checked={draft.verifyOnLaunch}
            onChange={(e) => set({ verifyOnLaunch: e.target.checked })}
          />
          실행할 때 Claude Code 연결을 실제로 확인하기
        </label>
        <p className="hint">
          재부팅 등으로 로그인이 풀렸는지 알아내려고, 실행할 때 아주 짧은 요청("OK"라고만 답하게)을 한 번 보내 봅니다.
          사용량은 거의 쓰지 않으며, 풀렸다면 바로 로그인 화면을 띄웁니다. 끄면 질문할 때까지 풀렸는지 모를 수 있어요.
        </p>

        <label className="check">
          <input
            type="checkbox"
            checked={draft.showPageMarker}
            onChange={(e) => set({ showPageMarker: e.target.checked })}
          />
          문서 화면에 "지금 보는 쪽" 표시하기 (테두리와 이름표)
        </label>
        <p className="hint">
          여러 쪽이 위아래로 이어져 보일 때, AI가 지금 어느 쪽을 기준으로 읽는지 한눈에 알 수 있어요. 진한 테두리가 지금
          보는 쪽, 점선 테두리가 함께 읽는 앞뒤 쪽입니다.
        </p>

        <label className="check">
          <input type="checkbox" checked={draft.reopenLast} onChange={(e) => set({ reopenLast: e.target.checked })} />
          앱을 켜면 마지막으로 열었던 문서를 자동으로 열기
        </label>
        <p className="hint">
          데스크톱 앱에서만 동작해요. 문서 파일이 아니라 <b>파일 경로</b>(최근 8개)만 이 PC에 기억하고, 켤 때 그 경로의
          파일을 다시 읽어요. 파일을 옮기거나 지웠으면 열지 않고 알려 줍니다. 마지막으로 보던 쪽에서 이어집니다.
        </p>

        <label className="check">
          <input type="checkbox" checked={draft.saveHistory} onChange={(e) => set({ saveHistory: e.target.checked })} />
          문서별 대화·메모·형광펜·스캔 결과·마지막 페이지를 이 PC에 저장
        </label>
        <p className="hint">
          같은 PDF를 다시 열면 이전 대화와 보던 페이지가 이어집니다. 문서는 파일 이름이 아니라 내용으로 구분하며, PDF
          파일과 본문 텍스트는 저장하지 않고 대화·마지막 페이지·파일 이름만 이 PC 안에 저장합니다. 끄면 새 기록은
          저장되지 않습니다.
        </p>
        <HistoryManager />

        <p className="hint">
          HelpMyDoc v{__APP_VERSION__} · 빌드 {__APP_COMMIT__}
        </p>
        <UpdateCheck />

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

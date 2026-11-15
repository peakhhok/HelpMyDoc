import { useEffect, useState } from "react";
import type { BridgeStatus } from "../lib/bridgeClient";
import {
  LOGIN_COMMAND,
  SETUP_DOC_URL,
  describeAuth,
  evaluateSetup,
  guessPlatform,
  installCommands,
} from "../lib/setup";
import { MODELS, type Settings } from "../lib/settings";

interface Props {
  /** first-run: 처음 실행 / repair: 설정은 마쳤지만 Claude Code 연결이 필요한 경우 */
  mode: "first-run" | "repair";
  settings: Settings;
  bridge: BridgeStatus | null;
  /** silent 면 화면을 '확인 중'으로 바꾸지 않고 조용히 다시 확인한다 */
  onRefresh: (silent?: boolean) => void;
  /** 선택한 연결 방식을 저장하고 시작한다 */
  onComplete: (patch: Partial<Settings>) => void;
  /** AI 없이 PDF만 먼저 보기 */
  onSkip: () => void;
}

type RowState = "ok" | "bad" | "wait" | "checking";
const ICON: Record<RowState, string> = { ok: "✔", bad: "✖", wait: "○", checking: "…" };

function Row({
  state,
  title,
  detail,
  children,
}: {
  state: RowState;
  title: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`step ${state}`}>
      <div className="step-head">
        <span className="step-icon" aria-hidden>
          {ICON[state]}
        </span>
        <strong>{title}</strong>
        {detail && <span className="muted small-text">{detail}</span>}
      </div>
      {children && <div className="step-body">{children}</div>}
    </div>
  );
}

function CommandBox({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cmd">
      <div className="small-text muted">{label}</div>
      <div className="cmd-row">
        <code>{command}</code>
        <button
          type="button"
          className="ghost small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(command);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* 클립보드를 못 쓰면 직접 선택해서 복사 */
            }
          }}
        >
          {copied ? "복사됨" : "복사"}
        </button>
      </div>
    </div>
  );
}

export function SetupScreen({ mode, settings, bridge, onRefresh, onComplete, onSkip }: Props) {
  const [tab, setTab] = useState<"claude-code" | "api">(mode === "first-run" ? "claude-code" : settings.provider);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState<string>(settings.model);
  const setup = evaluateSetup(bridge);

  // 설치·로그인을 마치면 자동으로 알아채도록 주기적으로 조용히 다시 확인한다.
  useEffect(() => {
    if (tab !== "claude-code" || setup.step === "ready") return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") onRefresh(true);
    }, 2500);
    return () => clearInterval(id);
  }, [tab, setup.step, onRefresh]);

  const platform = bridge?.platform ?? guessPlatform(navigator.userAgent);
  const checking = setup.step === "checking";
  const bridgeOk = !checking && setup.step !== "bridge";
  const installed = bridgeOk && setup.step !== "install";
  const loggedIn = installed && setup.step !== "login";

  // 이미 설정을 마친 사용자가 실행할 때는 점검이 끝나기 전까지 간단한 확인 화면만 보여준다.
  // ('연결이 필요해요' 같은 제목이 잠깐 비치면 문제가 있는 것처럼 보인다)
  if (mode === "repair" && checking && tab === "claude-code") {
    return (
      <div className="setup" role="status">
        <div className="setup-card splash">
          <div className="big">📄</div>
          <p className="muted">Claude Code 연결을 확인하는 중…</p>
        </div>
      </div>
    );
  }

  const rowState = (done: boolean, failing: boolean): RowState =>
    checking ? "checking" : done ? "ok" : failing ? "bad" : "wait";

  return (
    <div className="setup">
      <div className="setup-card">
        <h1>{mode === "first-run" ? "HelpMyDoc 시작하기" : "Claude Code 연결이 필요해요"}</h1>
        <p className="muted">
          {mode === "first-run"
            ? "PDF를 보면서 AI에게 바로 질문하려면 Claude 연결이 필요합니다. 어떤 방식으로 쓸지 골라 주세요."
            : "지금 연결 방식은 '내 PC의 Claude Code'인데 아직 사용할 수 없는 상태입니다. 아래 단계를 마치면 자동으로 이어집니다."}
        </p>

        <div className="provider-tabs" role="radiogroup" aria-label="연결 방식">
          <button
            type="button"
            role="radio"
            aria-checked={tab === "claude-code"}
            className={tab === "claude-code" ? "tab on" : "tab"}
            onClick={() => setTab("claude-code")}
          >
            Claude 구독으로 쓰기
            <span className="tab-sub">내 PC의 Claude Code</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={tab === "api"}
            className={tab === "api" ? "tab on" : "tab"}
            onClick={() => setTab("api")}
          >
            API 키로 쓰기
            <span className="tab-sub">사용량만큼 과금</span>
          </button>
        </div>

        {tab === "claude-code" ? (
          <>
            <div className="steps">
              <Row
                state={rowState(bridgeOk, setup.step === "bridge")}
                title="이 PC와 연결"
                detail={bridgeOk ? "연결됨" : undefined}
              >
                {setup.step === "bridge" && (
                  <p>
                    이 화면은 내 PC의 Claude Code에 연결할 수 없는 곳에서 열려 있습니다. HelpMyDoc 데스크톱 앱, 또는 내
                    PC에서 <code>npm run dev</code> / <code>npm start</code>로 실행해야 합니다. 웹에 올려 둔
                    페이지에서는 <b>API 키로 쓰기</b>만 가능해요.
                  </p>
                )}
              </Row>

              <Row
                state={rowState(installed, setup.step === "install")}
                title="Claude Code 설치"
                detail={installed ? bridge?.version : undefined}
              >
                {setup.step === "install" && (
                  <>
                    <p>
                      Claude Code가 설치되어 있지 않아요. 터미널에 아래 공식 명령을 붙여 넣어 설치하세요. 설치가 끝나면
                      이 화면이 자동으로 알아챕니다.
                    </p>
                    {installCommands(platform).map((c) => (
                      <CommandBox key={c.label} label={c.label} command={c.command} />
                    ))}
                    <p className="small-text muted">
                      <a href={SETUP_DOC_URL} target="_blank" rel="noreferrer">
                        공식 설치 안내
                      </a>
                      · 사용하려면 Claude Pro/Max 등 유료 구독이 필요합니다. (무료 플랜은 Claude Code를 쓸 수 없어요)
                    </p>
                  </>
                )}
              </Row>

              <Row
                state={rowState(loggedIn, setup.step === "login")}
                title="Claude 계정 로그인"
                detail={loggedIn ? describeAuth(setup.authKind, bridge?.authMethod) : undefined}
              >
                {setup.step === "login" && (
                  <>
                    <p>
                      설치는 되어 있지만 로그인이 필요해요. 터미널에서 아래 명령을 실행하고, 열리는 브라우저에서{" "}
                      <b>구독(Pro/Max) 계정</b>으로 로그인하세요. 로그인은 Claude Code가 직접 처리하며, HelpMyDoc은
                      로그인 정보를 보지 않습니다.
                    </p>
                    <CommandBox label="터미널에서 실행" command={LOGIN_COMMAND} />
                  </>
                )}
                {setup.step === "ready" && setup.warnings.length > 0 && (
                  <>
                    {setup.warnings.map((w) => (
                      <p key={w} className="warn-text">
                        ⚠ {w}
                      </p>
                    ))}
                  </>
                )}
              </Row>
            </div>

            <div className="setup-actions">
              <button type="button" className="ghost" onClick={() => onRefresh()}>
                다시 확인
              </button>
              <span className="spacer" />
              <button type="button" className="ghost" onClick={onSkip}>
                {mode === "first-run" ? "나중에 설정하고 PDF만 보기" : "일단 PDF만 보기"}
              </button>
              <button
                type="button"
                className="primary"
                disabled={setup.step !== "ready"}
                onClick={() => onComplete({ provider: "claude-code", onboarded: true })}
              >
                {mode === "first-run" ? "시작하기" : "계속"}
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="field">
              Anthropic API 키
              <input
                type="password"
                autoComplete="off"
                placeholder="sk-ant-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoFocus
              />
            </label>
            <p className="hint">
              키는 이 PC에만 저장되고 Anthropic API로만 전송됩니다.{" "}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                Anthropic Console
              </a>
              에서 발급하세요. (구독과는 별개의 종량제 결제입니다)
            </p>
            <label className="field">
              모델
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="setup-actions">
              <span className="spacer" />
              <button type="button" className="ghost" onClick={onSkip}>
                {mode === "first-run" ? "나중에 설정하고 PDF만 보기" : "일단 PDF만 보기"}
              </button>
              <button
                type="button"
                className="primary"
                disabled={!apiKey.trim()}
                onClick={() => onComplete({ provider: "api", apiKey: apiKey.trim(), model, onboarded: true })}
              >
                {mode === "first-run" ? "시작하기" : "이 방식으로 계속"}
              </button>
            </div>
          </>
        )}

        <p className="small-text muted setup-foot">
          질문할 때마다 현재 페이지 주변의 텍스트가 선택한 방식의 Claude로 전송됩니다. 설정은 언제든 ⚙ 설정에서 바꿀 수
          있어요.
        </p>
      </div>
    </div>
  );
}

// CLI 어댑터: 사용자 PC에 설치된 공식 CLI(Claude Code, Codex)를 "순수 채팅"으로 실행하는 방법을 정의한다.
//
// 공통 원칙
//  - 공식 프로그램을 수정 없이 그대로 실행하고, 로그인은 그 프로그램이 직접 처리한다.
//  - 이 앱은 로그인 토큰/세션을 읽거나 저장하거나 중계하지 않는다.
//  - 질문 하나에 프로세스를 한 번 실행하고 끝난다. (세션을 디스크에 남기지 않는다)
//
// 어댑터 계약
//  id, label, command(실행 이름), shimScript?
//  status({ run, cli }) → 상태 객체 (available/version/loggedIn/authMethod …)
//  buildArgs({ system, model }) → 인자 배열
//  buildStdin({ prompt, system }) → 표준입력으로 넘길 문자열
//  newState() / handle(obj, state) → 화면으로 보낼 이벤트 배열 / finish(state, { code, stderr }) → 마지막 이벤트 배열
import { resolveCli } from "./claude-path.mjs";

/** 터미널 색상 등 ANSI 제어 문자를 지운다. */
export function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g, "");
}

/** Claude Code 의 한도 상태 값 → 화면용 */
const LIMIT_STATUS = { allowed: "ok", allowed_warning: "warning", rejected: "rejected" };

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** 한도 창 하나에서 사용률(0~1)과 초기화 시각(epoch 초)만 꺼낸다. 낯선 형식이면 undefined. */
function pickWindow(w) {
  if (!w || typeof w.utilization !== "number" || !Number.isFinite(w.utilization)) return undefined;
  // 0~1 비율이 기본이지만, 퍼센트(0~100)로 오는 버전에 대비해 1보다 크면 100으로 나눈다.
  const utilization = Math.min(1, Math.max(0, w.utilization > 1 ? w.utilization / 100 : w.utilization));
  return { utilization, resetsAt: typeof w.resetsAt === "number" ? w.resetsAt : undefined };
}

/* ------------------------------------------------------------------ Claude Code */

export const claudeAdapter = {
  id: "claude-code",
  label: "Claude Code",
  command: "claude",
  // "로그인 시도하기" 버튼이 실행하는 고정 명령. 사용자 입력은 인자에 들어가지 않는다.
  // (브라우저에서 로그인하면 Claude Code 가 직접 마무리하므로 앱은 입력도 토큰도 다루지 않는다)
  loginArgs: ["auth", "login"],

  async status({ run, cli }) {
    // platform: 화면에서 OS 에 맞는 설치 안내를 보여주기 위함
    // apiKeyEnv: 환경변수 API 키가 있으면 Claude Code 가 구독 대신 API 과금으로 동작할 수 있어 경고하기 위함 (값은 노출하지 않는다)
    const base = { platform: process.platform, apiKeyEnv: !!process.env.ANTHROPIC_API_KEY };
    const v = await run(cli, ["--version"]);
    if (!v.ok) return { ...base, available: false };
    const out = { ...base, available: true, version: v.stdout.trim().split("\n")[0] };
    const a = await run(cli, ["auth", "status", "--json"]);
    try {
      const j = JSON.parse(a.stdout);
      // 계정 식별 정보는 노출하지 않고 로그인 여부와 방식만 전달한다.
      out.loggedIn = !!j.loggedIn;
      out.authMethod = j.authMethod ?? null;
    } catch {
      out.loggedIn = undefined;
    }
    return out;
  },

  // 순수 채팅 용도: 파일/명령 도구, MCP, 슬래시 명령, 프로젝트 설정을 모두 끈다.
  buildArgs({ system, model }) {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--tools",
      "",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--setting-sources",
      "user",
    ];
    if (typeof system === "string" && system) args.push("--append-system-prompt", system);
    if (model) args.push("--model", model);
    return args;
  },

  buildStdin: ({ prompt }) => prompt,

  newState: () => ({ streamed: false, lastAssistant: "", failure: "" }),

  handle(e, state) {
    const out = [];
    if (e.type === "stream_event" && e.event?.type === "content_block_delta" && e.event.delta?.type === "text_delta") {
      state.streamed = true;
      out.push({ t: "text", text: e.event.delta.text });
    } else if (e.type === "assistant") {
      state.lastAssistant = (e.message?.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
    } else if (e.type === "rate_limit_event") {
      // 구독 한도 사용률(5시간/7일). 사용률과 초기화 시각만 전달하고 그 밖의 필드(세션 ID 등)는 버린다.
      const info = e.rate_limit_info;
      const w = info?.unifiedWindows;
      let fiveHour = pickWindow(w?.five_hour);
      let sevenDay = pickWindow(w?.seven_day);
      // 옛 버전(예: 2.1.220)은 unifiedWindows 없이 이벤트마다 창 하나(rateLimitType + utilization)만 알려준다.
      if (!fiveHour && !sevenDay && info && typeof info.utilization === "number") {
        const one = pickWindow({ utilization: info.utilization, resetsAt: info.resetsAt });
        if (info.rateLimitType === "five_hour") fiveHour = one;
        else if (info.rateLimitType === "seven_day") sevenDay = one;
      }
      // 사용률 숫자가 없는 버전도 한도 상태(정상/경고/초과)는 알 수 있다.
      const status = LIMIT_STATUS[info?.status];
      if (fiveHour || sevenDay || status) out.push({ t: "limits", fiveHour, sevenDay, status });
    } else if (e.type === "result") {
      if (e.is_error) state.failure = String(e.result ?? "Claude Code 오류");
      const u = e.usage;
      if (u && typeof u === "object") {
        // 이번 답변의 토큰 수 (입력은 캐시된 분량 포함). 비용(total_cost_usd)은 정가 환산값이라 구독에서는 의미가 없어 보내지 않는다.
        const inputTokens = num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens);
        out.push({ t: "usage", inputTokens, outputTokens: num(u.output_tokens) });
      }
    }
    return out;
  },

  finish(state, { code, stderr }) {
    if (!state.streamed && state.lastAssistant && !state.failure) return [{ t: "text", text: state.lastAssistant }];
    if (!state.streamed && (state.failure || code !== 0)) {
      return [
        {
          t: "error",
          message: state.failure || stderr.trim().slice(0, 400) || `claude 가 코드 ${code} 로 종료되었습니다.`,
        },
      ];
    }
    return [];
  },

  notFoundMessage: "claude 명령을 찾을 수 없습니다. Claude Code 를 설치해 주세요.",
};

/* ------------------------------------------------------------------ Codex (ChatGPT 로그인) */

/** 모델이 도구를 쓰려 했는지 알아보는 Codex 항목 종류 (답변 메시지/추론 이외의 모든 것) */
const CODEX_TOOL_ITEMS = new Set(["command_execution", "file_change", "mcp_tool_call", "web_search"]);

/** Codex 에게 도구를 쓰지 말라고 알리는 지침. (Codex 는 도구를 완전히 끌 수 없어 지침 + 읽기 전용 샌드박스로 제한한다) */
const CODEX_GUARD =
  "Do not run shell commands, read or write files, browse the web, or call any tool. " +
  "Answer using only the text provided in this conversation.";

export const codexAdapter = {
  id: "codex",
  label: "Codex",
  command: "codex",
  // 윈도우에서 npm 이 만든 codex.cmd 옆에 있는 실제 진입점
  shimScript: "node_modules/@openai/codex/bin/codex.js",

  async status({ run, cli }) {
    const base = { platform: process.platform };
    const v = await run(cli, ["--version"]);
    if (!v.ok) return { ...base, available: false };
    const out = { ...base, available: true, version: v.stdout.trim().split("\n")[0] };
    // `codex login status`: 로그인 안 됨 → 종료 코드 1 + "Not logged in", 로그인됨 → 종료 코드 0
    const a = await run(cli, ["login", "status"]);
    const text = `${a.stdout}\n${a.stderr}`;
    if (a.code === 0 && !/not logged in/i.test(text)) out.loggedIn = true;
    else if (/not logged in/i.test(text)) out.loggedIn = false;
    else out.loggedIn = undefined; // 형식이 낯설면 막지 않고 시도해 본다
    // 계정 정보는 전달하지 않고 로그인 방식만 알린다.
    out.authMethod = /chatgpt/i.test(text) ? "chatgpt" : /api[ -]?key/i.test(text) ? "api_key" : null;
    return out;
  },

  // 읽기 전용 샌드박스, 세션 저장 안 함, 사용자 설정(MCP/프로필)과 규칙 무시, git 저장소 검사 생략.
  buildArgs({ model }) {
    const args = [
      "exec",
      "--json",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "-s",
      "read-only",
    ];
    if (model) args.push("-m", model);
    return args;
  },

  // Codex 는 시스템 프롬프트 옵션이 없어 지침을 프롬프트 앞에 붙인다. (프롬프트는 인자가 아니라 표준입력으로 넘긴다)
  buildStdin: ({ prompt, system }) => `${system ? `${system}\n\n` : ""}${CODEX_GUARD}\n\n${prompt}`,

  newState: () => ({ texts: [], tools: 0, failure: "" }),

  handle(e, state) {
    const out = [];
    const item = e.item;
    if (e.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") {
      // Codex 는 토큰 단위 스트리밍 없이 완성된 메시지를 한 번에 준다.
      out.push({ t: "text", text: (state.texts.length ? "\n\n" : "") + item.text });
      state.texts.push(item.text);
    } else if (e.type === "item.completed" && item && CODEX_TOOL_ITEMS.has(item.type)) {
      state.tools++;
    } else if (e.type === "turn.completed" && e.usage && typeof e.usage === "object") {
      out.push({ t: "usage", inputTokens: num(e.usage.input_tokens), outputTokens: num(e.usage.output_tokens) });
    } else if (e.type === "turn.failed") {
      state.failure = String(e.error?.message ?? "Codex 오류");
    } else if (e.type === "error") {
      state.failure = String(e.message ?? "Codex 오류");
    }
    return out;
  },

  finish(state, { code, stderr }) {
    const out = [];
    if (state.tools > 0) {
      out.push({
        t: "notice",
        text: `Codex가 도구를 ${state.tools}번 사용하려 했습니다. (읽기 전용 샌드박스에서 실행됨)`,
      });
    }
    if (!state.texts.length && (state.failure || code !== 0)) {
      out.push({
        t: "error",
        message: state.failure || stderr.trim().slice(0, 400) || `codex 가 코드 ${code} 로 종료되었습니다.`,
      });
    }
    return out;
  },

  notFoundMessage: "codex 명령을 찾을 수 없습니다. Codex CLI 를 설치해 주세요.",
};

export const adapters = { [claudeAdapter.id]: claudeAdapter, [codexAdapter.id]: codexAdapter };

/** 어댑터의 실행 명령을 PATH 등에서 찾는다. */
export function resolveAdapterCommand(adapter) {
  return resolveCli(adapter.command, { shimScript: adapter.shimScript });
}

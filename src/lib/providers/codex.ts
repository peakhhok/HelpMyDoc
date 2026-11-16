import { SYSTEM_PROMPT } from "../anthropicApi";
import { streamCli } from "../bridgeClient";
import { toTranscript } from "./claudeCode";
import type { Provider } from "./types";

/**
 * 내 PC에 설치·로그인된 Codex CLI(ChatGPT 구독)를 로컬 브리지로 실행한다. (실험 기능: 기본은 꺼짐)
 * 로그인은 Codex 가 직접 처리한다. Codex 는 도구를 완전히 끌 수 없어 읽기 전용 샌드박스 + 지침으로 제한한다.
 */
export const codexProvider: Provider = {
  id: "codex",
  label: "Codex CLI",
  short: "ChatGPT",
  group: "subscription",
  describe: (s) => s.codexModel || "기본 모델",
  unavailableReason: ({ settings, codex }) => {
    if (!settings.enableCodex) {
      return "ChatGPT(Codex) 연결이 꺼져 있습니다. 설정에서 안내를 확인하고 켜 주세요.";
    }
    if (!codex) return "Codex 연결 상태를 확인하는 중입니다.";
    if (!codex.bridgeReachable) return "이 PC와 연결할 수 없습니다. 데스크톱 앱 또는 내 PC에서 실행해야 합니다.";
    if (!codex.available) {
      return codex.shimOnly
        ? "Codex 실행 파일을 찾지 못했습니다. (npm 래퍼 codex.cmd 만 있고 실제 진입점을 찾을 수 없음)"
        : "Codex CLI를 찾을 수 없습니다. 설정에서 설치 방법을 확인해 주세요.";
    }
    if (codex.loggedIn === false) return "Codex에 로그인이 필요합니다. 터미널에서 `codex login`을 실행해 주세요.";
    return null;
  },
  stream: (settings, req) =>
    streamCli("codex", {
      prompt: toTranscript(req.history, req.prompt),
      system: SYSTEM_PROMPT,
      model: settings.codexModel,
      signal: req.signal,
      onText: req.onText,
      onUsage: req.onUsage,
      onNotice: req.onNotice,
    }),
};

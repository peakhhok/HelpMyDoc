import type { ProviderId } from "../settings";
import { apiProvider } from "./api";
import { claudeCodeProvider } from "./claudeCode";
import { codexProvider } from "./codex";
import { geminiProvider } from "./gemini";
import { openaiProvider } from "./openai";
import type { Provider } from "./types";

export type { Provider, ProviderEnv, ProviderRequest } from "./types";

export const PROVIDERS: Record<ProviderId, Provider> = {
  "claude-code": claudeCodeProvider,
  codex: codexProvider,
  api: apiProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
};

/** 화면에 보여주는 순서 */
export const PROVIDER_ORDER: ProviderId[] = ["claude-code", "codex", "api", "openai", "gemini"];

export function getProvider(id: ProviderId): Provider {
  return PROVIDERS[id] ?? apiProvider;
}

/** 전환 목록에 보여줄 이름 (예: "Claude (구독)", "ChatGPT (API 키)") */
export function providerTitle(p: Provider): string {
  return `${p.short} (${p.group === "subscription" ? "구독" : "API 키"})`;
}

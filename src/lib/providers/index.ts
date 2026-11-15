import type { ProviderId } from "../settings";
import { apiProvider } from "./api";
import { claudeCodeProvider } from "./claudeCode";
import type { Provider } from "./types";

export type { Provider, ProviderEnv, ProviderRequest } from "./types";

export const PROVIDERS: Record<ProviderId, Provider> = {
  api: apiProvider,
  "claude-code": claudeCodeProvider,
};

export function getProvider(id: ProviderId): Provider {
  return PROVIDERS[id] ?? apiProvider;
}

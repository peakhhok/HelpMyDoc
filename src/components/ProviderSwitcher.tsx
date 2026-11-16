import { PROVIDER_ORDER, PROVIDERS, providerTitle, type ProviderEnv } from "../lib/providers";
import type { ProviderId } from "../lib/settings";

interface Props {
  env: ProviderEnv;
  /** 준비된 연결로 바꾼다 */
  onSwitch: (id: ProviderId) => void;
  /** 준비가 안 된 연결을 골랐을 때 — 그 연결의 설정을 연다 */
  onNeedSetup: (id: ProviderId) => void;
}

/** 채팅창 위의 연결 전환 목록. 로그인·키가 준비된 연결은 ● 로 표시되고 바로 바뀐다. */
export function ProviderSwitcher({ env, onSwitch, onNeedSetup }: Props) {
  const ready = (id: ProviderId) => PROVIDERS[id].unavailableReason(env) === null;
  const group = (g: "subscription" | "api") => PROVIDER_ORDER.filter((id) => PROVIDERS[id].group === g);

  return (
    <select
      className="provider-select"
      aria-label="AI 연결 방식"
      value={env.settings.provider}
      onChange={(e) => {
        const id = e.target.value as ProviderId;
        if (ready(id)) onSwitch(id);
        else onNeedSetup(id);
      }}
    >
      {(["subscription", "api"] as const).map((g) => (
        <optgroup key={g} label={g === "subscription" ? "구독 (내 PC의 프로그램)" : "API 키"}>
          {group(g).map((id) => (
            <option key={id} value={id} title={PROVIDERS[id].unavailableReason(env) ?? undefined}>
              {ready(id) ? "● " : "○ "}
              {providerTitle(PROVIDERS[id])}
              {ready(id) ? "" : " — 설정 필요"}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

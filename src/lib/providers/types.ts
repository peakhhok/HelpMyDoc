import type { ChatMessage } from "../anthropicApi";
import type { BridgeStatus, ToolEvent } from "../bridgeClient";
import type { ProviderId, Settings } from "../settings";
import type { TurnUsage, UsageLimits } from "../usage";

export interface ProviderRequest {
  /** 이전 턴(질문 원문과 답변만; 문서 문맥은 포함하지 않음) */
  history: ChatMessage[];
  /** 이번 턴: 현재 페이지 문맥 + 질문 */
  prompt: string;
  signal: AbortSignal;
  onText: (delta: string) => void;
  /** 답변이 끝났을 때 이번 답변의 토큰 수 (알려주는 방식만) */
  onUsage?: (usage: TurnUsage) => void;
  /** 구독 한도 사용률 (알려주는 방식만) */
  onLimits?: (limits: UsageLimits) => void;
  /** 화면에 알릴 안내 (예: Codex 가 도구를 쓰려 했음) */
  onNotice?: (text: string) => void;
  /** 프로젝트 폴더 모드에서 AI 가 파일을 읽거나 쓸 때 (Claude Code 만) */
  onTool?: (tool: ToolEvent) => void;
  /** false 면 연결된 프로젝트 폴더를 쓰지 않는다 (문서 스캔처럼 폴더가 필요 없는 요청). 기본은 true */
  useProject?: boolean;
}

export interface ProviderEnv {
  settings: Settings;
  /** Claude Code 브리지 상태 (아직 확인 전이면 null) */
  bridge: BridgeStatus | null;
  /** Codex 브리지 상태 (아직 확인 전이면 null) */
  codex: BridgeStatus | null;
}

/**
 * AI 연결 방식 하나를 나타낸다. 새 AI(로컬 모델 …)를 추가하려면
 *  1. 이 인터페이스를 구현한 파일을 src/lib/providers/ 에 만들고
 *  2. index.ts 의 PROVIDERS 와 PROVIDER_ORDER 에 등록하고 settings.ts 의 ProviderId 에 id 를 더하고
 *  3. 설정 UI(SettingsDialog)에 해당 방식의 입력란을 추가하면 된다.
 */
export interface Provider {
  id: ProviderId;
  /** 설정 화면 탭 이름 */
  label: string;
  /** 짧은 이름 (예: "Claude", "ChatGPT", "Gemini") — 채팅창 위 전환 목록에 쓴다 */
  short: string;
  /** subscription: 내 PC의 CLI(구독 로그인) / api: API 키 */
  group: "subscription" | "api";
  /** 채팅창 머리말에 보여줄 한 줄 설명 (예: 모델명) */
  describe(settings: Settings): string;
  /** 지금 사용할 수 없다면 사용자에게 보여줄 이유, 사용 가능하면 null */
  unavailableReason(env: ProviderEnv): string | null;
  /** 답변을 스트리밍으로 받는다. 중단되면 AbortError 를 던진다. */
  stream(settings: Settings, req: ProviderRequest): Promise<void>;
}

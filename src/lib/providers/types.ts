import type { ChatMessage } from "../anthropicApi";
import type { BridgeStatus } from "../bridgeClient";
import type { Settings } from "../settings";
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
}

export interface ProviderEnv {
  settings: Settings;
  /** 로컬 브리지 상태 (아직 확인 전이면 null) */
  bridge: BridgeStatus | null;
}

/**
 * AI 연결 방식 하나를 나타낸다. 새 AI(GPT, Gemini, 로컬 모델 …)를 추가하려면
 *  1. 이 인터페이스를 구현한 파일을 src/lib/providers/ 에 만들고
 *  2. index.ts 의 PROVIDERS 에 등록하고
 *  3. 설정 UI(SettingsDialog)에 해당 방식의 입력란을 추가하면 된다.
 */
export interface Provider {
  id: string;
  /** 설정 화면 탭 이름 */
  label: string;
  /** 채팅창 머리말에 보여줄 한 줄 설명 (예: 모델명) */
  describe(settings: Settings): string;
  /** 지금 사용할 수 없다면 사용자에게 보여줄 이유, 사용 가능하면 null */
  unavailableReason(env: ProviderEnv): string | null;
  /** 답변을 스트리밍으로 받는다. 중단되면 AbortError 를 던진다. */
  stream(settings: Settings, req: ProviderRequest): Promise<void>;
}

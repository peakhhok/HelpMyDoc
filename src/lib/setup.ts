import type { BridgeStatus } from "./bridgeClient";

export type SetupStep =
  /** 아직 상태를 모름 */
  | "checking"
  /** 로컬 브리지가 없음 (웹 호스팅 등) */
  | "bridge"
  /** Claude Code 미설치 */
  | "install"
  /** 설치됐지만 로그인 안 됨 */
  | "login"
  /** 사용 가능 */
  | "ready";

export type AuthKind = "subscription" | "api-key" | "other";

export interface SetupState {
  step: SetupStep;
  /** step 이 ready 일 때 인증 방식 */
  authKind: AuthKind | null;
  /** 사용에는 지장 없지만 알려야 하는 것들 */
  warnings: string[];
}

/**
 * Claude Code 가 어떤 방식으로 인증돼 있는지. 버전마다 authMethod 표기가 다를 수 있어 넓게 인식하고,
 * 낯선 값이면 "other" (화면에는 원래 값을 그대로 보여준다).
 */
export function classifyAuth(authMethod: string | null | undefined): AuthKind | null {
  if (!authMethod) return null;
  const m = authMethod.toLowerCase();
  if (/api|key/.test(m)) return "api-key";
  if (/oauth|claude[._ -]?ai|chatgpt|subscription/.test(m)) return "subscription";
  return "other";
}

/** 화면에 보여줄 한 줄 설명 */
export function describeAuth(kind: AuthKind | null, authMethod?: string | null): string {
  if (kind === "subscription") return "구독 로그인";
  if (kind === "api-key") return "API 키 인증";
  return authMethod ? `로그인됨 · ${authMethod}` : "로그인됨";
}

/** 브리지가 알려준 상태로, 사용자가 지금 어느 단계에 있는지 판단한다. */
export function evaluateSetup(status: BridgeStatus | null): SetupState {
  if (!status) return { step: "checking", authKind: null, warnings: [] };
  if (!status.bridgeReachable) return { step: "bridge", authKind: null, warnings: [] };
  if (!status.available) return { step: "install", authKind: null, warnings: [] };
  if (status.loggedIn === false) return { step: "login", authKind: null, warnings: [] };

  const authKind = classifyAuth(status.authMethod);
  const warnings: string[] = [];
  if (authKind === "api-key") {
    warnings.push("Claude Code가 구독이 아니라 API 키(사용량 과금)로 인증되어 있습니다.");
  }
  if (status.apiKeyEnv) {
    warnings.push(
      "환경변수 ANTHROPIC_API_KEY가 설정되어 있습니다. Claude Code가 구독 대신 이 키로 동작하면 API 요금이 청구될 수 있어요.",
    );
  }
  return { step: "ready", authKind, warnings };
}

export interface InstallCommand {
  label: string;
  command: string;
}

/** 공식 설치 명령 (https://code.claude.com/docs/en/setup). OS 에 맞는 것을 앞에 둔다. */
export function installCommands(platform: string | undefined): InstallCommand[] {
  if (platform === "win32") {
    return [
      { label: "Windows PowerShell", command: "irm https://claude.ai/install.ps1 | iex" },
      {
        label: "Windows CMD",
        command: "curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd",
      },
      { label: "WinGet", command: "winget install Anthropic.ClaudeCode" },
    ];
  }
  if (platform === "darwin") {
    return [
      { label: "macOS", command: "curl -fsSL https://claude.ai/install.sh | bash" },
      { label: "Homebrew", command: "brew install --cask claude-code" },
    ];
  }
  return [{ label: "Linux / WSL", command: "curl -fsSL https://claude.ai/install.sh | bash" }];
}

/** 로그인 명령 (구독 계정) */
export const LOGIN_COMMAND = "claude auth login";

export const SETUP_DOC_URL = "https://code.claude.com/docs/en/setup";

/** 브리지가 없을 때(OS 를 모를 때) 브라우저 정보로 OS 를 추정한다. */
export function guessPlatform(userAgent: string): "win32" | "darwin" | "linux" {
  if (/Windows/i.test(userAgent)) return "win32";
  if (/Mac/i.test(userAgent)) return "darwin";
  return "linux";
}

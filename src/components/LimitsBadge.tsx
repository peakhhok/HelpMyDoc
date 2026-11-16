import { formatPercent, formatRemaining, limitLevel, type LimitStatus, type UsageLimits } from "../lib/usage";

const UPDATE_HINT = "`claude update`로 Claude Code를 최신 버전으로 올리면 5시간/7일 사용률이 표시됩니다.";

const STATUS_LABEL: Record<LimitStatus, { text: string; level: "ok" | "warn" | "high" }> = {
  ok: { text: "한도 정상", level: "ok" },
  warning: { text: "한도 경고", level: "warn" },
  rejected: { text: "한도 초과", level: "high" },
};

interface Props {
  limits: UsageLimits | null;
  /** 답변을 받았는데도 한도 정보가 하나도 오지 않았음 */
  missing?: boolean;
  /** 사용 중인 Claude Code 버전 (안내용) */
  version?: string;
}

/**
 * Claude 구독 한도 사용률 (5시간 / 7일). 값은 Claude Code 가 답변마다 알려준다.
 * 옛 버전은 사용률 숫자를 알려주지 않을 수 있어, 그때는 한도 상태만 보여주거나 이유를 안내한다.
 */
export function LimitsBadge({ limits, missing, version }: Props) {
  const now = Date.now();
  const items = [
    { label: "5시간", w: limits?.fiveHour },
    { label: "7일", w: limits?.sevenDay },
  ].filter((x): x is { label: string; w: NonNullable<typeof x.w> } => !!x.w);

  if (items.length > 0) {
    return (
      <span className="limits">
        {items.map(({ label, w }) => (
          <span
            key={label}
            className={`limit ${limitLevel(w.utilization)}`}
            title={`${label} 한도 ${formatPercent(w.utilization)} 사용${w.resetsAt ? ` · 초기화 ${formatRemaining(w.resetsAt, now)}` : ""}`}
          >
            {label} {formatPercent(w.utilization)}
          </span>
        ))}
      </span>
    );
  }

  if (limits?.status) {
    const s = STATUS_LABEL[limits.status];
    return (
      <span className="limits">
        <span
          className={`limit ${s.level}`}
          title={`구독 한도 상태입니다. 이 Claude Code 버전${version ? `(${version})` : ""}은 사용률 숫자를 알려주지 않아요. ${UPDATE_HINT}`}
        >
          {s.text}
        </span>
      </span>
    );
  }

  if (missing) {
    return (
      <span
        className="muted small-text"
        title={`이 Claude Code 버전${version ? `(${version})` : ""}은 구독 한도 사용률을 알려주지 않았습니다. ${UPDATE_HINT}`}
      >
        사용률 정보 없음 (Claude Code 업데이트 필요?)
      </span>
    );
  }

  return (
    <span className="muted small-text" title="구독 한도 사용률은 첫 질문에 답이 온 뒤부터 표시됩니다">
      사용량: 첫 질문 후 표시
    </span>
  );
}

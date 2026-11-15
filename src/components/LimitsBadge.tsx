import { formatPercent, formatRemaining, limitLevel, type UsageLimits } from "../lib/usage";

/** Claude 구독 한도 사용률 (5시간 / 7일). 값은 Claude Code 가 답변마다 알려준다. */
export function LimitsBadge({ limits }: { limits: UsageLimits | null }) {
  if (!limits) {
    return (
      <span className="muted small-text" title="구독 한도 사용률은 첫 질문에 답이 온 뒤부터 표시됩니다">
        사용량: 첫 질문 후 표시
      </span>
    );
  }
  const now = Date.now();
  const items = [
    { label: "5시간", w: limits.fiveHour },
    { label: "7일", w: limits.sevenDay },
  ].filter((x): x is { label: string; w: NonNullable<typeof x.w> } => !!x.w);

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

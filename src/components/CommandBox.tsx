import { useState } from "react";

/** 터미널에 붙여 넣을 명령과 복사 버튼 */
export function CommandBox({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cmd">
      <div className="small-text muted">{label}</div>
      <div className="cmd-row">
        <code>{command}</code>
        <button
          type="button"
          className="ghost small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(command);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* 클립보드를 못 쓰면 직접 선택해서 복사 */
            }
          }}
        >
          {copied ? "복사됨" : "복사"}
        </button>
      </div>
    </div>
  );
}

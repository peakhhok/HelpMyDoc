import { useEffect, useState } from "react";
import { checkForUpdate, describeCheck, fetchUpdateState } from "../lib/updateClient";

/** 설정창의 "업데이트 확인" 버튼. 데스크톱 앱에서만 보인다. (상단 메뉴 도움말 > 업데이트 확인… 과 같은 동작) */
export function UpdateCheck() {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchUpdateState().then((s) => alive && setAvailable(s !== null));
    return () => {
      alive = false;
    };
  }, []);

  if (!available) return null;

  return (
    <div className="update-check">
      <button
        type="button"
        className="ghost small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          const r = await checkForUpdate();
          setMessage(r ? describeCheck(r) : "확인하지 못했어요. 앱을 다시 켜 보세요.");
          setBusy(false);
        }}
      >
        {busy ? "확인 중…" : "업데이트 확인"}
      </button>
      {message && (
        <span className="muted small-text" role="status">
          {message}
        </span>
      )}
    </div>
  );
}

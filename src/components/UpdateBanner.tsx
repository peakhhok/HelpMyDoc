import { useEffect, useState } from "react";
import { describeUpdate, fetchUpdateState, installUpdate, type UpdateState } from "../lib/updateClient";

const POLL_MS = 10_000;

/** 데스크톱 앱에서 새 버전이 나오면 알려주고, 누르면 설치 후 다시 시작한다. (브라우저 버전에서는 아무것도 안 보인다) */
export function UpdateBanner() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const s = await fetchUpdateState();
      if (!alive) return;
      setState(s);
      if (s) timer = setTimeout(tick, POLL_MS); // 업데이트 API 가 없는 환경이면 더 묻지 않는다
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const notice = describeUpdate(state);
  if (!notice) return null;

  return (
    <div className="banner update-banner" role="status">
      <span>{installing ? "업데이트를 설치하는 중… 앱이 곧 다시 시작됩니다." : notice.text}</span>
      {notice.action === "install" && !installing && (
        <button
          type="button"
          className="small primary"
          onClick={async () => {
            setInstalling(true);
            if (!(await installUpdate())) setInstalling(false);
          }}
        >
          다시 시작해서 업데이트
        </button>
      )}
    </div>
  );
}

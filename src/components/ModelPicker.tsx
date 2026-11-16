import { useRef, useState } from "react";

interface Props {
  /** 키가 있어야 목록을 불러올 수 있다 */
  apiKey: string;
  value: string;
  onChange: (model: string) => void;
  /** 내 키로 쓸 수 있는 모델 목록을 가져온다. (모델 이름을 앱에 고정해 두지 않기 위해) */
  load: (apiKey: string, signal: AbortSignal) => Promise<string[]>;
}

/** '모델 불러오기'로 가져온 목록에서 모델을 고른다. */
export function ModelPicker({ apiKey, value, onChange, load }: Props) {
  const [models, setModels] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const fetchModels = async () => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setError(null);
    try {
      const list = await load(apiKey.trim(), ac.signal);
      setModels(list);
      if (list.length === 0) setError("사용할 수 있는 모델을 찾지 못했습니다.");
      else if (!value || !list.includes(value)) onChange(list[0]);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 목록을 아직 안 불러왔어도 저장돼 있던 모델은 보여준다.
  const options = models ?? (value ? [value] : []);
  return (
    <div className="model-picker">
      <div className="model-row">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={options.length === 0}
          aria-label="모델"
        >
          {options.length === 0 && <option value="">모델을 불러와 주세요</option>}
          {options.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button type="button" className="ghost" onClick={fetchModels} disabled={!apiKey.trim() || busy}>
          {busy ? "불러오는 중…" : "모델 불러오기"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!apiKey.trim() && <p className="hint">API 키를 입력하면 모델 목록을 불러올 수 있어요.</p>}
    </div>
  );
}

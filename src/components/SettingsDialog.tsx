import { useState } from "react";
import { MODELS, type Settings } from "../lib/settings";

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

export function SettingsDialog({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(settings);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...draft, apiKey: draft.apiKey.trim() });
        }}
      >
        <h2>설정</h2>

        <label>
          Anthropic API 키
          <input
            type="password"
            autoComplete="off"
            placeholder="sk-ant-..."
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            autoFocus
          />
        </label>
        <p className="hint">
          키는 이 브라우저의 localStorage에만 저장되고, Anthropic API(api.anthropic.com)로만 전송됩니다. 키는{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            Anthropic Console
          </a>
          에서 발급할 수 있습니다. Claude 구독(Pro/Max) 로그인은 서드파티 앱에서 사용할 수 없어 API 키가 필요합니다.
        </p>

        <label>
          모델
          <select value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          AI에게 보여줄 페이지 범위
          <select value={draft.radius} onChange={(e) => setDraft({ ...draft, radius: Number(e.target.value) })}>
            <option value={0}>현재 페이지만</option>
            <option value={1}>현재 페이지 ±1쪽 (기본)</option>
            <option value={2}>현재 페이지 ±2쪽</option>
            <option value={4}>현재 페이지 ±4쪽 (토큰 많이 사용)</option>
          </select>
        </label>
        <p className="hint">질문할 때마다 이 범위의 텍스트가 Claude에게 전송됩니다. 범위가 넓을수록 비용이 늘어납니다.</p>

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary">
            저장
          </button>
        </div>
      </form>
    </div>
  );
}

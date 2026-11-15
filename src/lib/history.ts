import type { ChatMessage } from "./anthropicApi";

/** 화면에 보이는 메시지. 질문에는 AI 에게 실제로 보여준 문서 범위(ref)가 붙는다. */
export interface UiMessage extends ChatMessage {
  ref?: { from: number; to: number; selection: boolean; emptyPages: number[] };
}

/** AI 에게 보내는 이전 대화의 최대 메시지 수 (화면과 저장소에는 전체가 남는다) */
export const MAX_HISTORY_MESSAGES = 20;

/**
 * 이전 대화 중 최근 max 개만 남긴다. 잘린 결과가 assistant 로 시작하면
 * 질문 없는 답변이 되므로 그 메시지는 버려 항상 user 로 시작하게 한다.
 */
export function trimHistory<T extends ChatMessage>(history: T[], max = MAX_HISTORY_MESSAGES): T[] {
  if (history.length <= max) return history;
  const tail = history.slice(history.length - max);
  return tail[0]?.role === "assistant" ? tail.slice(1) : tail;
}

const PAGE_RE = /\b(?:pp?)\.\s?(\d{1,5})(?:\s?[–-]\s?\d{1,5})?/g;

/**
 * 답변 속 `p.120`, `p.120–125` 를 클릭 가능한 링크(`#page-120`)로 바꾼다.
 * 문서 범위를 벗어난 번호와 코드(``` 블록, `인라인`) 안의 텍스트는 그대로 둔다.
 */
export function linkifyPages(markdown: string, numPages: number): string {
  if (numPages < 1) return markdown;
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(PAGE_RE, (match, first: string) => {
            const n = Number(first);
            return n >= 1 && n <= numPages ? `[${match}](#page-${n})` : match;
          }),
    )
    .join("");
}

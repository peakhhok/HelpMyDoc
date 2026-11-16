/**
 * Server-Sent Events 응답 본문에서 `data:` 줄의 내용을 하나씩 돌려준다.
 * 청크가 줄 중간에서 잘려도 올바르게 이어 붙이고, `[DONE]` 과 빈 줄은 건너뛴다.
 */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const payload = (raw: string): string | null => {
    const line = raw.replace(/\r$/, "").trim();
    if (!line.startsWith("data:")) return null;
    const p = line.slice(5).trim();
    return p && p !== "[DONE]" ? p : null;
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const p = payload(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      if (p) yield p;
    }
  }
  const last = payload(buffer); // 끝 줄바꿈 없이 끝난 마지막 줄
  if (last) yield last;
}

/** 파일 내용의 SHA-256(16진수). 이름이 바뀌어도 같고, 내용이 다르면 달라진다. (보안 컨텍스트가 아니면 null) */
export async function sha256Hex(data: ArrayBuffer): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const digest = await subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

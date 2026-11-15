import { describe, expect, it } from "vitest";
import { sha256Hex } from "./docId";

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe("sha256Hex", () => {
  it("표준 테스트 벡터와 일치한다", async () => {
    expect(await sha256Hex(bytes("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("내용이 같으면 같고, 한 글자만 달라도 다르다", async () => {
    expect(await sha256Hex(bytes("same"))).toBe(await sha256Hex(bytes("same")));
    expect(await sha256Hex(bytes("same"))).not.toBe(await sha256Hex(bytes("sama")));
  });
  it("crypto.subtle 을 쓸 수 없으면 null", async () => {
    const orig = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      expect(await sha256Hex(bytes("x"))).toBeNull();
    } finally {
      if (orig) Object.defineProperty(globalThis, "crypto", orig);
    }
  });
});

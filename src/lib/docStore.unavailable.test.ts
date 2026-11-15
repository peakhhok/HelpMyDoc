// IndexedDB 를 쓸 수 없는 환경(fake-indexeddb 를 불러오지 않음)에서도 던지지 않아야 한다.
import { describe, expect, it } from "vitest";
import { clearAllDocs, deleteDoc, listDocs, loadDoc, updateDoc } from "./docStore";

describe("docStore without IndexedDB", () => {
  it("모든 함수가 조용히 아무것도 하지 않는다", async () => {
    expect(typeof indexedDB).toBe("undefined");
    await expect(updateDoc("x", { name: "a", numPages: 1 }, { lastPage: 2 })).resolves.toBeUndefined();
    expect(await loadDoc("x")).toBeUndefined();
    expect(await listDocs()).toEqual([]);
    await expect(deleteDoc("x")).resolves.toBeUndefined();
    await expect(clearAllDocs()).resolves.toBeUndefined();
  });
});

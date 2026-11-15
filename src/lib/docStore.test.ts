import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_STORED_MESSAGES, clearAllDocs, deleteDoc, listDocs, loadDoc, updateDoc } from "./docStore";

const meta = { name: "book.pdf", numPages: 300 };
const m = (content: string, role: "user" | "assistant" = "user") => ({ role, content });

beforeEach(async () => {
  await clearAllDocs();
});

describe("docStore", () => {
  it("저장한 기록을 지문(id)으로 다시 불러온다", async () => {
    await updateDoc("fp1", meta, { lastPage: 42, messages: [m("질문"), m("답", "assistant")] });
    const rec = await loadDoc("fp1");
    expect(rec).toMatchObject({ id: "fp1", name: "book.pdf", numPages: 300, lastPage: 42 });
    expect(rec?.messages).toHaveLength(2);
    expect(await loadDoc("other")).toBeUndefined();
  });

  it("이름이 바뀌어도 같은 지문이면 같은 기록이다", async () => {
    await updateDoc("fp1", { name: "old.pdf", numPages: 10 }, { messages: [m("q")] });
    await updateDoc("fp1", { name: "renamed.pdf", numPages: 10 }, { lastPage: 3 });
    const rec = await loadDoc("fp1");
    expect(rec?.name).toBe("renamed.pdf");
    expect(rec?.messages).toHaveLength(1); // 이전 대화 유지
    expect(rec?.lastPage).toBe(3);
  });

  it("같은 이름의 서로 다른 문서는 섞이지 않는다", async () => {
    await updateDoc("a", { name: "same.pdf", numPages: 1 }, { messages: [m("A")] });
    await updateDoc("b", { name: "same.pdf", numPages: 1 }, { messages: [m("B")] });
    expect((await loadDoc("a"))?.messages[0].content).toBe("A");
    expect((await loadDoc("b"))?.messages[0].content).toBe("B");
  });

  it("일부 필드만 갱신해도 나머지는 유지된다 (동시 저장 시 덮어쓰기 방지)", async () => {
    await Promise.all([
      updateDoc("fp", meta, { messages: [m("q1"), m("a1", "assistant")] }),
      updateDoc("fp", meta, { lastPage: 99 }),
    ]);
    const rec = await loadDoc("fp");
    expect(rec?.lastPage).toBe(99);
    expect(rec?.messages).toHaveLength(2);
  });

  it("기록이 없던 문서의 마지막 페이지만 저장하면 빈 대화로 만든다", async () => {
    await updateDoc("fp", meta, { lastPage: 7 });
    expect(await loadDoc("fp")).toMatchObject({ lastPage: 7, messages: [] });
  });

  it("목록은 최근에 본 문서부터, 삭제와 전체 삭제가 된다", async () => {
    await updateDoc("old", meta, { lastPage: 1 });
    await new Promise((r) => setTimeout(r, 5));
    await updateDoc("new", meta, { lastPage: 1 });
    expect((await listDocs()).map((d) => d.id)).toEqual(["new", "old"]);
    await deleteDoc("new");
    expect((await listDocs()).map((d) => d.id)).toEqual(["old"]);
    await clearAllDocs();
    expect(await listDocs()).toEqual([]);
  });

  it("너무 많은 메시지는 오래된 것부터 버린다", async () => {
    const many = Array.from({ length: MAX_STORED_MESSAGES + 10 }, (_, i) => m(String(i)));
    await updateDoc("fp", meta, { messages: many });
    const rec = await loadDoc("fp");
    expect(rec?.messages).toHaveLength(MAX_STORED_MESSAGES);
    expect(rec?.messages[0].content).toBe("10");
  });

  it("id 가 비어 있으면 아무것도 저장하지 않는다", async () => {
    await updateDoc("", meta, { lastPage: 5 });
    expect(await listDocs()).toEqual([]);
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_RECENT, createRecentDocuments, isDocPath } from "./last-document.mjs";

describe("isDocPath", () => {
  it("절대 경로의 .pdf/.pptx 만", () => {
    expect(isDocPath("/home/u/a.pdf")).toBe(true);
    expect(isDocPath("/home/u/한글 문서.PPTX")).toBe(true);
    for (const bad of [
      "a.pdf",
      "/home/u/a.txt",
      "/home/u/a.pdf.lnk",
      "/etc/passwd",
      "",
      5,
      null,
      "/x/".padEnd(2000, "a") + ".pdf",
    ]) {
      expect(isDocPath(bad as string), String(bad)).toBe(false);
    }
  });
});

describe("최근 문서 (경로만 기억)", () => {
  let root = "";
  let data = "";
  const doc = (name: string, content = "x") => {
    const p = join(root, name);
    writeFileSync(p, content);
    return p;
  };
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "helpmydoc-recent-"));
    data = join(root, "userData");
    mkdirSync(data);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("사용자가 고른 파일(seen)만 기억하고, 새 인스턴스(다음 실행)에서도 목록과 내용을 읽는다", () => {
    const a = doc("a.pdf", "AAA");
    const r1 = createRecentDocuments({ dir: data });
    expect(r1.remember(a)).toBe(false); // seen 으로 알리기 전에는 기억하지 않는다
    r1.seen(a);
    expect(r1.remember(a)).toBe(true);

    const r2 = createRecentDocuments({ dir: data }); // 앱을 다시 켠 것
    expect(r2.list().map((e) => e.name)).toEqual(["a.pdf"]);
    const read = r2.read(a);
    expect(read.ok).toBe(true);
    expect(Buffer.from((read as { data: Buffer }).data).toString()).toBe("AAA");
  });

  it("목록에서 읽어 연 문서는 다시 맨 앞으로 올릴 수 있다 (마지막으로 연 문서가 되도록)", () => {
    const r = createRecentDocuments({ dir: data });
    const first = doc("first.pdf");
    const second = doc("second.pdf");
    for (const p of [first, second]) {
      r.seen(p);
      r.remember(p);
    }
    expect(r.list()[0].name).toBe("second.pdf");
    const fresh = createRecentDocuments({ dir: data }); // 다음 실행: seen 이 비어 있다
    expect(fresh.remember(first)).toBe(false);
    expect(fresh.read(first).ok).toBe(true); // 목록에서 연다
    expect(fresh.remember(first)).toBe(true);
    expect(fresh.list()[0].name).toBe("first.pdf");
  });

  it("목록에 없는 파일은 읽지 않는다 (화면이 임의 파일을 읽지 못하게)", () => {
    const secret = doc("secret.pdf", "S");
    const r = createRecentDocuments({ dir: data });
    expect(r.read(secret)).toEqual({ ok: false, reason: "unknown" });
    r.seen(secret); // 봤다고 해도 remember 전에는 읽을 수 없다
    expect(r.read(secret)).toEqual({ ok: false, reason: "unknown" });
    expect(r.read("/etc/passwd")).toEqual({ ok: false, reason: "unknown" });
  });

  it("최근 것이 앞에 오고 같은 경로는 중복되지 않으며 8개까지만", () => {
    const r = createRecentDocuments({ dir: data });
    const paths = Array.from({ length: MAX_RECENT + 3 }, (_, i) => doc(`d${i}.pdf`));
    for (const p of paths) {
      r.seen(p);
      r.remember(p);
    }
    r.remember(paths[5]); // 다시 열기
    const names = r.list().map((e) => e.name);
    expect(names).toHaveLength(MAX_RECENT);
    expect(names[0]).toBe("d5.pdf");
    expect(new Set(names).size).toBe(MAX_RECENT);
  });

  it("파일이 없어졌으면 missing (목록에는 exists:false), 폴더·확장자 다른 것은 기억하지 않는다", () => {
    const r = createRecentDocuments({ dir: data });
    const gone = doc("gone.pdf");
    r.seen(gone);
    r.remember(gone);
    rmSync(gone);
    expect(r.read(gone)).toEqual({ ok: false, reason: "missing", name: "gone.pdf" });
    expect(r.list().find((e) => e.name === "gone.pdf")?.exists).toBe(false);
    r.forget(gone);
    expect(r.list().some((e) => e.name === "gone.pdf")).toBe(false);

    const dirAsPdf = join(root, "folder.pdf");
    mkdirSync(dirAsPdf);
    r.seen(dirAsPdf);
    expect(r.remember(dirAsPdf)).toBe(false);
    const txt = doc("a.txt");
    expect(r.seen(txt)).toBe(false);
  });

  it("목록 파일이 깨져 있어도 안전하게 빈 목록", () => {
    const d2 = join(root, "ud2");
    mkdirSync(d2);
    writeFileSync(join(d2, "recent-documents.json"), "{not json");
    expect(createRecentDocuments({ dir: d2 }).list()).toEqual([]);
    writeFileSync(
      join(d2, "recent-documents.json"),
      JSON.stringify([{ path: "relative.pdf", at: 1 }, { path: "/x/a.pdf" }, 7]),
    );
    expect(createRecentDocuments({ dir: d2 }).list()).toEqual([]);
  });
});

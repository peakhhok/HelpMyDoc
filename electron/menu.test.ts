import { describe, expect, it, vi } from "vitest";
import { buildMenuTemplate, updateDialogFor } from "./menu.mjs";

const cb = () => ({ onCheckUpdate: vi.fn(), onOpenRepo: vi.fn(), onAbout: vi.fn() });

describe("buildMenuTemplate", () => {
  it("파일·편집·보기·도움말 메뉴가 있고, 도움말에 '업데이트 확인…' 이 있다", () => {
    const c = cb();
    const t = buildMenuTemplate({ version: "0.1.5", repoUrl: "", ...c });
    expect(t.map((m) => m.label)).toEqual(["파일", "편집", "보기", "도움말"]);
    const help = t.find((m) => m.label === "도움말")!;
    const item = (help.submenu as Array<{ label?: string; click?: () => void }>).find(
      (i) => i.label === "업데이트 확인…",
    );
    expect(item).toBeTruthy();
    item!.click!();
    expect(c.onCheckUpdate).toHaveBeenCalledTimes(1);
    const about = (help.submenu as Array<{ label?: string }>).find((i) => i.label?.includes("정보"));
    expect(about?.label).toBe("HelpMyDoc v0.1.5 정보");
  });

  it("편집 메뉴에 복사·붙여넣기가 있고, 앱이 직접 처리하는 확대·축소 항목은 없다 (단축키 충돌 방지)", () => {
    const t = buildMenuTemplate({ version: "1", repoUrl: "", ...cb() });
    const roles = JSON.stringify(t);
    expect(roles).toContain('"role":"copy"');
    expect(roles).toContain('"role":"paste"');
    expect(roles).not.toMatch(/zoomIn|zoomOut|resetZoom/);
  });

  it("맥은 앱 이름 메뉴가 맨 앞", () => {
    const t = buildMenuTemplate({ version: "1", repoUrl: "", isMac: true, ...cb() });
    expect(t[0].label).toBe("HelpMyDoc");
    expect(t.map((m) => m.label)).not.toContain("파일");
  });
});

describe("updateDialogFor", () => {
  it("결과별 문구: 최신 / 받는 중 / 준비됨(설치 버튼) / 이미 확인 중 / 꺼짐 / 오류", () => {
    expect(updateDialogFor({ outcome: "up-to-date", currentVersion: "0.1.5" })).toMatchObject({
      message: "최신 버전이에요",
    });
    expect(updateDialogFor({ outcome: "up-to-date", currentVersion: "0.1.5" }).detail).toContain("v0.1.5");
    expect(updateDialogFor({ outcome: "available", version: "0.2.0" }).message).toContain("v0.2.0");
    const ready = updateDialogFor({ outcome: "ready", version: "0.2.0" });
    expect(ready.install).toBe(true);
    expect(updateDialogFor({ outcome: "busy" }).message).toContain("확인하는 중");
    expect(updateDialogFor({ outcome: "disabled" }).detail).toContain("GitHub Releases");
    const err = updateDialogFor({ outcome: "error", error: "offline" });
    expect(err.detail).toContain("offline");
    expect(err.detail).toContain("\n"); // 줄바꿈 (이스케이프가 글자로 남지 않음)
    expect(err.detail).not.toContain("\\n");
  });
});

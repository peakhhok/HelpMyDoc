// 앱 상단 메뉴(파일 · 편집 · 보기 · 도움말). 동작은 인자로 받아서 Electron 없이도 구조를 테스트할 수 있다.
// 확대·축소는 앱 안에서 Ctrl+휠 / Ctrl +/-/0 으로 직접 처리하므로 메뉴의 확대 항목은 넣지 않는다. (단축키가 겹치지 않게)

/**
 * @param {{
 *   version: string,
 *   repoUrl: string,
 *   isMac?: boolean,
 *   onCheckUpdate: () => void,
 *   onOpenRepo: () => void,
 *   onAbout: () => void,
 * }} o
 */
export function buildMenuTemplate({ version, isMac = false, onCheckUpdate, onOpenRepo, onAbout }) {
  const file = { label: "파일", submenu: [{ label: "종료", role: "quit" }] };
  const edit = {
    label: "편집",
    submenu: [
      { label: "실행 취소", role: "undo" },
      { label: "다시 실행", role: "redo" },
      { type: "separator" },
      { label: "잘라내기", role: "cut" },
      { label: "복사", role: "copy" },
      { label: "붙여넣기", role: "paste" },
      { label: "모두 선택", role: "selectAll" },
    ],
  };
  const view = {
    label: "보기",
    submenu: [
      { label: "새로 고침", role: "reload" },
      { label: "전체 화면", role: "togglefullscreen" },
      { type: "separator" },
      { label: "개발자 도구", role: "toggleDevTools" },
    ],
  };
  const help = {
    label: "도움말",
    submenu: [
      { label: "업데이트 확인…", click: onCheckUpdate },
      { label: "GitHub 저장소 열기", click: onOpenRepo },
      { type: "separator" },
      { label: `HelpMyDoc v${version} 정보`, click: onAbout },
    ],
  };
  // 맥은 첫 메뉴가 앱 이름 메뉴여야 한다.
  return isMac
    ? [{ label: "HelpMyDoc", submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }] }, edit, view, help]
    : [file, edit, view, help];
}

/** "업데이트 확인" 결과를 대화상자 문구로: { message, detail?, install? } */
export function updateDialogFor(result) {
  const cur = result.currentVersion ? `v${result.currentVersion}` : "현재 버전";
  const v = result.version ? `v${result.version}` : "새 버전";
  switch (result.outcome) {
    case "up-to-date":
      return { message: "최신 버전이에요", detail: `지금 ${cur}을 쓰고 있어요.` };
    case "available":
      return { message: `${v}을(를) 받는 중이에요`, detail: "백그라운드로 받고, 끝나면 화면 위에서 알려 드려요." };
    case "ready":
      return { message: `${v}이(가) 준비됐어요`, detail: "지금 다시 시작해서 업데이트할까요?", install: true };
    case "busy":
      return { message: "이미 확인하는 중이에요", detail: "잠시 뒤에 다시 눌러 주세요." };
    case "disabled":
      return {
        message: "이 실행에서는 자동 업데이트가 꺼져 있어요",
        detail:
          "설치형 앱에서만 동작해요. (개발 실행이거나 업데이트를 끈 경우) GitHub Releases에서 직접 내려받아 주세요.",
      };
    default:
      return {
        message: "업데이트를 확인하지 못했어요",
        detail: `${result.error ?? "알 수 없는 오류"}\n인터넷 연결을 확인해 주세요.`,
      };
  }
}

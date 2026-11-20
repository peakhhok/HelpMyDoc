// 화면(웹 페이지)에 데스크톱 앱 기능 몇 가지만 열어 준다. (contextIsolation: 화면은 Node/Electron 에 직접 접근하지 못한다)
//  - pathForFile: 사용자가 고른/끌어다 놓은 파일의 실제 경로 (브라우저는 알 수 없다)
//  - remember / recent / read: "최근에 연 문서" — 경로만 기억하고 다음 실행 때 그 파일을 다시 읽는다
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("helpmydocDesktop", {
  version: 1,
  pathForFile(file) {
    try {
      const p = webUtils.getPathForFile(file);
      if (p) ipcRenderer.send("doc:seen", p);
      return p || "";
    } catch {
      return "";
    }
  },
  remember: (path) => ipcRenderer.invoke("doc:remember", path),
  recent: () => ipcRenderer.invoke("doc:recent"),
  read: (path) => ipcRenderer.invoke("doc:read", path),
});

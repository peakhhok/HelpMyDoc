// 데스크톱 앱 전용 API: 자동 업데이트 상태 확인과 설치. (브라우저 버전에는 이 경로가 없다)
//
//   GET  /api/app/update          → { state, currentVersion, version?, percent?, error? }
//   POST /api/app/update/install  → 받아 둔 업데이트를 설치하고 앱을 다시 시작 (준비 안 됐으면 409)
//
// 브리지와 같은 Host/Origin 검사를 거친다. 다른 웹사이트가 앱을 재시작시킬 수 없다.
import { isTrustedRequest, json } from "./bridge.mjs";

export function appApi(updater) {
  return (req, res, next) => {
    const url = (req.url ?? "").split("?")[0];
    if (!url.startsWith("/api/app/")) return next();
    if (!isTrustedRequest(req)) return json(res, 403, { error: "허용되지 않은 출처입니다." });

    if (url === "/api/app/update" && req.method === "GET") return json(res, 200, updater.getState());

    if (url === "/api/app/update/install" && req.method === "POST") {
      if (updater.getState().state !== "ready")
        return json(res, 409, { error: "설치할 업데이트가 준비되지 않았습니다." });
      json(res, 200, { ok: true });
      // 응답이 나간 뒤에 종료·설치를 시작한다.
      res.on("finish", () => setImmediate(() => updater.install()));
      return;
    }
    return json(res, 404, { error: "not found" });
  };
}

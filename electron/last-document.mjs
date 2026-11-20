// "최근에 연 문서": 문서 파일 자체가 아니라 **경로만** 이 PC(앱 데이터 폴더)에 기억해 두었다가,
// 다음에 앱을 켜면 그 경로의 파일을 다시 읽어 자동으로 연다. (파일 복사본은 저장하지 않는다)
//
// 보안: 화면(렌더러)이 임의의 파일을 읽지 못하게 한다.
//  - 기억할 수 있는 것은 사용자가 실제로 고르거나 끌어다 놓은 파일의 경로뿐이다 (seen 으로 먼저 알려야 함).
//  - 읽을 수 있는 것은 기억해 둔 목록 안의 경로뿐이고, 확장자는 .pdf / .pptx 만 허용한다.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join } from "node:path";

const EXT = new Set([".pdf", ".pptx"]);
export const MAX_RECENT = 8;
export const MAX_BYTES = 400 * 1024 * 1024;
const FILE = "recent-documents.json";

export function isDocPath(p) {
  return typeof p === "string" && p.length > 0 && p.length < 1024 && isAbsolute(p) && EXT.has(extname(p).toLowerCase());
}

export function createRecentDocuments({ dir }) {
  const file = join(dir, FILE);
  /** 이번 실행에서 사용자가 실제로 고르거나 끌어다 놓은 파일 경로 */
  const seen = new Set();

  const load = () => {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      return Array.isArray(raw) ? raw.filter((e) => e && isDocPath(e.path) && typeof e.at === "number") : [];
    } catch {
      return [];
    }
  };
  const save = (list) => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(list), "utf8");
    } catch {
      /* 저장하지 못해도 앱은 계속 동작한다 */
    }
  };

  return {
    /** 사용자가 고른/놓은 파일의 경로를 알린다 (기억·읽기의 전제) */
    seen(path) {
      if (!isDocPath(path)) return false;
      if (seen.size > 500) seen.clear();
      seen.add(path);
      return true;
    },
    /** 열었던 문서로 기억한다. 사용자가 실제로 고른 파일(seen)이고 존재하는 일반 파일일 때만. */
    remember(path) {
      if (!isDocPath(path) || !seen.has(path)) return false;
      try {
        if (!statSync(path).isFile()) return false;
      } catch {
        return false;
      }
      const list = [{ path, at: Date.now() }, ...load().filter((e) => e.path !== path)].slice(0, MAX_RECENT);
      save(list);
      return true;
    },
    /** 최근 문서 목록 (최근 것부터). exists 는 지금 파일이 있는지 */
    list() {
      return load().map((e) => ({ path: e.path, name: basename(e.path), at: e.at, exists: existsSync(e.path) }));
    },
    /** 기억해 둔 목록 안의 문서를 읽는다. */
    read(path) {
      if (!isDocPath(path) || !load().some((e) => e.path === path)) return { ok: false, reason: "unknown" };
      const name = basename(path);
      let st;
      try {
        st = statSync(path);
      } catch {
        return { ok: false, reason: "missing", name };
      }
      if (!st.isFile()) return { ok: false, reason: "missing", name };
      if (st.size > MAX_BYTES) return { ok: false, reason: "too-big", name };
      try {
        const data = readFileSync(path);
        seen.add(path); // 목록에서 연 문서도 다시 "최근 문서"로 올릴 수 있게 한다
        return { ok: true, name, data };
      } catch {
        return { ok: false, reason: "error", name };
      }
    },
    /** 목록에서 뺀다 */
    forget(path) {
      save(load().filter((e) => e.path !== path));
    },
  };
}

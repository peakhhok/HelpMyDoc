// 문서별 기억: 대화 내용과 마지막으로 본 페이지를 이 PC(IndexedDB)에만 저장한다.
// 문서는 파일 이름이 아니라 파일 내용의 SHA-256 해시(docId.ts)로 구분한다.
// PDF 파일 자체와 추출한 텍스트는 저장하지 않는다.
import type { UiMessage } from "./history";

export interface DocRecord {
  /** 파일 내용의 SHA-256 (해시를 못 쓰는 환경에서는 pdf.js fingerprint) */
  id: string;
  /** 목록에 보여줄 이름 (구분 기준이 아님) */
  name: string;
  numPages: number;
  lastPage: number;
  messages: UiMessage[];
  updatedAt: number;
}

export interface DocMeta {
  name: string;
  numPages: number;
}

/** 문서 하나에 저장하는 최대 메시지 수 (오래된 것부터 버린다) */
export const MAX_STORED_MESSAGES = 200;

const DB_NAME = "helpmydoc";
const STORE = "docs";

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** IndexedDB 를 못 쓰는 환경(시크릿 모드 등)에서는 null — 이때 모든 함수는 조용히 아무것도 하지 않는다. */
function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      if (typeof indexedDB === "undefined") return resolve(null);
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

export async function loadDoc(id: string): Promise<DocRecord | undefined> {
  const db = await openDb();
  if (!db || !id) return undefined;
  try {
    return await request<DocRecord | undefined>(db.transaction(STORE).objectStore(STORE).get(id));
  } catch {
    return undefined;
  }
}

/** 최근에 본 문서부터 */
export async function listDocs(): Promise<DocRecord[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const all = (await request<DocRecord[]>(db.transaction(STORE).objectStore(STORE).getAll())) ?? [];
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/**
 * 기록을 만들거나 일부만 갱신한다. 읽기-수정-쓰기를 한 트랜잭션에서 하므로
 * 마지막 페이지 저장과 대화 저장이 동시에 일어나도 서로 덮어쓰지 않는다.
 */
export async function updateDoc(
  id: string,
  meta: DocMeta,
  patch: { lastPage?: number; messages?: UiMessage[] },
): Promise<void> {
  const db = await openDb();
  if (!db || !id) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const get = store.get(id);
      get.onsuccess = () => {
        const cur = get.result as DocRecord | undefined;
        const messages = patch.messages ?? cur?.messages ?? [];
        store.put({
          id,
          name: meta.name,
          numPages: meta.numPages,
          lastPage: patch.lastPage ?? cur?.lastPage ?? 1,
          messages: messages.length > MAX_STORED_MESSAGES ? messages.slice(-MAX_STORED_MESSAGES) : messages,
          updatedAt: Date.now(),
        } satisfies DocRecord);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deleteDoc(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await request(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
  } catch {
    /* ignore */
  }
}

export async function clearAllDocs(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await request(db.transaction(STORE, "readwrite").objectStore(STORE).clear());
  } catch {
    /* ignore */
  }
}

"use client";

/**
 * 기기 안에만 저장하는 작은 보관소.
 *
 * 알레르기·질병·음성 메모는 민감한 건강정보다. 서버에 올리면 개인정보 처리
 * 고지와 동의 절차가 필요하고 유출 책임도 생긴다. 그래서 로그인도 서버도 없이
 * 브라우저 안에만 둔다. 어르신이 매번 정보를 다시 입력하지 않게 하는 것이 목적이다.
 *
 * IndexedDB를 먼저 쓰고, 시크릿 모드처럼 막힌 환경에서는 localStorage로 내려간다.
 */

const DB_NAME = "silverlens";
const DB_VERSION = 1;
const OBJECT_STORE = "state";
const FALLBACK_PREFIX = "silverlens:fallback:";

let dbPromise: Promise<IDBDatabase> | null = null;

function indexedDbAvailable() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDatabase() {
  if (!indexedDbAvailable()) return Promise.reject(new Error("IndexedDB 사용 불가"));
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OBJECT_STORE)) {
        db.createObjectStore(OBJECT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 열기 실패"));
    // 다른 탭이 잠그고 있으면 무한 대기하지 않고 실패시켜 localStorage로 내려간다.
    request.onblocked = () => reject(new Error("IndexedDB가 잠겨 있습니다."));
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });

  return dbPromise;
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(OBJECT_STORE, mode);
        const request = handler(transaction.objectStore(OBJECT_STORE));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error ?? new Error("저장소 요청 실패"));
      }),
  );
}

function fallbackRead<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(`${FALLBACK_PREFIX}${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function fallbackWrite(key: string, value: unknown) {
  try {
    window.localStorage.setItem(`${FALLBACK_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // 저장 공간이 꽉 차 있어도 화면 동작은 계속되어야 한다.
  }
}

function fallbackClear(key: string) {
  try {
    window.localStorage.removeItem(`${FALLBACK_PREFIX}${key}`);
  } catch {
    // 무시
  }
}

export async function readStore<T>(key: string): Promise<T | null> {
  if (typeof window === "undefined") return null;
  try {
    const value = await runTransaction<T | undefined>("readonly", (store) =>
      store.get(key),
    );
    if (value !== undefined && value !== null) return value;
  } catch {
    // IndexedDB를 못 쓰면 아래 localStorage 값을 본다.
  }
  return fallbackRead<T>(key);
}

export async function writeStore(key: string, value: unknown): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await runTransaction("readwrite", (store) => store.put(value, key));
    return;
  } catch {
    fallbackWrite(key, value);
  }
}

export async function clearStore(key: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await runTransaction("readwrite", (store) => store.delete(key));
  } catch {
    // IndexedDB 삭제가 실패해도 아래 폴백은 지운다.
  }
  fallbackClear(key);
}

/** 지금 어느 저장소를 쓰는지. 로그 화면과 안내 문구에서 쓴다. */
export async function describeStore(): Promise<"indexeddb" | "localstorage" | "none"> {
  if (typeof window === "undefined") return "none";
  try {
    await openDatabase();
    return "indexeddb";
  } catch {
    return typeof window.localStorage === "undefined" ? "none" : "localstorage";
  }
}

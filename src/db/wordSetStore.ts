import { createId } from '../domain/ids';
import type { WordEntry, WordSet } from '../domain/types';

const DB_NAME = 'english-vocab-review';
const DB_VERSION = 1;
const STORE = 'wordSets';

export const SIMULATE_SAVE_FAILURE_KEY = 'vocab:simulateSaveFailure';
export const SIMULATE_SAVE_FAILURE_PARAM = 'simulateSaveFailure';

export const SAVE_FAILED_MESSAGE =
  '儲存失敗，畫面上的修改都還在。已儲存的課次沒有被改動。';

export const SIMULATED_SAVE_FAILED_MESSAGE =
  '模擬寫入失敗，資料沒有寫入。畫面上的修改都還在，已儲存的課次沒有被改動。';

export class WordSetSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WordSetSaveError';
  }
}

export function saveFailureArmed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get(SIMULATE_SAVE_FAILURE_PARAM) === '1') return true;
    return window.sessionStorage.getItem(SIMULATE_SAVE_FAILURE_KEY) === '1';
  } catch {
    return false;
  }
}

function assertSaveAllowed(): void {
  if (saveFailureArmed()) {
    throw new WordSetSaveError(SIMULATED_SAVE_FAILED_MESSAGE);
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('無法開啟資料庫'));
    };
  });
  return dbPromise;
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        let settled = false;
        const fail = (error: DOMException | null) => {
          if (settled) return;
          settled = true;
          reject(error ?? new Error('資料庫操作失敗'));
        };
        request.onerror = () => fail(request.error);
        tx.onerror = () => fail(tx.error);
        tx.onabort = () => fail(tx.error);
        tx.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve(request.result);
        };
      }),
  );
}

function cloneEntry(entry: WordEntry): WordEntry {
  const stored: WordEntry = { id: entry.id, spelling: entry.spelling.trim() };
  const meaning = entry.meaningHint?.trim();
  if (meaning) stored.meaningHint = meaning;
  if (entry.imageId) stored.imageId = entry.imageId;
  return stored;
}

function validateForWrite(name: string, entries: WordEntry[]): void {
  if (name.trim().length === 0) {
    throw new WordSetSaveError('請填寫課次名稱。');
  }
  if (entries.length === 0 || entries.some((entry) => entry.spelling.trim().length === 0)) {
    throw new WordSetSaveError('還有空白詞條。請填上英文拼寫，或刪除那一列。');
  }
}

export async function listWordSets(): Promise<WordSet[]> {
  const rows = await runTransaction('readonly', (store) => store.getAll() as IDBRequest<WordSet[]>);
  return rows.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, 'zh-Hant'));
}

export async function getWordSet(id: string): Promise<WordSet | undefined> {
  return runTransaction('readonly', (store) => store.get(id) as IDBRequest<WordSet | undefined>);
}

export async function createWordSet(input: { name: string; entries: WordEntry[] }): Promise<WordSet> {
  validateForWrite(input.name, input.entries);
  assertSaveAllowed();
  const now = Date.now();
  const wordSet: WordSet = {
    id: createId(),
    name: input.name.trim(),
    createdAt: now,
    updatedAt: now,
    entries: input.entries.map(cloneEntry),
  };
  assertSaveAllowed();
  await runTransaction('readwrite', (store) => store.put(wordSet));
  return wordSet;
}

export async function updateWordSet(
  id: string,
  input: { name: string; entries: WordEntry[] },
): Promise<WordSet> {
  validateForWrite(input.name, input.entries);
  assertSaveAllowed();
  const existing = await getWordSet(id);
  if (!existing) throw new WordSetSaveError('找不到這個單字組。');
  const next: WordSet = {
    ...existing,
    name: input.name.trim(),
    entries: input.entries.map(cloneEntry),
    updatedAt: Date.now(),
  };
  assertSaveAllowed();
  await runTransaction('readwrite', (store) => store.put(next));
  return next;
}

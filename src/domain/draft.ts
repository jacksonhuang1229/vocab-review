import { normalizeSpelling } from '../practice/score';
import type { WordEntry, WordSet } from './types';

export type DraftEntry = {
  id: string;
  spelling: string;
  meaningHint: string;
  imageId?: string;
  abstract?: boolean;
  imageAcceptedSpelling?: string;
  imageAcceptedMeaning?: string;
};

export function entriesToDraft(entries: WordEntry[]): DraftEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    spelling: entry.spelling,
    meaningHint: entry.meaningHint ?? '',
    ...(entry.imageId ? { imageId: entry.imageId } : {}),
    ...(entry.abstract ? { abstract: true } : {}),
    ...(entry.imageAcceptedSpelling && entry.imageAcceptedMeaning
      ? {
          imageAcceptedSpelling: entry.imageAcceptedSpelling,
          imageAcceptedMeaning: entry.imageAcceptedMeaning,
        }
      : {}),
  }));
}

export function draftToEntries(entries: DraftEntry[]): WordEntry[] {
  return entries.map((entry) => {
    const stored: WordEntry = {
      id: entry.id,
      spelling: entry.spelling.trim(),
    };
    const meaning = entry.meaningHint.trim();
    if (meaning) stored.meaningHint = meaning;
    if (entry.imageId) stored.imageId = entry.imageId;
    if (entry.abstract) stored.abstract = true;
    const acceptedSpelling = entry.imageAcceptedSpelling?.trim();
    const acceptedMeaning = entry.imageAcceptedMeaning?.trim();
    if (
      acceptedSpelling &&
      acceptedMeaning &&
      acceptedMeaning === meaning &&
      normalizeSpelling(acceptedSpelling) === normalizeSpelling(entry.spelling)
    ) {
      stored.imageAcceptedSpelling = acceptedSpelling;
      stored.imageAcceptedMeaning = acceptedMeaning;
    }
    return stored;
  });
}

export function validateDraft(name: string, entries: DraftEntry[]): string | null {
  if (name.trim().length === 0) return '請填寫課次名稱。';
  if (entries.length === 0) return '請至少加入一個詞條。';
  if (entries.some((entry) => entry.spelling.trim().length === 0)) {
    return '還有空白詞條。請填上英文拼寫，或刪除那一列。';
  }
  return null;
}

export function sameStoredContent(name: string, entries: DraftEntry[], saved: WordSet): boolean {
  if (name.trim() !== saved.name) return false;
  const next = draftToEntries(entries);
  if (next.length !== saved.entries.length) return false;
  return next.every((entry, index) => {
    const other = saved.entries[index];
    return (
      entry.id === other.id &&
      entry.spelling === other.spelling &&
      (entry.meaningHint ?? '') === (other.meaningHint ?? '') &&
      (entry.imageId ?? '') === (other.imageId ?? '') &&
      Boolean(entry.abstract) === Boolean(other.abstract) &&
      (entry.imageAcceptedSpelling ?? '') === (other.imageAcceptedSpelling ?? '') &&
      (entry.imageAcceptedMeaning ?? '') === (other.imageAcceptedMeaning ?? '')
    );
  });
}

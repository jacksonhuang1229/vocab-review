import type { ImageAsset, WordEntry } from '../domain/types';
import { normalizeSpelling } from './score';

export type PictureChoice = {
  id: string;
  spelling: string;
};

export type PictureQuestion = {
  id: string;
  spelling: string;
  imageId: string;
  choices: PictureChoice[];
};

type PictureMeta = Pick<ImageAsset, 'id' | 'word' | 'meaning' | 'sceneConfirmed'>;

export function buildPictureRound(
  entries: WordEntry[],
  images: PictureMeta[],
  random: () => number = Math.random,
): PictureQuestion[] {
  const byId = new Map(images.map((image) => [image.id, image]));
  const questions: PictureQuestion[] = [];
  for (const entry of entries) {
    const image = entry.imageId ? byId.get(entry.imageId) : undefined;
    if (!image || !pictureApplies(entry, image)) continue;
    const distractors = shuffle(eligibleDistractors(entry, entries, image), random).slice(0, 3);
    if (distractors.length < 1) continue;
    const choices = shuffle(
      [entry, ...distractors].map((item) => ({ id: item.id, spelling: item.spelling })),
      random,
    );
    questions.push({ id: entry.id, spelling: entry.spelling, imageId: image.id, choices });
  }
  return questions;
}

export type PictureStatus = 'loading' | 'empty' | 'missing' | 'needs-scene' | 'needs-reconfirm' | 'ready';

export function pictureStatus(entry: WordEntry, image: PictureMeta | undefined, imagesLoaded: boolean): PictureStatus {
  if (!entry.imageId) return 'empty';
  if (!imagesLoaded) return 'loading';
  if (!image) return 'missing';
  if (!labelsMatch(entry, image)) return 'needs-reconfirm';
  if (entry.abstract && !image.sceneConfirmed) return 'needs-scene';
  return 'ready';
}

export function pictureApplies(entry: WordEntry, image: PictureMeta): boolean {
  const meaning = entry.meaningHint?.trim() ?? '';
  if (!meaning || !labelsMatch(entry, image)) return false;
  if (entry.abstract && !image.sceneConfirmed) return false;
  return true;
}

function labelsMatch(entry: WordEntry, image: PictureMeta): boolean {
  const spelling = normalizeSpelling(entry.spelling);
  const meaning = entry.meaningHint?.trim() ?? '';
  if (normalizeSpelling(image.word) === spelling && image.meaning.trim() === meaning) return true;
  const acceptedSpelling = entry.imageAcceptedSpelling?.trim() ?? '';
  const acceptedMeaning = entry.imageAcceptedMeaning?.trim() ?? '';
  return normalizeSpelling(acceptedSpelling) === spelling && acceptedMeaning === meaning && acceptedMeaning.length > 0;
}

function eligibleDistractors(answer: WordEntry, entries: WordEntry[], image: PictureMeta): WordEntry[] {
  const seen = new Set<string>([normalizeSpelling(answer.spelling)]);
  const distractors: WordEntry[] = [];
  for (const other of entries) {
    if (other.id === answer.id) continue;
    const spelling = normalizeSpelling(other.spelling);
    if (!spelling || seen.has(spelling)) continue;
    if (couldAlsoBe(other, answer, image)) continue;
    seen.add(spelling);
    distractors.push(other);
  }
  return distractors;
}

function couldAlsoBe(distractor: WordEntry, answer: WordEntry, image: PictureMeta): boolean {
  const meaning = distractor.meaningHint?.trim() ?? '';
  const answerMeaning = answer.meaningHint?.trim() ?? '';
  if (meaning && (meaning === answerMeaning || meaning === image.meaning.trim())) return true;
  if (distractor.imageId && distractor.imageId === answer.imageId) return true;
  if (normalizeSpelling(image.word) === normalizeSpelling(distractor.spelling)) return true;
  return false;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swap] as T;
    copy[swap] = current as T;
  }
  return copy;
}

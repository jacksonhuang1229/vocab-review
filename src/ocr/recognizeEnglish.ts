import { createWorker, OEM, PSM } from 'tesseract.js';
import { parseWordList } from '../domain/parseWordList';

export type OcrFailure = 'undecodable' | 'empty' | 'unreadable' | 'failed';

export type OcrOutcome =
  | { ok: true; lines: string[]; confidence: number }
  | { ok: false; reason: OcrFailure };

type OcrWorker = Awaited<ReturnType<typeof createWorker>>;

const MIN_CONFIDENCE = 55;

let workerPromise: Promise<OcrWorker> | null = null;
let progressListener: ((percent: number) => void) | null = null;

export function setOcrProgressListener(listener: ((percent: number) => void) | null): void {
  progressListener = listener;
}

function localAsset(path: string): string {
  return new URL(path, window.location.origin).href;
}

function getWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    const pending = createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: localAsset('/tesseract/worker.min.js'),
      corePath: localAsset('/tesseract/core'),
      langPath: localAsset('/tessdata'),
      gzip: true,
      workerBlobURL: true,
      logger: (message) => {
        if (message.status === 'recognizing text' && progressListener) {
          progressListener(Math.round(message.progress * 100));
        }
      },
    })
      .then(async (worker) => {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        });
        return worker;
      })
      .catch((error: unknown) => {
        if (workerPromise === pending) workerPromise = null;
        throw error;
      });
    workerPromise = pending;
  }
  return workerPromise;
}

export async function imageCanBeDecoded(file: Blob): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file);
    const readableSize = bitmap.width >= 16 && bitmap.height >= 16;
    bitmap.close();
    return readableSize;
  } catch {
    return false;
  }
}

function cleanOcrLine(line: string): string {
  return line
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function linesFromOcr(text: string): string[] {
  return parseWordList(text)
    .map(cleanOcrLine)
    .filter((line) => line.length > 0);
}

function isReadable(lines: string[], confidence: number): boolean {
  if (confidence < MIN_CONFIDENCE) return false;
  const wordish = lines.filter((line) => /[A-Za-z]{2,}/.test(line));
  return wordish.length > 0 && wordish.length >= Math.ceil(lines.length * 0.6);
}

export async function recognizePrintedEnglish(file: Blob): Promise<OcrOutcome> {
  if (!(await imageCanBeDecoded(file))) {
    return { ok: false, reason: 'undecodable' };
  }
  let worker: OcrWorker;
  try {
    worker = await getWorker();
  } catch {
    return { ok: false, reason: 'failed' };
  }
  try {
    const result = await worker.recognize(file);
    const lines = linesFromOcr(result.data.text ?? '');
    const confidence = result.data.confidence ?? 0;
    if (lines.length === 0) return { ok: false, reason: 'empty' };
    if (!isReadable(lines, confidence)) return { ok: false, reason: 'unreadable' };
    return { ok: true, lines, confidence };
  } catch {
    const dying = workerPromise;
    workerPromise = null;
    if (dying) {
      dying.then((current) => current.terminate()).catch(() => undefined);
    }
    return { ok: false, reason: 'failed' };
  }
}

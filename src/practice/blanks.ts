export type SpellSlot =
  | { kind: 'char'; value: string; chunk: number }
  | { kind: 'blank'; chunk: number }
  | { kind: 'sep'; value: string };

export type BlankPrompt = {
  spelling: string;
  slots: SpellSlot[];
  blankCount: number;
};

const LETTER = /[A-Za-z]/;

export function letterCount(spelling: string): number {
  return [...spelling].filter((character) => LETTER.test(character)).length;
}

export function buildBlankPrompt(spelling: string): BlankPrompt | null {
  const chunks = splitChunks(spelling);
  const lengths = chunks.map((chunk) => chunk.letters.length);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total < 2) return null;

  const caps = lengths.map((length) => Math.max(0, length - 1));
  const maxBlanks = caps.reduce((sum, cap) => sum + cap, 0);
  if (maxBlanks < 1) return null;

  const target = Math.min(total <= 3 ? 1 : Math.round(total / 3), maxBlanks);
  const perChunk = allocateBlanks(lengths, caps, target);
  const hidden = new Set<string>();
  chunks.forEach((chunk, chunkIndex) => {
    const available = chunk.letters.map((_, index) => index).slice(1);
    for (const index of pickSpread(available, perChunk[chunkIndex] ?? 0)) {
      hidden.add(`${chunkIndex}:${index}`);
    }
  });

  const slots: SpellSlot[] = [];
  chunks.forEach((chunk, chunkIndex) => {
    if (chunkIndex > 0 && chunk.separator) {
      slots.push({ kind: 'sep', value: chunk.separator });
    }
    chunk.letters.forEach((letter, index) => {
      if (hidden.has(`${chunkIndex}:${index}`)) slots.push({ kind: 'blank', chunk: chunkIndex });
      else slots.push({ kind: 'char', value: letter, chunk: chunkIndex });
    });
  });

  return { spelling, slots, blankCount: slots.filter((slot) => slot.kind === 'blank').length };
}

export function canAskCloze(spelling: string): boolean {
  return buildBlankPrompt(spelling) !== null;
}

export function canAskListen(spelling: string): boolean {
  return letterCount(spelling) > 0;
}

export function reconstructSpelling(slots: SpellSlot[], typedBlanks: string[]): string {
  let blankIndex = 0;
  return slots
    .map((slot) => {
      if (slot.kind === 'blank') {
        const letter = typedBlanks[blankIndex] ?? '';
        blankIndex += 1;
        return letter;
      }
      return slot.value;
    })
    .join('');
}

type LetterChunk = { separator: string; letters: string[] };

function splitChunks(spelling: string): LetterChunk[] {
  const chunks: LetterChunk[] = [];
  let current: LetterChunk = { separator: '', letters: [] };
  let pendingSeparator = '';
  for (const character of spelling) {
    if (LETTER.test(character)) {
      if (current.letters.length > 0 && pendingSeparator) {
        chunks.push(current);
        current = { separator: pendingSeparator, letters: [] };
        pendingSeparator = '';
      }
      current.letters.push(character);
    } else if (current.letters.length > 0) {
      pendingSeparator += character;
    }
  }
  if (current.letters.length > 0) chunks.push(current);
  return chunks;
}

function allocateBlanks(lengths: number[], caps: number[], target: number): number[] {
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const raw = lengths.map((length) => (length / total) * target);
  const assigned = raw.map((value) => Math.floor(value));
  let remaining = target - assigned.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || b.index - a.index);

  for (const item of order) {
    if (remaining <= 0) break;
    if (assigned[item.index] < caps[item.index]) {
      assigned[item.index] += 1;
      remaining -= 1;
    }
  }
  while (remaining > 0) {
    let progressed = false;
    for (let index = 0; index < assigned.length && remaining > 0; index += 1) {
      if (assigned[index] < caps[index]) {
        assigned[index] += 1;
        remaining -= 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return assigned;
}

function pickSpread(available: number[], count: number): number[] {
  if (count <= 0) return [];
  if (count >= available.length) return available.slice();
  const picked: number[] = [];
  const used = new Set<number>();
  for (let step = 1; step <= count; step += 1) {
    let index = Math.round((step * (available.length + 1)) / (count + 1)) - 1;
    index = Math.max(0, Math.min(available.length - 1, index));
    while (used.has(index) && index < available.length - 1) index += 1;
    while (used.has(index) && index > 0) index -= 1;
    used.add(index);
    picked.push(available[index]);
  }
  return picked;
}

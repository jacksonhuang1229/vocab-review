/** Ignore case and surrounding whitespace, and treat repeated internal spaces as one. */
export function normalizeSpelling(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function answersMatch(expected: string, given: string): boolean {
  return normalizeSpelling(expected) === normalizeSpelling(given);
}

/** One trimmed word or phrase per line. Blank lines are skipped. */
export function parseWordList(text: string): string[] {
  const withoutBom = text.replace(/^\uFEFF/, '');
  return withoutBom
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function padToMinWords(text: string, min: number, filler: string): string {
  let out = text.trim();
  const piece = filler.trim();
  while (wordCount(out) < min) {
    out = `${out} ${piece}`;
  }
  return out;
}

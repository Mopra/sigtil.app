import { diff3Merge } from 'node-diff3';

/**
 * Three-way merge of a text file, line by line. `ours` is the editor's
 * version, `theirs` the one that changed elsewhere, `base` what both started
 * from. Changes to different lines are both kept. Where both changed the same
 * lines the editor's version wins, since what they just asked for must show.
 */
export function mergeText(base: string, ours: string, theirs: string): string {
  // Split on line breaks ourselves: given strings, node-diff3 splits on any
  // whitespace and drops it.
  const lines = (s: string) => s.split('\n');
  return diff3Merge(lines(ours), lines(base), lines(theirs), { excludeFalseConflicts: true })
    .flatMap(region => region.ok ?? region.conflict!.a)
    .join('\n');
}

/** Bytes that can't be merged as text: images, PDFs, fonts. */
export function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

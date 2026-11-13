/**
 * The KJV's own `\w strong=` tags, checked against the original words and
 * stored as alignment rows (ADR-0003, KJV amendment, plan step 12).
 *
 * A tag passes when its number is the Strong's number of a word in the WLC or
 * SBLGNT verse the KJV verse maps to through the pivot. A passing tag links
 * to one original word with its number. When the mapped verses have as many
 * words with the number as the KJV verse has tags with it, the n-th tag takes
 * the n-th word. Otherwise each tag takes the word whose place in its verse,
 * as a fraction of the verse's length, is nearest the tag's own: in GEN 1:1
 * `and|H0853` takes the second אֵת (וְאֵת), not the first. A ketiv counts
 * only when no other word has the number, since the KJV translates the qere.
 * Every word the tag covers gets the row. A tag that fails gets no row.
 */

import type { WordTag } from './normalize';
import type { WordAlignment } from './alignment';

/** An original word of a hub verse, in verse order. */
export interface HubWord {
  readonly source: WordAlignment['source'];
  readonly owId: string;
  readonly kind: 'word' | 'ketiv' | 'qere';
  readonly strongs: readonly string[];
}

export interface TagStats {
  /** Tags with a number, one per tag and verse unit. */
  tags: number;
  /** Tags whose number is a word's number in the mapped verses. */
  passed: number;
  /** Tags in verses that map to no hub words. */
  unmapped: number;
}

/** `H0430` → `H430`, the hub's form. */
export const normalStrongs = (s: string): string => {
  const m = /^([HG])0*(\d+)$/.exec(s);
  if (!m) throw new Error(`not a Strong's number: "${s}"`);
  return `${m[1]}${m[2]}`;
};

/** Where an item sits in a list, from 0 at the first to 1 at the last. */
const place = (i: number, length: number) => (length > 1 ? i / (length - 1) : 0.5);

/**
 * Link one KJV verse unit's tags, in reading order, to the words of the hub
 * verses it maps to, in order. `wordCount` is the unit's number of words.
 * Returns the rows and adds to `stats`.
 */
export function linkVerseTags(
  unit: { book: string; chapter: number; verse: number; segment: string },
  wordCount: number,
  tags: readonly WordTag[],
  hub: readonly HubWord[],
  stats: TagStats,
): WordAlignment[] {
  const candidatesOf = (n: string): number[] => {
    const has = (i: number) => hub[i].strongs.includes(n);
    const all = hub.map((_, i) => i).filter(has);
    const read = all.filter((i) => hub[i].kind !== 'ketiv');
    return read.length > 0 ? read : all;
  };
  // each number's passing tags in order, to compare their count with the candidates'
  const tagsWith = new Map<string, number>();
  for (const tag of tags) {
    for (const raw of tag.strongs) {
      const n = normalStrongs(raw);
      tagsWith.set(n, (tagsWith.get(n) ?? 0) + 1);
    }
  }
  const rows: WordAlignment[] = [];
  const seen = new Map<string, number>(); // how many tags with a number came before
  const seqs = new Map<number, number>(); // rows per word so far
  for (const tag of tags) {
    for (const raw of tag.strongs) {
      const n = normalStrongs(raw);
      stats.tags++;
      if (hub.length === 0) {
        stats.unmapped++;
        continue;
      }
      const candidates = candidatesOf(n);
      if (candidates.length === 0) continue;
      stats.passed++;
      const k = seen.get(n) ?? 0;
      seen.set(n, k + 1);
      let pick: number;
      if (candidates.length === tagsWith.get(n)) pick = candidates[k];
      else {
        const at = place(tag.wordIndexes[0], wordCount);
        pick = candidates.reduce((best, i) =>
          Math.abs(place(i, hub.length) - at) < Math.abs(place(best, hub.length) - at) ? i : best,
        );
      }
      const w = hub[pick];
      for (const wordIndex of tag.wordIndexes) {
        const seq = seqs.get(wordIndex) ?? 0;
        // two tags on one word may name the same original word: one row
        if (rows.some((r) => r.wordIndex === wordIndex && r.owId === w.owId && r.source === w.source)) continue;
        seqs.set(wordIndex, seq + 1);
        rows.push({ ...unit, wordIndex, seq, source: w.source, owId: w.owId, strongs: [n] });
      }
    }
  }
  return rows;
}

/**
 * Versification schemes (ADR-0002). A scheme is defined by its verse-count
 * table: for each book, the last verse number of each chapter, plus any verses
 * inside that range the scheme leaves out. Verse 0 (a Psalm title or chapter
 * heading) is not counted here; mapping rows decide where it goes (ADR-0006).
 *
 * No Node-only import here: the registry is built in src/ingest/schemes.ts.
 */

export interface Scheme {
  /** Registry id: `kjv`, `org`, `eng`, `lxx`, `vul`, `rso`, `rsc`. */
  readonly id: string;
  readonly name: string;
  readonly sourceUrl: string;
  readonly note: string;
  /** Book code → last verse of chapter 1, 2, ... (index 0 is chapter 1). */
  readonly verseCounts: ReadonlyMap<string, readonly number[]>;
  /** `BOOK C:V` keys of verses inside the count range that the scheme lacks. */
  readonly excluded: ReadonlySet<string>;
}

export const verseKey = (book: string, chapter: number, verse: number): string =>
  `${book} ${chapter}:${verse}`;

/** The last verse of a chapter, or undefined if the scheme lacks the chapter. */
export function lastVerse(s: Scheme, book: string, chapter: number): number | undefined {
  return chapter >= 1 ? s.verseCounts.get(book)?.[chapter - 1] : undefined;
}

/** Whether verse `verse` (1 or more) exists in the scheme. */
export function hasVerse(s: Scheme, book: string, chapter: number, verse: number): boolean {
  const last = lastVerse(s, book, chapter);
  return last !== undefined && verse >= 1 && verse <= last && !s.excluded.has(verseKey(book, chapter, verse));
}

export interface VerseCheck {
  /** Verses the text has and the scheme does not. */
  readonly unknown: { chapter: number; verse: number }[];
  /** Chapters whose last verse in the text is below the scheme's count (0 = chapter missing). */
  readonly short: { chapter: number; last: number; expected: number }[];
}

/** Compare one book of an edition's verses against its declared scheme. Verse 0 is ignored. */
export function checkVerses(
  s: Scheme,
  book: string,
  verses: readonly { chapter: number; verse: number }[],
): VerseCheck {
  const unknown: VerseCheck['unknown'] = [];
  const seen = new Set<string>();
  const last = new Map<number, number>();
  for (const { chapter, verse } of verses) {
    if (verse === 0) continue;
    if (!hasVerse(s, book, chapter, verse)) {
      const k = verseKey(book, chapter, verse);
      if (!seen.has(k)) unknown.push({ chapter, verse });
      seen.add(k);
    }
    last.set(chapter, Math.max(last.get(chapter) ?? 0, verse));
  }
  const short: VerseCheck['short'] = [];
  (s.verseCounts.get(book) ?? []).forEach((expected, i) => {
    const got = last.get(i + 1) ?? 0;
    if (got < expected) short.push({ chapter: i + 1, last: got, expected });
  });
  return { unknown, short };
}

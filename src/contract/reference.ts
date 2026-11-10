/**
 * Human references ("1 Cor 13:4-7", "Ps 23") to verse ranges, through
 * bible-passage-reference-parser with its English data (ADR-0008: English
 * only). MIT, verdict in research/licensing.md.
 *
 * The parser only reads the text. It checks book order and nothing else, so
 * chapters and verses come back as written, and the caller checks them
 * against the edition's scheme. Its own verse counts are never used, because
 * the edition supplies the scheme (ADR-0002).
 *
 * No Node-only import here.
 */

import { bcv_parser } from 'bible-passage-reference-parser';
import * as en from 'bible-passage-reference-parser/esm/lang/en.js';

import { OSIS_BOOKS, OSIS_TO_USFM } from '../model/osis';

/** A chapter and an optional verse. `verse` null means the whole chapter from that end. */
export interface ChapterVerse {
  readonly chapter: number;
  readonly verse: number | null;
}

/**
 * One range inside one book, as the reference wrote it. `start.verse` null
 * starts at the chapter's first verse (its title, where the scheme numbers
 * one), and `end.verse` null ends at the chapter's last verse.
 */
export interface BookRange {
  /** USFM book code. */
  readonly book: string;
  readonly start: ChapterVerse;
  readonly end: ChapterVerse;
}

const parser = new bcv_parser(en);
parser.set_options({
  // "Ps 23" stays a chapter, "1 Cor 13:4-7" stays verses
  osis_compaction_strategy: 'bc',
  // check book order only; the edition's scheme decides chapters and verses
  passage_existence_strategy: 'b',
  // "Ps 51:0" is a Psalm title under schemes that number one
  zero_verse_strategy: 'allow',
  // a search box: "Matt 5 1" means Matt 5:1
  captive_end_digits_strategy: 'include',
  // the 66 books of the Protestant canon (ADR-0008)
  testaments: 'on',
  // "Genesis" is the whole book, and "Gen 1:3-Exod" ends at the end of Exodus
  book_alone_strategy: 'full',
  book_range_strategy: 'include',
});

/** The parser's "to the end" chapter or verse, with chapter and verse checks off: `Gen.1-Gen.999`. */
const OPEN = 999;

const USFM_ORDER = new Map(OSIS_BOOKS.map(([, usfm], i) => [usfm, i]));

/**
 * Every range a reference names, in the order written, split at book
 * boundaries. Empty when the text holds no reference.
 */
export function parseReference(text: string): BookRange[] {
  const osis: string = parser.parse(text).osis();
  if (osis === '') return [];
  return osis.split(',').flatMap(osisRange);
}

interface OsisPoint {
  readonly book: string;
  readonly chapter: number;
  readonly verse: number | null;
}

function osisPoint(s: string): OsisPoint {
  const [b, c, v] = s.split('.');
  const book = OSIS_TO_USFM.get(b);
  if (!book) throw new Error(`reference: no USFM code for OSIS book "${b}"`);
  if (c === undefined) throw new Error(`reference: OSIS "${s}" names no chapter`);
  const chapter = Number(c) === OPEN ? Infinity : Number(c);
  const verse = v === undefined || Number(v) === OPEN ? null : Number(v);
  return { book, chapter, verse };
}

function osisRange(range: string): BookRange[] {
  const [a, b] = range.split('-');
  const start = osisPoint(a);
  const end = b === undefined ? start : osisPoint(b);
  if (start.book === end.book) {
    return [{ book: start.book, start: cv(start), end: cv(end) }];
  }
  // a range across books: the rest of the first, the whole books between, the start of the last
  const from = USFM_ORDER.get(start.book)!;
  const to = USFM_ORDER.get(end.book)!;
  const out: BookRange[] = [{ book: start.book, start: cv(start), end: { chapter: Infinity, verse: null } }];
  for (let i = from + 1; i < to; i++) {
    out.push({ book: OSIS_BOOKS[i][1], start: { chapter: 1, verse: null }, end: { chapter: Infinity, verse: null } });
  }
  out.push({ book: end.book, start: { chapter: 1, verse: null }, end: cv(end) });
  return out;
}

const cv = (p: OsisPoint): ChapterVerse => ({ chapter: p.chapter, verse: p.verse });

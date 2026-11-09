/**
 * Verse and word addresses (ADR-0002 "Address syntax").
 *
 * The string form is a USFM Scripture Referencing Standard 1.0 reference, then
 * `/`, then a scheme id from the registry:
 *
 *     PSA 51:3/org       a verse
 *     PSA 51:0/eng       a Psalm title as verse 0
 *     REV 13:1a/kjv      part of a verse (one-letter segment)
 *     GEN 1:1-31/kjv     a range; the scheme applies to both ends
 *     MAT 2:1!3/kjv      the third word of the verse (wordIndex 2)
 *
 * Word numbers in strings count from 1, as the standard does. `wordIndex` here
 * counts from 0, as stored (ADR-0004). This module is the only place that
 * converts between them.
 *
 * A range stays inside one book and one scheme. Whether a scheme id is
 * registered, and whether the verse exists in it, is the scheme registry's
 * job, not the parser's.
 */

/** A point: a verse, part of a verse, or one word in it. */
export interface VerseRef {
  /** USFM book code. */
  readonly book: string;
  readonly chapter: number;
  /** 0 is a Psalm title. */
  readonly verse: number;
  /** `''` for the whole verse, else one lowercase letter. */
  readonly segment: string;
  /** 0-based word index, punctuation excluded. Absent for a whole verse. */
  readonly wordIndex?: number;
}

/** A point or an inclusive range under one versification scheme. */
export interface Address {
  readonly scheme: string;
  readonly start: VerseRef;
  /** Inclusive end, same book as `start`. Absent for a single point. */
  readonly end?: VerseRef;
}

const BOOK = '([0-9A-Z]{3})';
const SCHEME_RE = /^[a-z][a-z0-9]*$/;
const START_RE = new RegExp(`^${BOOK} (\\d+):(\\d+)([a-z]?)(?:!(\\d+))?$`);
/** Range end: `W` (word in the start verse), `V[s][!W]` or `C:V[s][!W]`. */
const END_RE = /^(?:(\d+):)?(\d+)([a-z]?)(?:!(\d+))?$/;

export function parseAddress(text: string): Address {
  const slash = text.lastIndexOf('/');
  if (slash < 0) throw new Error(`address "${text}": missing "/scheme"`);
  const scheme = text.slice(slash + 1);
  if (!SCHEME_RE.test(scheme)) throw new Error(`address "${text}": bad scheme id "${scheme}"`);
  const ref = text.slice(0, slash);

  const dash = ref.indexOf('-');
  const startText = dash < 0 ? ref : ref.slice(0, dash);
  const m = START_RE.exec(startText);
  if (!m) throw new Error(`address "${text}": bad reference "${startText}"`);
  const [, book, c, v, seg, w] = m;
  const start = point(text, book, c, v, seg, w);
  if (start.chapter < 1) throw new Error(`address "${text}": chapter must be 1 or more`);
  if (dash < 0) return { scheme, start };

  const endText = ref.slice(dash + 1);
  const e = END_RE.exec(endText);
  if (!e) throw new Error(`address "${text}": bad range end "${endText}"`);
  const [, ec, ev, eseg, ew] = e;
  let end: VerseRef;
  if (start.wordIndex !== undefined && ec === undefined && eseg === '' && ew === undefined) {
    // `MAT 2:1!3-5`: the end is a word number in the start verse.
    end = { ...start, wordIndex: wordIndex(text, ev) };
  } else {
    end = point(text, book, ec ?? String(start.chapter), ev, eseg, ew);
  }
  if (compare(end, start) < 0) throw new Error(`address "${text}": range ends before it starts`);
  return { scheme, start, end };
}

export function formatAddress(a: Address): string {
  const s = a.start;
  let out = `${s.book} ${s.chapter}:${s.verse}${s.segment}${word(s)}`;
  const e = a.end;
  if (e) {
    if (e.book !== s.book) throw new Error(`address: range crosses books (${s.book}, ${e.book})`);
    const sameVerse = e.chapter === s.chapter && e.verse === s.verse && e.segment === s.segment;
    if (sameVerse && s.wordIndex !== undefined && e.wordIndex !== undefined) {
      out += `-${e.wordIndex + 1}`;
    } else if (e.chapter === s.chapter) {
      out += `-${e.verse}${e.segment}${word(e)}`;
    } else {
      out += `-${e.chapter}:${e.verse}${e.segment}${word(e)}`;
    }
  }
  return `${out}/${a.scheme}`;
}

function point(text: string, book: string, c: string, v: string, seg: string, w?: string): VerseRef {
  const ref: VerseRef = { book, chapter: Number(c), verse: Number(v), segment: seg };
  return w === undefined ? ref : { ...ref, wordIndex: wordIndex(text, w) };
}

function wordIndex(text: string, n: string): number {
  const num = Number(n);
  if (num < 1) throw new Error(`address "${text}": word numbers count from 1`);
  return num - 1;
}

const word = (r: VerseRef) => (r.wordIndex === undefined ? '' : `!${r.wordIndex + 1}`);

/** Order two refs in the same book. A whole verse sorts before its words. */
function compare(a: VerseRef, b: VerseRef): number {
  return (
    a.chapter - b.chapter ||
    a.verse - b.verse ||
    a.segment.localeCompare(b.segment) ||
    (a.wordIndex ?? -1) - (b.wordIndex ?? -1)
  );
}

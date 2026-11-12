/**
 * STEPBible TVTMS compiled to per-scheme mapping rows (ADR-0006).
 *
 * TVTMS's expanded section has one row per verse: SourceRef (a verse in some
 * Bible), StandardRef (where it goes in Standard numbering, which is the
 * pivot), an Action, and Tests that must all be true of that Bible. TVTMS
 * says its SourceType column "isn't used in programming", so rows are picked
 * by their tests alone.
 *
 * For a scheme, the count tests run against its verse-count table: `=Exist`,
 * `=NotExist`, `=Last`, and subverse counts from its segment lines. The
 * word-count tests (`<`, `>`) and `TextBeforeV1` run against the text of the
 * scheme's editions (ADR-0006 amendment, text tests). Rows they can't decide
 * are returned as `needsText` and not compiled.
 *
 * The file is downloaded, not committed; sources.ts says why.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BOOK_BY_CODE } from '../model/books';
import type { Block, Token, VerseText } from '../model/corpus';
import { PROTESTANT, canonBookCodes } from '../model/canon';
import { Relation, parseRefKey, refKey, type MappingRow, type Ref } from '../model/mapping';
import { lastVerse, type Scheme } from '../model/scheme';
import { ENG_TO_PIVOT, allVrsPivotRows, buildPivot } from './pivot';
import { PARATEXT_SCHEMES } from './schemes';
import { TVTMS } from './sources';

export const TVTMS_PATH = join(import.meta.dirname, 'sources', TVTMS.file);

export interface TvtmsRow {
  /** 1-based line in the file. */
  readonly line: number;
  readonly sourceType: string;
  readonly source: string;
  readonly standard: string;
  readonly action: string;
  readonly tests: string;
}

/**
 * TVTMS book abbreviations are USFM codes in title case, except two:
 * `4Es` is Latin 2 Esdras (its section headers read `$4Es./2Es.`, and its
 * 10:59-60 rows match rso.vrs lines 395-396 for `2ES`), and `Ade` (Additions
 * to Esther, lettered chapters) has no USFM code.
 */
const BOOK_ALIASES: Readonly<Record<string, string>> = { '4ES': '2ES' };

function usfm(abbr: string): string {
  const up = abbr.toUpperCase();
  const code = BOOK_ALIASES[up] ?? up;
  if (!BOOK_BY_CODE.has(code)) throw new Error(`TVTMS book "${abbr}" has no USFM code`);
  return code;
}

/** Read the expanded section's data rows. */
export function parseTvtms(text: string): TvtmsRow[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('#DataStart(Expanded)'));
  const end = lines.findIndex((l) => l.startsWith('#DataEnd(Expanded)'));
  if (start < 0 || end < start) throw new Error('TVTMS: no expanded section');
  const rows: TvtmsRow[] = [];
  for (let i = start + 1; i < end; i++) {
    const f = lines[i].split('\t');
    if (f.length < 9 || f[0] === 'SourceType' || f[1].trim() === '' || f[3].trim() === '') continue;
    rows.push({
      line: i + 1,
      sourceType: f[0].trim(),
      source: f[1].trim(),
      standard: f[2].trim(),
      action: f[3].trim(),
      tests: f[8].trim(),
    });
  }
  return rows;
}

/** Read and parse the pinned file, failing on a checksum mismatch. */
export function readTvtms(path = TVTMS_PATH): TvtmsRow[] {
  const buf = readFileSync(path);
  const digest = createHash('sha256').update(buf).digest('hex');
  if (digest !== TVTMS.sha256) throw new Error(`TVTMS: sha256 ${digest} does not match the pin ${TVTMS.sha256}`);
  return parseTvtms(buf.toString('utf8'));
}

const PART_RE =
  /^(?:([0-9A-Za-z]{3})\.)?(?:(\d+|[A-Z]):)?(\d+|Title)(?:[!*]?([a-z]+\d*|\d+))?(?:-(?:(\d+):)?(\d+)?([a-z]+)?)?$/;

/** Last verse of a chapter, for ranges that cross a chapter (`Gen.2:25-3:1`). */
export type LastVerse = (book: string, chapter: number) => number | undefined;

/**
 * Parse a TVTMS reference list such as `Gen.5:32; 6:1`, `Est.1:1; 2:1,3-4`,
 * `Gen.2:25-3:1`, `Rev.13:1!a`, `Psa.3:Title` or `Est.1:1a-c` into single
 * references. Titles are verse 0. A list may switch books (`Sir.1:1; Est.2:2`).
 *
 * Subverse `!0` is the verse's ordinary text, the text "found in all Bibles"
 * (TVTMS field notes), so it becomes the whole verse (segment `''`). A range
 * across chapters needs `last` to list the rest of the first chapter.
 */
export function parseStandardRefs(text: string, last?: LastVerse): Ref[] {
  const out: Ref[] = [];
  let book = '';
  let chapter = 0;
  for (const group of text.split(';')) {
    let firstInGroup = true;
    for (const raw of group.split(',')) {
      const part = raw.trim();
      if (part === '') continue;
      const m = PART_RE.exec(part);
      if (!m) throw new Error(`TVTMS: unreadable reference "${part}" in "${text}"`);
      const [, b, c, v, seg, endC, endV, endSeg] = m;
      if (b) book = usfm(b);
      if (c) {
        if (!/^\d+$/.test(c)) throw new Error(`TVTMS: lettered chapter in "${text}"`);
        chapter = Number(c);
      } else if (firstInGroup && !b && out.length === 0) {
        throw new Error(`TVTMS: no chapter in "${text}"`);
      }
      if (!book) throw new Error(`TVTMS: no book in "${text}"`);
      firstInGroup = false;
      const verse = v === 'Title' ? 0 : Number(v);
      const segment = seg === undefined || seg === '0' ? '' : seg;
      if (endV === undefined && endSeg !== undefined) {
        // A segment range in one verse: `1:1a-c`.
        if (segment.length !== 1 || endSeg.length !== 1 || endSeg < segment) {
          throw new Error(`TVTMS: unreadable segment range in "${text}"`);
        }
        for (let x = segment.charCodeAt(0); x <= endSeg.charCodeAt(0); x++) {
          out.push({ book, chapter, verse, segment: String.fromCharCode(x) });
        }
        continue;
      }
      if (endV === undefined) {
        out.push({ book, chapter, verse, segment });
        continue;
      }
      if (segment !== '' || endSeg !== undefined) throw new Error(`TVTMS: a verse range with segments in "${text}"`);
      const toChapter = endC === undefined ? chapter : Number(endC);
      const toVerse = Number(endV);
      if (toChapter < chapter || (toChapter === chapter && toVerse < verse)) {
        throw new Error(`TVTMS: range ends before it starts in "${text}"`);
      }
      for (let ch = chapter; ch <= toChapter; ch++) {
        const from = ch === chapter ? verse : 1;
        let to = toVerse;
        if (ch < toChapter) {
          const l = last?.(book, ch);
          if (l === undefined) throw new Error(`TVTMS: no verse count for ${book} ${ch} in "${text}"`);
          to = l;
        }
        for (let x = from; x <= to; x++) out.push({ book, chapter: ch, verse: x, segment: '' });
      }
      chapter = toChapter;
    }
  }
  return out;
}

/**
 * TVTMS Standard numbering is KJV numbering for the 66 protestant books
 * (ADR-0006). A Standard reference past KJV's last verse there has no USFM
 * home: Est.10:4-16:24 is the Greek additions in KJV-Apocrypha layout, which
 * belongs to `ESG` or an additions book (an open question in
 * research/canons.md), and 1Ki.5:32 (line 6534) is past 1 Kings 5's 18
 * verses. Rows naming one are skipped, like `Ade` rows.
 */
const PROTESTANT_BOOKS: ReadonlySet<string> = new Set(canonBookCodes(PROTESTANT));

function checkKjvExtent(refs: readonly Ref[], kjv: Scheme, text: string): void {
  for (const r of refs) {
    if (!PROTESTANT_BOOKS.has(r.book)) continue;
    const counts = kjv.verseCounts.get(r.book);
    if (!counts) continue;
    const l = counts[r.chapter - 1];
    if (l === undefined || r.verse > l) throw new Error(`TVTMS: "${text}" is past KJV's ${r.book} (no USFM home)`);
  }
}

const TEST_RE = /^(?:([0-9A-Za-z]{3})\.)?(\d+|[A-Z]):(\d+|Title)(?:\.(\d+))?=(Exist|NotExist|Last)$/;

/** What TVTMS's text tests read from one edition (ADR-0006 amendment, text tests). */
export interface EditionText {
  /** The edition's abbreviation, for messages. */
  readonly edition: string;
  readonly books: ReadonlySet<string>;
  /**
   * Word tokens per verse, keyed `BOOK c:v`. A verse that isn't here has 0.
   * A bridge's words count under every number it holds (`\v 20-21` gives 20
   * and 21 the same count), so a test of its later number sees its text. No
   * tested verse is in a bridge in the pinned editions
   * (research/tvtms-text-tests.md).
   */
  readonly words: ReadonlyMap<string, number>;
  /** Chapters with a psalm title before verse 1, keyed `BOOK c`. */
  readonly titled: ReadonlySet<string>;
}

/** An empty EditionText for addBookText to fill. */
export function editionText(edition: string) {
  return { edition, books: new Set<string>(), words: new Map<string, number>(), titled: new Set<string>() };
}

/**
 * Add one book's tokens to an edition's text facts. A psalm title counts as
 * text before verse 1 when its block comes before the chapter's first verse-1
 * token. Section headings are not canonical text and don't count. `verses`
 * gives each bridge, whose count is copied to its later numbers.
 */
export function addBookText(
  into: ReturnType<typeof editionText>,
  book: string,
  blocks: readonly Block[],
  tokens: readonly Token[],
  verses: readonly Omit<VerseText, 'text'>[],
): void {
  into.books.add(book);
  const firstVerse1 = new Map<number, number>();
  for (const t of tokens) {
    if (t.verse === null) continue;
    if (t.kind === 'word') {
      const k = `${book} ${t.chapter}:${t.verse}`;
      into.words.set(k, (into.words.get(k) ?? 0) + 1);
    }
    if (t.verse === 1 && !firstVerse1.has(t.chapter)) firstVerse1.set(t.chapter, t.seq);
  }
  for (const u of verses) {
    const n = into.words.get(`${book} ${u.chapter}:${u.verse}`);
    if (n === undefined || u.segment) continue;
    for (let v = u.verse + 1; v <= u.lastVerse; v++) into.words.set(`${book} ${u.chapter}:${v}`, n);
  }
  const marker = new Map(blocks.map((b) => [b.id, b.marker]));
  for (const t of tokens) {
    // a title is verse 0 where the scheme numbers it so, or else an unnumbered \d
    if (t.verse !== 0 && (t.verse !== null || marker.get(t.blockId) !== 'd')) continue;
    if (t.seq < (firstVerse1.get(t.chapter) ?? Infinity)) into.titled.add(`${book} ${t.chapter}`);
  }
}

/**
 * A word test decides only when its two sides differ by at least this share
 * of the larger. TVTMS's Philippians 1:16-17 test reads KJV's 15 against 16
 * words as the Greek order (research/tvtms-text-tests.md).
 */
export const WORD_TEST_MARGIN = 0.2;

const TEXT_BEFORE_RE = /^([0-9A-Za-z]{3})\.(\d+):TextBeforeV1=(Exist|NotExist)$/;
const WORD_TERM_RE = /^([0-9A-Za-z]{3})\.(\d+):(\d+)(?:\*(\d+))?$/;
const isTextTest = (t: string) => /TextBeforeV/i.test(t) || /[<>]/.test(t);

function bookOrNull(abbr: string): string | null {
  try {
    return usfm(abbr);
  } catch {
    return null; // a book no edition has, such as Ade
  }
}

/** A word test side such as `Mal.3:22+Mal.3:24` or `1Ki.10:21*2`; null when the edition lacks a book. */
function wordSide(side: string, text: EditionText): number | null {
  let n = 0;
  for (const term of side.split('+')) {
    const m = WORD_TERM_RE.exec(term.trim());
    if (!m) throw new Error(`TVTMS: unreadable word test side "${side}"`);
    const book = bookOrNull(m[1]);
    if (book === null || !text.books.has(book)) return null;
    n += (text.words.get(`${book} ${m[2]}:${m[3]}`) ?? 0) * Number(m[4] ?? 1);
  }
  return n;
}

/**
 * One text test against one edition: `close` when a word test's sides differ
 * by less than WORD_TEST_MARGIN, `no-book` when the edition lacks a book the
 * test names.
 */
export function evaluateTextTest(test: string, text: EditionText): boolean | 'close' | 'no-book' {
  const tb = TEXT_BEFORE_RE.exec(test);
  if (tb) {
    const book = bookOrNull(tb[1]);
    if (book === null || !text.books.has(book)) return 'no-book';
    const titled = text.titled.has(`${book} ${tb[2]}`);
    return tb[3] === 'Exist' ? titled : !titled;
  }
  const m = /^(.+?)([<>])(.+)$/.exec(test);
  if (!m) throw new Error(`TVTMS: unreadable test "${test}"`);
  const a = wordSide(m[1], text);
  const b = wordSide(m[3], text);
  if (a === null || b === null) return 'no-book';
  if (a === b || Math.abs(a - b) < WORD_TEST_MARGIN * Math.max(a, b)) return 'close';
  return m[2] === '>' ? a > b : a < b;
}

/**
 * A row's text tests across a scheme's editions. An edition decides the row
 * when it has every book the tests name; every edition that decides it must
 * agree, and none may be close, or the row stays undecided.
 */
function textTestsResult(tests: readonly string[], texts: readonly EditionText[]): boolean | 'needs-text' {
  let agreed: boolean | null = null;
  for (const text of texts) {
    const results = tests.map((t) => evaluateTextTest(t, text));
    if (results.includes('no-book')) continue;
    if (!results.includes(false) && results.includes('close')) return 'needs-text';
    const result = !results.includes(false);
    if (agreed !== null && agreed !== result) return 'needs-text';
    agreed = result;
  }
  return agreed ?? 'needs-text';
}

/**
 * Evaluate one row's tests against a scheme's tables, and its text tests
 * against the scheme's editions. Without editions, a row that passes its
 * count tests and has text tests needs text.
 */
export function evaluateTests(
  tests: string,
  s: Scheme,
  sourceBook = '',
  texts: readonly EditionText[] = [],
): boolean | 'needs-text' {
  if (tests === '') return true;
  const textTests: string[] = [];
  // A test without a book (`33:31=Exist`) uses the book of the test before it,
  // or the row's source book (TVTMS lines 23687-23691 omit `Sir.`).
  let lastBook = sourceBook;
  for (const raw of tests.split('&')) {
    const t = raw.trim();
    if (t === '') continue;
    if (isTextTest(t)) {
      textTests.push(t);
      continue;
    }
    const m = TEST_RE.exec(t);
    if (!m) throw new Error(`TVTMS: unreadable test "${t}"`);
    const [, given, c, v, sub, kind] = m;
    const b = given ?? lastBook;
    if (b === '') throw new Error(`TVTMS: test "${t}" names no book`);
    lastBook = b;
    let book: string | null;
    try {
      book = usfm(b);
    } catch {
      book = null; // a book no scheme has, such as Ade
    }
    const chapter = /^\d+$/.test(c) ? Number(c) : null;
    const verse = v === 'Title' ? 0 : Number(v);
    let result: boolean;
    if (book === null || chapter === null) {
      result = kind === 'NotExist';
    } else if (kind === 'Last') {
      result = lastVerse(s, book, chapter) === verse;
    } else {
      let exists: boolean;
      if (verse === 0) exists = s.titles.has(`${book} ${chapter}`);
      else {
        const last = lastVerse(s, book, chapter);
        exists = last !== undefined && verse <= last && !s.excluded.has(`${book} ${chapter}:${verse}`);
      }
      if (exists && sub !== undefined && Number(sub) > 0) {
        // Subverse n exists when the verse has at least n + 1 parts (part 0 is the unmarked text).
        exists = (s.segments.get(`${book} ${chapter}:${verse}`)?.length ?? 1) > Number(sub);
      }
      result = kind === 'Exist' ? exists : !exists;
    }
    if (!result) return false;
  }
  return textTests.length === 0 ? true : textTestsResult(textTests, texts);
}

export interface Compiled {
  readonly rows: MappingRow[];
  /** Keys (`refKey`) of the source references TVTMS settled for this scheme, identity included. */
  readonly decided: Set<string>;
  /** Rows whose count tests pass but whose other tests need an edition's text. */
  readonly needsText: TvtmsRow[];
  readonly skipped: { line: number; reason: string }[];
}

/**
 * Compile TVTMS for one scheme: keep rows whose tests pass against its tables
 * and its editions' text, and drop references that land on themselves (the
 * table is sparse).
 *
 * A source reference counts as decided only when every passing row for it
 * gives the same non-empty targets and no row that needs text gives other
 * targets. Otherwise the count tests can't choose (Hebrew Esther 1:1 against
 * Greek Esther 1:1 with an addition; TVTMS's untested `AllBibles` notes such
 * as 1Ki.22:44), and the `.vrs` row is used instead.
 *
 * `seed` is the pivot before TVTMS: its counts finish ranges that cross a
 * chapter, and its 66 protestant books (KJV numbering) bound Standard refs.
 */
export function compileTvtms(
  all: readonly TvtmsRow[],
  s: Scheme,
  seed: Scheme,
  texts: readonly EditionText[] = [],
): Compiled {
  const needsText: TvtmsRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  const ownLast: LastVerse = (b, c) => lastVerse(s, b, c);
  const seedLast: LastVerse = (b, c) => lastVerse(seed, b, c);
  /** Source key → each passing row's targets for it. */
  const candidates = new Map<string, { from: Ref; row: TvtmsRow; to: Ref[] }[]>();
  /** Source key → target signatures of rows that need text. */
  const textSigs = new Map<string, Set<string>>();
  for (const row of all) {
    let result: boolean | 'needs-text';
    let froms: Ref[];
    let tos: Ref[];
    try {
      result = evaluateTests(row.tests, s, row.source.slice(0, 3), texts);
      if (result === false) continue;
      froms = parseStandardRefs(row.source, ownLast);
      tos = parseStandardRefs(row.standard, seedLast);
      checkKjvExtent(tos, seed, row.standard);
    } catch (e) {
      skipped.push({ line: row.line, reason: (e as Error).message });
      continue;
    }
    for (const from of froms) {
      const k = refKey(from);
      if (result === 'needs-text') (textSigs.get(k) ?? textSigs.set(k, new Set()).get(k)!).add(verseSig(tos));
      else (candidates.get(k) ?? candidates.set(k, []).get(k)!).push({ from, row, to: tos });
    }
    if (result === 'needs-text') needsText.push(row);
  }

  const rows: MappingRow[] = [];
  const decided = new Set<string>();
  const identities: MappingRow[] = [];
  for (const [k, list] of candidates) {
    // Rows that name the same verses at different grain agree: TVTMS line
    // 25819 sends 2Es.7:36-105 to 7:35 while lines 25820-25889 send each verse
    // to a subverse of 7:35. Take the finest.
    const verseSigs = new Set(list.map((c) => verseSig(c.to)));
    const [onlyVerses] = verseSigs;
    const finest = list.reduce((a, b) => (segmentCount(b.to) > segmentCount(a.to) ? b : a));
    const textDisagrees = [...(textSigs.get(k) ?? [])].some((t) => t !== onlyVerses);
    if (verseSigs.size > 1 || onlyVerses === '' || textDisagrees) {
      for (const c of list) if (!needsText.includes(c.row)) needsText.push(c.row);
      continue;
    }
    const { from, to, row } = finest;
    decided.add(k);
    const mapped = to.map((t): MappingRow => ({ scheme: s.id, from, to: t, kind: row.action, source: 'tvtms' }));
    if (to.length === 1 && refKey(to[0]) === k) identities.push(mapped[0]);
    else rows.push(...mapped);
  }
  // A whole verse that keeps its number must say so when one of its parts
  // moves (Latin Sir 18:1 stays, 18:1b becomes 18:2), or the parts' rows
  // would carry the whole verse with them.
  const verse = (r: Ref) => `${r.book} ${r.chapter}:${r.verse}`;
  const moved = new Set(rows.map((r) => verse(r.from)));
  for (const id of identities) if (moved.has(verse(id.from))) rows.push(id);
  return { rows, decided, needsText, skipped };
}

/** The verses a target list names, ignoring segments. */
const verseSig = (to: readonly Ref[]) => [...new Set(to.map((r) => `${r.book} ${r.chapter}:${r.verse}`))].sort().join();
const segmentCount = (to: readonly Ref[]) => to.filter((r) => r.segment !== '').length;

/**
 * Grow the pivot to hold every Standard reference TVTMS names: new books,
 * longer chapters, titles and subverses. Existing segments keep their order
 * and new ones are appended, so no id is removed. References past KJV's
 * extent in the 66 protestant books are left out (see checkKjvExtent).
 */
export function extendPivot(pivot: Scheme, all: readonly TvtmsRow[], seed: Scheme = pivot): Scheme {
  const verseCounts = new Map([...pivot.verseCounts].map(([b, c]) => [b, [...c]]));
  const segments = new Map([...pivot.segments].map(([k, v]) => [k, [...v]]));
  const titles = new Set(pivot.titles);
  const seedLast: LastVerse = (b, c) => lastVerse(seed, b, c);
  for (const row of all) {
    let refs: Ref[];
    try {
      refs = parseStandardRefs(row.standard, seedLast);
      checkKjvExtent(refs, seed, row.standard);
    } catch {
      continue;
    }
    for (const r of refs) {
      const counts = verseCounts.get(r.book) ?? verseCounts.set(r.book, []).get(r.book)!;
      while (counts.length < r.chapter) counts.push(0);
      if (r.verse === 0) titles.add(`${r.book} ${r.chapter}`);
      else counts[r.chapter - 1] = Math.max(counts[r.chapter - 1], r.verse);
      if (r.segment !== '') {
        const k = `${r.book} ${r.chapter}:${r.verse}`;
        const segs = segments.get(k) ?? segments.set(k, []).get(k)!;
        if (!segs.includes(r.segment)) segs.push(r.segment);
      }
    }
  }
  return { ...pivot, verseCounts, segments, titles };
}

/**
 * How eng reaches the pivot for the `.vrs` witness: TVTMS's eng rows for every
 * eng reference TVTMS settled (an identity decision becomes an explicit
 * self-row), and ENG_TO_PIVOT for the rest. Without this, pivot 2ES 7:36 would
 * mean NRSV 7:36 in `.vrs` rows and KJV 7:36 (NRSV 7:106) in TVTMS rows.
 */
export function engToPivotRows(eng: Compiled): { from: Ref; to: Ref | null }[] {
  const out: { from: Ref; to: Ref | null }[] = eng.rows.map((r) => ({ from: r.from, to: r.to }));
  const moved = new Set(eng.rows.map((r) => refKey(r.from)));
  for (const key of eng.decided) {
    if (moved.has(key)) continue;
    const r = parseRefKey(key);
    out.push({ from: r, to: r });
  }
  for (const f of ENG_TO_PIVOT) if (!eng.decided.has(refKey(f.from))) out.push(f);
  return out;
}

/**
 * The mapping rows to store: TVTMS rows for every source reference TVTMS
 * settled, and `.vrs` rows for the rest (references TVTMS never names, or
 * names only with tests that need an edition's text).
 */
export function mergeWitnesses(
  compiled: ReadonlyMap<string, Compiled>,
  vrsRows: readonly MappingRow[],
): MappingRow[] {
  const out: MappingRow[] = [];
  for (const [id, c] of compiled) {
    out.push(...c.rows);
    for (const r of vrsRows) {
      if (r.scheme === id && !c.decided.has(refKey(r.from))) out.push({ ...r, source: 'vrs' });
    }
  }
  return out;
}

/**
 * Where TVTMS and the `.vrs` files send the same verse to different pivot
 * references, over the verses TVTMS settled. Per scheme, one line per verse:
 * `REF<tab>tvtms: A, B<tab>vrs: C`. Reported, never resolved (ADR-0006).
 * A scheme has a `.vrs` witness if it is a Paratext scheme or a derived
 * scheme that takes `.vrs` rows from its base (pivot.ts). Schemes without one
 * (`kjv`, `rp`) are left out of the map. `web` has one through the eng rows
 * it takes for its deuterocanon.
 */
export function diffWitnesses(
  compiled: ReadonlyMap<string, Compiled>,
  vrsRows: readonly MappingRow[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [id, c] of compiled) {
    const own = vrsRows.filter((r) => r.scheme === id);
    if (!PARATEXT_SCHEMES.some((p) => p.id === id) && own.length === 0) continue;
    const a = new Relation(c.rows);
    const b = new Relation(own);
    const lines: string[] = [];
    for (const key of [...c.decided].sort()) {
      const r = parseRefKey(key);
      const ta = a.forward(r).map(refKey).sort();
      const tb = b.forward(r).map(refKey).sort();
      if (ta.join() !== tb.join()) lines.push(`${key}\ttvtms: ${ta.join(', ') || 'absent'}\tvrs: ${tb.join(', ') || 'absent'}`);
    }
    out.set(id, lines);
  }
  return out;
}

export interface CompiledMappings {
  readonly pivot: Scheme;
  /** Rows to store: TVTMS where it decides, `.vrs` elsewhere. */
  readonly rows: MappingRow[];
  readonly perScheme: Map<string, Compiled>;
  /** Per scheme with a `.vrs` witness, the verses where TVTMS and `.vrs` disagree. */
  readonly diff: Map<string, string[]>;
  /**
   * Per edition, the verses its own text results map differently from its
   * scheme's rows: `REF<tab>EDITION: A<tab>SCHEME: B`. The ingest stops on any.
   */
  readonly conflicts: Map<string, string[]>;
}

/**
 * The stored pivot. The seed pivot (kjv's 66 books, eng's other books as eng
 * numbers them) compiles TVTMS. The stored pivot then takes eng's other books
 * where TVTMS sends eng's verses, so a TVTMS Standard id means one thing in
 * every row (2ES 7 has KJV's 70 verses, with NRSV 7:36-105 as subverses of
 * 7:35), and grows by every Standard reference. It reads no edition text, so
 * the ingest can seed it before the editions.
 */
export function compilePivot(schemes: ReadonlyMap<string, Scheme>, tvtms: readonly TvtmsRow[]) {
  const seed = buildPivot(schemes);
  const engRows = engToPivotRows(compileTvtms(tvtms, schemes.get('eng')!, seed));
  return { seed, engRows, pivot: extendPivot(buildPivot(schemes, engRows), tvtms, seed) };
}

/**
 * The whole ADR-0006 build. `texts` holds each scheme's editions for the
 * text tests (ADR-0006 amendment, text tests); a scheme without editions
 * leaves its text-dependent rows undecided.
 */
export function compileMappings(
  schemes: ReadonlyMap<string, Scheme>,
  tvtms: readonly TvtmsRow[],
  texts: ReadonlyMap<string, readonly EditionText[]> = new Map(),
): CompiledMappings {
  // The pivot comes from eng's rows without text, so eng's stored rows must not use any.
  if (texts.has('eng')) throw new Error('an edition under eng would make its rows differ from the pivot build (compilePivot)');
  const { seed, engRows, pivot } = compilePivot(schemes, tvtms);
  const perScheme = new Map(
    [...schemes.keys()].map((id) => [id, compileTvtms(tvtms, schemes.get(id)!, seed, texts.get(id) ?? [])]),
  );
  const vrsRows = allVrsPivotRows(schemes, engRows);
  const rows = mergeWitnesses(perScheme, vrsRows);
  return {
    pivot,
    rows,
    perScheme,
    diff: diffWitnesses(perScheme, vrsRows),
    conflicts: editionConflicts(schemes, tvtms, seed, texts, vrsRows, rows),
  };
}

/**
 * Compile each edition of a multi-edition scheme on its own text and compare
 * the verses it decides with the scheme's stored rows. A difference means the
 * edition needs a derived scheme (ADR-0002).
 */
function editionConflicts(
  schemes: ReadonlyMap<string, Scheme>,
  tvtms: readonly TvtmsRow[],
  seed: Scheme,
  texts: ReadonlyMap<string, readonly EditionText[]>,
  vrsRows: readonly MappingRow[],
  rows: readonly MappingRow[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const targets = (rel: Relation, r: Ref) => rel.forward(r).map(refKey).sort().join(', ') || 'absent';
  for (const [id, editions] of texts) {
    if (editions.length < 2) continue;
    const scheme = new Relation(rows.filter((r) => r.scheme === id));
    for (const text of editions) {
      const own = compileTvtms(tvtms, schemes.get(id)!, seed, [text]);
      const mine = new Relation(mergeWitnesses(new Map([[id, own]]), vrsRows));
      const lines: string[] = [];
      for (const key of [...own.decided].sort()) {
        const r = parseRefKey(key);
        const a = targets(mine, r);
        const b = targets(scheme, r);
        if (a !== b) lines.push(`${key}\t${text.edition}: ${a}\t${id}: ${b}`);
      }
      if (lines.length > 0) out.set(text.edition, lines);
    }
  }
  return out;
}

/** The committed form of the edition text facts (fixtures/edition-text.json). */
export type EditionTextSnapshot = Record<
  string,
  { scheme: string; books: string[]; words: Record<string, number>; titled: string[] }
>;

/**
 * The facts TVTMS's text tests read, limited to the verses and chapters the
 * tests name. Tests compile mappings from the committed copy without a
 * corpus; the ingest writes a fresh one to compare.
 */
export function editionTextSnapshot(
  editions: readonly { scheme: string; text: EditionText }[],
  tvtms: readonly TvtmsRow[],
): EditionTextSnapshot {
  const verses = new Set<string>();
  const chapters = new Set<string>();
  for (const row of tvtms) {
    for (const raw of row.tests.split('&')) {
      const t = raw.trim();
      if (!isTextTest(t)) continue;
      const tb = TEXT_BEFORE_RE.exec(t);
      if (tb) {
        const book = bookOrNull(tb[1]);
        if (book) chapters.add(`${book} ${tb[2]}`);
        continue;
      }
      for (const term of t.split(/[<>+]/)) {
        const m = WORD_TERM_RE.exec(term.trim());
        const book = m && bookOrNull(m[1]);
        if (book) verses.add(`${book} ${m[2]}:${m[3]}`);
      }
    }
  }
  const out: EditionTextSnapshot = {};
  for (const { scheme, text } of editions) {
    out[text.edition] = {
      scheme,
      books: [...text.books].sort(),
      words: Object.fromEntries([...text.words].filter(([k]) => verses.has(k)).sort(([a], [b]) => a.localeCompare(b))),
      titled: [...text.titled].filter((k) => chapters.has(k)).sort(),
    };
  }
  return out;
}

/** Read a snapshot back as each scheme's editions. */
export function editionTextsFromSnapshot(snapshot: EditionTextSnapshot): Map<string, EditionText[]> {
  const out = new Map<string, EditionText[]>();
  for (const [edition, e] of Object.entries(snapshot)) {
    const text: EditionText = {
      edition,
      books: new Set(e.books),
      words: new Map(Object.entries(e.words)),
      titled: new Set(e.titled),
    };
    out.set(e.scheme, [...(out.get(e.scheme) ?? []), text]);
  }
  return out;
}

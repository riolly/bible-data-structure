/**
 * STEPBible TVTMS compiled to per-scheme mapping rows (ADR-0006).
 *
 * TVTMS's expanded section has one row per verse: SourceRef (a verse in some
 * Bible), StandardRef (where it goes in Standard numbering, which is the
 * pivot), an Action, and Tests that must all be true of that Bible. TVTMS
 * says its SourceType column "isn't used in programming", so rows are picked
 * by their tests alone.
 *
 * For a scheme, the tests run against its verse-count table: `=Exist`,
 * `=NotExist`, `=Last`, and subverse counts from its segment lines. Word-count
 * tests (`<`, `>`) and `TextBeforeV1` need an edition's text; rows that depend
 * on them are returned as `needsText` and not compiled.
 *
 * The file is CC BY 4.0 and STEPBible asks that it not be re-posted, so it is
 * downloaded to sources/tvtms/ (sources.ts pins it) and never committed.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BOOK_BY_CODE } from '../model/books';
import { Relation, refKey, type MappingRow, type Ref } from '../model/mapping';
import { lastVerse, type Scheme } from '../model/scheme';
import { ENG_TO_PIVOT, allVrsPivotRows, buildPivot } from './pivot';
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

/**
 * Parse a TVTMS reference list such as `Gen.5:32; 6:1`, `Est.1:1; 2:1,3-4`,
 * `Gen.2:25-3:1`, `Rev.13:1!a`, `Psa.3:Title` or `Est.1:1a-c` into single
 * references. Titles are verse 0. A list may switch books (`Sir.1:1; Est.2:2`).
 */
export function parseStandardRefs(text: string): Ref[] {
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
      const segment = seg ?? '';
      if (endV === undefined && endSeg !== undefined) {
        // A segment range in one verse: `1:1a-c`.
        for (let s = segment.charCodeAt(0); s <= endSeg.charCodeAt(0); s++) {
          out.push({ book, chapter, verse, segment: String.fromCharCode(s) });
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
      if (toChapter === chapter) {
        for (let x = verse; x <= toVerse; x++) out.push({ book, chapter, verse: x, segment: '' });
      } else {
        // `Gen.2:25-3:1`: the end of one chapter and the start of the next. Only
        // the named ends are listed; the verses between come from the counts.
        out.push({ book, chapter, verse, segment: '' });
        for (let x = 1; x <= toVerse; x++) out.push({ book, chapter: toChapter, verse: x, segment: '' });
      }
      chapter = toChapter;
    }
  }
  return out;
}

const TEST_RE = /^(?:([0-9A-Za-z]{3})\.)?(\d+|[A-Z]):(\d+|Title)(?:\.(\d+))?=(Exist|NotExist|Last)$/;

/** Evaluate one row's tests against a scheme's tables. */
export function evaluateTests(tests: string, s: Scheme, sourceBook = ''): boolean | 'needs-text' {
  if (tests === '') return true;
  let needsText = false;
  // A test without a book (`33:31=Exist`) uses the book of the test before it,
  // or the row's source book (TVTMS lines 23687-23691 omit `Sir.`).
  let lastBook = sourceBook;
  for (const raw of tests.split('&')) {
    const t = raw.trim();
    if (t === '') continue;
    if (/TextBeforeV/i.test(t) || /[<>]/.test(t)) {
      needsText = true;
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
  return needsText ? 'needs-text' : true;
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
 * Compile TVTMS for one scheme: keep rows whose tests pass against its tables,
 * merge their targets per source reference, and drop references that land on
 * themselves (the table is sparse).
 */
export function compileTvtms(all: readonly TvtmsRow[], s: Scheme): Compiled {
  const needsText: TvtmsRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  /** Source key → each passing row's targets for it. */
  const candidates = new Map<string, { from: Ref; row: TvtmsRow; to: Ref[] }[]>();
  for (const row of all) {
    let result: boolean | 'needs-text';
    let froms: Ref[];
    let tos: Ref[];
    try {
      result = evaluateTests(row.tests, s, row.source.slice(0, 3));
      if (result === false) continue;
      froms = parseStandardRefs(row.source);
      tos = parseStandardRefs(row.standard);
    } catch (e) {
      skipped.push({ line: row.line, reason: (e as Error).message });
      continue;
    }
    if (result === 'needs-text') {
      needsText.push(row);
      continue;
    }
    for (const from of froms) {
      const k = refKey(from);
      (candidates.get(k) ?? candidates.set(k, []).get(k)!).push({ from, row, to: tos });
    }
  }
  const rows: MappingRow[] = [];
  const decided = new Set<string>();
  const sig = (to: Ref[]) => to.map(refKey).sort().join();
  for (const list of candidates.values()) {
    // Rows that pass the count tests but disagree can only be told apart by
    // the text (Hebrew Esther 1:1 versus Greek Esther 1:1 with an addition).
    if (new Set(list.map((c) => sig(c.to))).size > 1) {
      for (const c of list) if (!needsText.includes(c.row)) needsText.push(c.row);
      continue;
    }
    const { from, to, row } = list[0];
    decided.add(refKey(from));
    if (to.length === 1 && refKey(to[0]) === refKey(from)) continue;
    for (const t of to) rows.push({ scheme: s.id, from, to: t, kind: row.action, source: 'tvtms' });
  }
  return { rows, decided, needsText, skipped };
}

/**
 * Grow the pivot to hold every Standard reference TVTMS names: new books,
 * longer chapters, titles and subverses. Existing segments keep their order
 * and new ones are appended, so nothing is removed or reassigned.
 */
export function extendPivot(pivot: Scheme, all: readonly TvtmsRow[]): Scheme {
  const verseCounts = new Map([...pivot.verseCounts].map(([b, c]) => [b, [...c]]));
  const segments = new Map([...pivot.segments].map(([k, v]) => [k, [...v]]));
  const titles = new Set(pivot.titles);
  for (const row of all) {
    let refs: Ref[];
    try {
      refs = parseStandardRefs(row.standard);
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
    const m = /^(\S+) (\d+):(\d+)([a-z0-9]*)$/.exec(key)!;
    const r = { book: m[1], chapter: Number(m[2]), verse: Number(m[3]), segment: m[4] };
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
 */
export function diffWitnesses(
  compiled: ReadonlyMap<string, Compiled>,
  vrsRows: readonly MappingRow[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [id, c] of compiled) {
    const a = new Relation(c.rows);
    const b = new Relation(vrsRows.filter((r) => r.scheme === id));
    const lines: string[] = [];
    for (const key of [...c.decided].sort()) {
      const m = /^(\S+) (\d+):(\d+)([a-z0-9]*)$/.exec(key)!;
      const r = { book: m[1], chapter: Number(m[2]), verse: Number(m[3]), segment: m[4] };
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
  /** Per scheme, the verses where TVTMS and `.vrs` disagree. */
  readonly diff: Map<string, string[]>;
}

/** The whole ADR-0006 build: pivot, TVTMS per scheme, `.vrs` fill-in, and the witness diff. */
export function compileMappings(schemes: ReadonlyMap<string, Scheme>, tvtms: readonly TvtmsRow[]): CompiledMappings {
  const pivot = extendPivot(buildPivot(schemes), tvtms);
  const perScheme = new Map([...schemes.keys()].map((id) => [id, compileTvtms(tvtms, schemes.get(id)!)]));
  const vrsRows = allVrsPivotRows(schemes, engToPivotRows(perScheme.get('eng')!));
  return {
    pivot,
    rows: mergeWitnesses(perScheme, vrsRows),
    perScheme,
    diff: diffWitnesses(perScheme, vrsRows),
  };
}

/**
 * The app contract (contract.ts) over the corpus DB, `build/corpus.db` today.
 * It reads through a `CorpusReader` (reader.ts): a DB's, or a provider's own
 * (src/provider/provider.ts), so it runs on either sync drizzle driver. A
 * reader answers in whole chapters, and the
 * rules for finding a verse in a chapter's units (a bridge, a segment, a
 * verse printed in parts) live here, on `holdsVerse`. Nothing from the DB
 * leaves here but addresses, text, documents and stamps.
 */

import type { SyncSqliteDb } from '../db/corpus-read';
import { verseWords } from '../ingest/tokenize';
import { formatAddress, parseAddress, type Address, type VerseRef } from '../model/address';
import { holdsVerse, verseNumbers, verseUnitOf, type VerseText } from '../model/corpus';
import { PIVOT, refExists, type Mappings, type Ref } from '../model/mapping';
import { lastVerse, type Scheme } from '../model/scheme';
import type {
  Absent,
  AbsentReason,
  BibleContract,
  BookInfo,
  ChapterResult,
  Credit,
  EditionInfo,
  EditionStamp,
  Lookup,
  MapKind,
  MapResult,
  Parts,
  PassagePart,
  PassageResult,
  ResolveResult,
  Verse,
  VerseTextResult,
  Word,
  WordsResult,
} from './contract';
import { dbReader, type AlignedOriginal, type ChapterUnits, type CorpusReader, type EditionRow, type ListedBook } from './reader';
import { parseReference, type BookRange } from './reference';
import { RIGHTS, type RightsRecord } from './rights';

export function corpusContract(db: SyncSqliteDb): BibleContract {
  return readerContract(dbReader(db));
}

/**
 * The contract over any reader. A call first reads every chapter it needs,
 * at once, and awaits the ones the reader doesn't hold yet. It keeps no
 * chapter between calls, so the next call sees a chapter the reader has
 * refreshed.
 */
export function readerContract(read: CorpusReader): BibleContract {
  const schemes = read.schemes();
  const editions = new Map<string, EditionStamp>();
  let mappings: Mappings | undefined;
  let bookList: readonly ListedBook[] | undefined;

  const stampOf = (row: EditionRow): EditionStamp => ({
    id: row.abbrev,
    scheme: row.scheme,
    stamp: row.edition,
    wordsStamp: row.wordsStamp,
    textStamp: row.textStamp,
  });

  function edition(id: string): EditionStamp {
    const cached = editions.get(id);
    if (cached) return cached;
    const row = read.edition(id);
    if (!row) throw new Error(`unknown edition "${id}"`);
    const e = stampOf(row);
    editions.set(id, e);
    return e;
  }

  const schemeOf = (e: EditionStamp): Scheme => schemes.get(e.scheme)!;

  /** `JHN 3:16` or `JHN 3:16/kjv` → an address under the edition's scheme. */
  function ownAddress(e: EditionStamp, text: string, call: string): Address {
    const a = parseAddress(text.includes('/') ? text : `${text}/${e.scheme}`);
    if (a.scheme !== e.scheme) {
      throw new Error(`${call}: "${text}" names scheme ${a.scheme}, but ${e.id} uses ${e.scheme}. Use resolve for an address under another scheme`);
    }
    return a;
  }

  /** `JHN 3:16` or `JHN 3:16/kjv` → one verse ref under the edition's scheme. */
  function verseRef(e: EditionStamp, text: string, call: string): VerseRef {
    const a = ownAddress(e, text, call);
    if (a.end || a.start.wordIndex !== undefined) throw new Error(`${call}: "${text}" is not one verse`);
    return a.start;
  }

  const point = (e: EditionStamp, r: Ref): string =>
    formatAddress({ scheme: e.scheme, start: { book: r.book, chapter: r.chapter, verse: r.verse, segment: r.segment } });

  const absent = (address: string, reason: AbsentReason): Absent => ({ kind: 'absent', address, reason });

  /** The chapters one call has read, keyed `KJV JHN 3`. */
  type Read = Map<string, ChapterUnits>;
  const noUnits: ChapterUnits = { stamp: '', verses: [] };
  const chapterKey = (e: EditionStamp, book: string, chapter: number) => `${e.id} ${book} ${chapter}`;

  /**
   * Read the chapters of the refs the edition's scheme has, each once and all
   * at once, into `got`. A ref the scheme lacks reads nothing.
   */
  async function load(e: EditionStamp, refs: Iterable<Ref>, got: Read = new Map()): Promise<Read> {
    const reads: Promise<unknown>[] = [];
    for (const r of refs) {
      const key = chapterKey(e, r.book, r.chapter);
      if (got.has(key) || !refExists(schemeOf(e), r)) continue;
      got.set(key, noUnits);
      reads.push(Promise.resolve(read.chapter(e.id, r.book, r.chapter)).then((u) => got.set(key, u ?? noUnits)));
    }
    await Promise.all(reads);
    return got;
  }

  function unitsOf(got: Read, e: EditionStamp, book: string, chapter: number): ChapterUnits {
    const units = got.get(chapterKey(e, book, chapter));
    if (!units) throw new Error(`${chapterKey(e, book, chapter)} was not read before its lookup`);
    return units;
  }

  function toVerse(e: EditionStamp, book: string, u: VerseText, chapterStamp: string, part?: string): Verse {
    const start = { book, chapter: u.chapter, verse: u.verse, segment: u.segment };
    const bridge = u.lastVerse > u.verse;
    const address = formatAddress({
      scheme: e.scheme,
      start,
      end: bridge ? { ...start, verse: u.lastVerse, segment: '' } : undefined,
    });
    const v: Verse = {
      kind: bridge ? 'bridge' : 'verse',
      address,
      ...start,
      lastVerse: u.lastVerse,
      text: u.text,
      chapterStamp,
    };
    return part ? { ...v, part } : v;
  }

  /** One address in one edition: the verse, the bridge that holds it, its parts, or absent. */
  function lookup(e: EditionStamp, r: Ref, got: Read): Lookup | Parts {
    if (!refExists(schemeOf(e), r)) return absent(point(e, r), 'scheme');
    const { stamp, verses } = unitsOf(got, e, r.book, r.chapter);
    const unit = verseUnitOf(verses, r.chapter, r.verse, r.segment);
    if (unit) return toVerse(e, r.book, unit, stamp);
    if (r.segment !== '') {
      // the edition doesn't mark the part: the whole unit, flagged
      const whole = verseUnitOf(verses, r.chapter, r.verse);
      if (whole) return toVerse(e, r.book, whole, stamp, r.segment);
    } else {
      // the edition prints the verse only in parts
      const parts = verses.filter((u) => holdsVerse(u, r.verse));
      if (parts.length > 0) return { kind: 'parts', address: point(e, r), parts: parts.map((u) => toVerse(e, r.book, u, stamp)) };
    }
    return absent(point(e, r), 'text');
  }

  /** Every unit that holds each verse number of one chapter, in print order: a bridge under each of its numbers, a whole verse before its parts. */
  function unitsByVerse(units: ChapterUnits): { stamp: string; byVerse: Map<number, VerseText[]> } {
    const { stamp, verses } = units;
    const byVerse = new Map<number, VerseText[]>();
    for (const u of verses) {
      for (const v of verseNumbers(u)) {
        const list = byVerse.get(v);
        if (list) list.push(u);
        else byVerse.set(v, [u]);
      }
    }
    return { stamp, byVerse };
  }

  /** A verse of a walked range, and whether its scheme has it. */
  interface Step {
    readonly r: Ref;
    readonly exists: boolean;
  }

  /**
   * Walk a range verse by verse under one scheme, and give its address under
   * that scheme. A chapter the scheme lacks is one step, its first verse.
   */
  function walk(s: Scheme, range: BookRange): { address: string; steps: Step[] } {
    const { book } = range;
    const chapters = s.verseCounts.get(book)?.length ?? range.start.chapter;
    const endChapter = Math.min(range.end.chapter, Math.max(chapters, range.start.chapter));
    const steps: Step[] = [];
    let first: VerseRef | undefined;
    let last: VerseRef | undefined;
    for (let c = range.start.chapter; c <= endChapter; c++) {
      const from =
        c === range.start.chapter && range.start.verse !== null ? range.start.verse : s.titles.has(`${book} ${c}`) ? 0 : 1;
      const lv = lastVerse(s, book, c);
      // the end verse belongs to the end chapter, which may lie past the book's last (#9)
      const to = lv === undefined ? from - 1 : c === range.end.chapter && range.end.verse !== null ? Math.min(range.end.verse, lv) : lv;
      first ??= { book, chapter: c, verse: from, segment: '' };
      if (to < from) {
        // the scheme lacks the chapter, or the range starts past its end
        steps.push({ r: { book, chapter: c, verse: from, segment: '' }, exists: false });
        last = { book, chapter: c, verse: from, segment: '' };
        continue;
      }
      for (let v = from; v <= to; v++) {
        const r = { book, chapter: c, verse: v, segment: '' };
        steps.push({ r, exists: refExists(s, r) });
      }
      last = { book, chapter: c, verse: to, segment: '' };
    }
    const a: Address =
      first!.chapter === last!.chapter && first!.verse === last!.verse
        ? { scheme: s.id, start: first! }
        : { scheme: s.id, start: first!, end: last };
    return { address: formatAddress(a), steps };
  }

  /** The edition's units for steps under its own scheme, one read per chapter. A bridge appears once. */
  async function ownSteps(e: EditionStamp, steps: readonly Step[]): Promise<Lookup[]> {
    const got = await load(e, steps.map((step) => step.r));
    const chapters = new Map<number, ReturnType<typeof unitsByVerse>>();
    const found: Lookup[] = [];
    const seen = new Set<string>();
    for (const { r, exists } of steps) {
      if (!exists) {
        found.push(absent(point(e, r), 'scheme'));
        continue;
      }
      let units = chapters.get(r.chapter);
      if (!units) chapters.set(r.chapter, (units = unitsByVerse(unitsOf(got, e, r.book, r.chapter))));
      const held = units.byVerse.get(r.verse);
      if (!held) {
        found.push(absent(point(e, r), 'text'));
        continue;
      }
      for (const u of held) {
        const l = toVerse(e, r.book, u, units.stamp);
        if (seen.has(l.address)) continue;
        seen.add(l.address);
        found.push(l);
      }
    }
    return found;
  }

  /** A lookup and the reference it sorts by. `at` is null for an address under another scheme. */
  interface Placed {
    readonly at: Ref | null;
    readonly l: Lookup;
  }

  /** Add the edition's units for target refs under its scheme, merging the parts of one unit. `got` holds their chapters. */
  function place(e: EditionStamp, targets: readonly Ref[], out: Placed[], got: Read) {
    for (const t of targets) {
      const l = lookup(e, t, got);
      if (l.kind === 'absent') {
        if (!out.some((p) => p.l.address === l.address)) out.push({ at: t, l });
        continue;
      }
      for (const u of l.kind === 'parts' ? l.parts : [l]) {
        const i = out.findIndex((p) => p.l.kind !== 'absent' && p.l.address === u.address);
        if (i < 0) out.push({ at: u, l: u });
        else if (out[i].l.kind !== 'absent' && (out[i].l as Verse).part !== u.part) {
          // two parts of one unit, or a part and the whole: the whole unit matches
          const { part: _, ...whole } = out[i].l as Verse;
          out[i] = { at: out[i].at, l: whole };
        }
      }
    }
  }

  /**
   * Text order (#10): books in the order they first appear, then chapter,
   * verse and part. An entry with no reference keeps its place after the
   * entry before it.
   */
  function inOrder(placed: readonly Placed[]): Placed[] {
    const rank = new Map<string, number>();
    let prev: Ref | null = null;
    const keyed = placed.map((p, i) => {
      const at = p.at ?? prev;
      if (p.at) prev = p.at;
      if (at && !rank.has(at.book)) rank.set(at.book, rank.size);
      return { p, i, at };
    });
    const cmp = (a: Ref | null, b: Ref | null): number =>
      !a || !b
        ? (a ? 1 : 0) - (b ? 1 : 0)
        : rank.get(a.book)! - rank.get(b.book)! ||
          a.chapter - b.chapter ||
          a.verse - b.verse ||
          (a.segment < b.segment ? -1 : a.segment > b.segment ? 1 : 0);
    return keyed.sort((a, b) => cmp(a.at, b.at) || a.i - b.i).map((k) => k.p);
  }

  /** The edition's units for steps under another scheme, each verse moved through the pivot. */
  async function otherSteps(e: EditionStamp, scheme: string, steps: readonly Step[]): Promise<Lookup[]> {
    const m = (mappings ??= read.mappings(schemes));
    const moved = steps.map(({ r, exists }) => ({ r, targets: exists ? m.map(scheme, e.scheme, r) : [] }));
    const got = await load(e, moved.flatMap((step) => step.targets));
    const placed: Placed[] = [];
    for (const { r, targets } of moved) {
      if (targets.length > 0) place(e, targets, placed, got);
      else placed.push({ at: null, l: absent(formatAddress({ scheme, start: r }), 'scheme') });
    }
    return inOrder(placed).map((p) => p.l);
  }

  /**
   * A verse unit's words: its original words in WLC and SBLGNT, its verse
   * text's words elsewhere (`verseWords`, the same as its word tokens). With
   * `only`, just the written word at that index.
   */
  function unitWords(e: EditionStamp, u: Verse, only?: number): Word[] {
    const at = (wordIndex: number) =>
      formatAddress({ scheme: e.scheme, start: { book: u.book, chapter: u.chapter, verse: u.verse, segment: u.segment, wordIndex } });
    const original = read.originalWords(e.id, u.book, u.chapter, u.verse, u.segment);
    if (original.length > 0) {
      return original.filter((w) => only === undefined || w.wordIndex === only).map((w) => ({
        address: w.wordIndex === null ? null : at(w.wordIndex),
        text: w.text,
        kind: w.kind,
        strongs: w.strongs,
        original: { owId: w.owId, lemma: w.lemma, morph: w.morph, gloss: w.gloss },
        originals: [],
      }));
    }
    // a translation's words are its verse text's words (ADR-0004, step 13 amendment)
    const tokens = verseWords(u.text).map((text, wordIndex) => ({ wordIndex, text }));
    const aligned = new Map<number, AlignedOriginal[]>();
    for (const r of read.wordAlignments(e.id, u.book, u.chapter, u.verse, u.segment)) {
      (aligned.get(r.wordIndex) ?? aligned.set(r.wordIndex, []).get(r.wordIndex)!).push(r);
    }
    return tokens.filter((t) => only === undefined || t.wordIndex === only).map((t) => {
      const rows = aligned.get(t.wordIndex) ?? [];
      return {
        address: at(t.wordIndex),
        text: t.text,
        kind: 'word',
        strongs: [...new Set(rows.flatMap((r) => r.strongs))],
        original: null,
        originals: rows.map((r) => ({
          edition: r.edition,
          address:
            r.owWordIndex === null
              ? null
              : formatAddress({
                  scheme: r.scheme,
                  start: { book: r.book, chapter: r.chapter, verse: r.verse, segment: r.segment, wordIndex: r.owWordIndex },
                }),
          owId: r.owId,
        })),
      };
    });
  }

  function schemeById(id: string, call: string): Scheme {
    const s = schemes.get(id);
    if (!s) throw new Error(`${call}: unknown scheme "${id}"`);
    // the pivot only joins mappings: no address is written in it (ADR-0006)
    if (id === PIVOT) throw new Error(`${call}: "${id}" is the pivot, not a scheme an address is written in`);
    return s;
  }

  return {
    async editions(): Promise<EditionInfo[]> {
      return read.editions().map((row) => ({ ...stampOf(row), name: row.name, language: row.language }));
    },

    async books(id): Promise<BookInfo[]> {
      const held = read.books(edition(id).id);
      return (bookList ??= read.bookList()).flatMap((b) => {
        const chapters = held.get(b.book);
        return chapters === undefined ? [] : [{ ...b, chapters }];
      });
    },

    async chapter(id, book, chapter): Promise<ChapterResult> {
      const e = edition(id);
      if (!Number.isInteger(chapter) || chapter < 1) throw new Error(`chapter: ${chapter} is not a chapter number`);
      if (lastVerse(schemeOf(e), book, chapter) === undefined) {
        return { kind: 'absent', edition: e, book, chapter, reason: 'scheme' };
      }
      // both reads start before either is awaited, so a reader that holds nothing fetches the chapter once
      let [units, doc] = await Promise.all([read.chapter(e.id, book, chapter), read.chapterDoc(e.id, book, chapter)]);
      // the reader may have replaced the chapter between the two reads: take the units of the document's copy
      if (units && doc && units.stamp !== doc.stamp) units = await read.chapter(e.id, book, chapter);
      if (!units || !doc) return { kind: 'absent', edition: e, book, chapter, reason: 'text' };
      if (units.stamp !== doc.stamp) throw new Error(`chapter: ${e.id} ${book} ${chapter} changed while it was read`);
      const { stamp, verses } = units;
      return {
        kind: 'chapter',
        edition: e,
        book,
        chapter,
        stamp,
        content: doc.content,
        front: chapter === 1 ? ((await read.chapterDoc(e.id, book, 0))?.content ?? null) : null,
        verses: verses.map((u) => toVerse(e, book, u, stamp)),
      };
    },

    async passage(id, reference, options = {}): Promise<PassageResult> {
      const e = edition(id);
      const scheme = options.scheme ?? e.scheme;
      const s = schemeById(scheme, 'passage');
      const parts = await Promise.all(
        parseReference(reference).map(async (range): Promise<PassagePart> => {
          const { address, steps } = walk(s, range);
          return { address, found: await (scheme === e.scheme ? ownSteps(e, steps) : otherSteps(e, scheme, steps)) };
        }),
      );
      return { edition: e, reference, parts };
    },

    async verseText(id, address): Promise<VerseTextResult> {
      const e = edition(id);
      const r = verseRef(e, address, 'verseText');
      return { edition: e, asked: point(e, r), found: lookup(e, r, await load(e, [r])) };
    },

    async map(fromId, address, toId): Promise<MapResult> {
      const from = edition(fromId);
      const to = edition(toId);
      const a = ownAddress(from, address, 'map');
      const { wordIndex, ...r } = a.start;
      if (wordIndex !== undefined) throw new Error(`map: "${address}" is not one verse`);
      const refs: Ref[] = [r];
      if (a.end) {
        // a range is allowed only as a bridge's own address, `JHN 1:5-6/kjv`: every number in it maps
        const unit = lookup(from, r, await load(from, [r]));
        if (unit.kind !== 'bridge' || formatAddress(a) !== unit.address) throw new Error(`map: "${address}" is not one verse`);
        for (let v = unit.verse + 1; v <= unit.lastVerse; v++) refs.push({ ...r, verse: v });
      }
      const asked = a.end ? formatAddress(a) : point(from, r);
      mappings ??= read.mappings(schemes);
      const targets: Ref[] = [];
      for (const ref of refs) {
        if (!refExists(schemeOf(from), ref)) throw new Error(`map: ${from.scheme} has no ${point(from, ref)}`);
        targets.push(...mappings.map(from.scheme, to.scheme, ref));
      }
      const placed: Placed[] = [];
      place(to, targets, placed, await load(to, targets));
      const ordered = inOrder(placed).map((p) => p.l);
      const verses = ordered.filter((l): l is Verse => l.kind !== 'absent');
      const missing = ordered.filter((l): l is Absent => l.kind === 'absent');
      const kind: MapKind =
        verses.length === 0 ? 'absent' : verses.length > 1 ? 'several' : verses[0].part ? 'part' : 'one';
      return { from, to, asked, kind, verses, missing };
    },

    async resolve(id, address): Promise<ResolveResult> {
      const e = edition(id);
      const a = parseAddress(address);
      if (a.start.wordIndex !== undefined || a.end?.wordIndex !== undefined) {
        throw new Error(`resolve: "${address}" is a word address`);
      }
      const s = schemeById(a.scheme, 'resolve');
      const r: Ref = { book: a.start.book, chapter: a.start.chapter, verse: a.start.verse, segment: a.start.segment };
      let found: Lookup[];
      if (a.end) {
        // a bridge or a range: whole verses, as passage reads them
        const end = { chapter: a.end.chapter, verse: a.end.verse };
        const { steps } = walk(s, { book: r.book, start: { chapter: r.chapter, verse: r.verse }, end });
        found = await (a.scheme === e.scheme ? ownSteps(e, steps) : otherSteps(e, a.scheme, steps));
      } else if (a.scheme === e.scheme) {
        const l = lookup(e, r, await load(e, [r]));
        found = l.kind === 'parts' ? [...l.parts] : [l];
      } else {
        found = await otherSteps(e, a.scheme, [{ r, exists: refExists(s, r) }]);
      }
      return { edition: e, asked: address, found };
    },

    async words(id, address): Promise<WordsResult> {
      const e = edition(id);
      const a = parseAddress(address.includes('/') ? address : `${address}/${e.scheme}`);
      if (a.scheme !== e.scheme) {
        throw new Error(`words: "${address}" names scheme ${a.scheme}, but ${e.id} uses ${e.scheme}. Map it first`);
      }
      const { wordIndex, ...r } = a.start;
      const found = lookup(e, r, await load(e, [r]));
      // a range is allowed only as a bridge's own address, `JHN 1:5-6/kjv`
      if (a.end && (found.kind !== 'bridge' || formatAddress(a) !== found.address)) {
        throw new Error(`words: "${address}" is a range`);
      }
      // a word number counts within one part (ADR-0004), so a verse printed in parts needs its letter
      if (wordIndex !== undefined && found.kind === 'parts') {
        throw new Error(`words: ${found.address} is printed in parts; add the part's letter (${found.parts[0].address.replace(/\/.*/, '')}!${wordIndex + 1})`);
      }
      const units = found.kind === 'absent' ? [] : found.kind === 'parts' ? found.parts : [found];
      // a word number counts within the unit, a bridge's too (ADR-0004 v1.5)
      const words = units.flatMap((u) => unitWords(e, u, wordIndex));
      return { edition: e, asked: formatAddress({ scheme: e.scheme, start: a.start }), found, words };
    },

    async rights(id): Promise<RightsRecord> {
      const r = RIGHTS.get(id);
      if (!r) throw new Error(`rights: no rights record for edition "${id}"`);
      // only for an edition this contract reads: a record alone doesn't make its chapters readable
      edition(id);
      return r;
    },

    async credits() {
      return read.dataSources();
    },
  };
}

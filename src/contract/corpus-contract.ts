/**
 * The app contract (contract.ts) over the corpus DB, `build/corpus.db` today.
 * It reads through corpus-read.ts, so it runs on either sync drizzle driver.
 * Nothing from the DB leaves here but addresses, text, documents and stamps.
 */

import {
  loadMappings,
  readChapterDoc,
  readEdition,
  readSchemes,
  readVerseText,
  readVerseUnit,
  type SyncSqliteDb,
} from '../db/corpus-read';
import { formatAddress, parseAddress, type Address, type VerseRef } from '../model/address';
import type { VerseText } from '../model/corpus';
import { refExists, type Mappings, type Ref } from '../model/mapping';
import { lastVerse, type Scheme } from '../model/scheme';
import type {
  Absent,
  AbsentReason,
  BibleContract,
  ChapterResult,
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
} from './contract';
import { parseReference, type BookRange } from './reference';
import { RIGHTS, type RightsRecord } from './rights';

export function corpusContract(db: SyncSqliteDb): BibleContract {
  const schemes = readSchemes(db);
  const editions = new Map<string, EditionStamp>();
  let mappings: Mappings | undefined;

  function edition(id: string): EditionStamp {
    const cached = editions.get(id);
    if (cached) return cached;
    const row = readEdition(db, id);
    if (!row) throw new Error(`unknown edition "${id}"`);
    const e: EditionStamp = { id: row.abbrev, scheme: row.scheme, stamp: row.edition, wordsStamp: row.wordsStamp };
    editions.set(id, e);
    return e;
  }

  const schemeOf = (e: EditionStamp): Scheme => schemes.get(e.scheme)!;

  /** `JHN 3:16` or `JHN 3:16/kjv` → one verse ref under the edition's scheme. */
  function verseRef(e: EditionStamp, text: string, call: string): VerseRef {
    const a = parseAddress(text.includes('/') ? text : `${text}/${e.scheme}`);
    if (a.scheme !== e.scheme) {
      throw new Error(`${call}: "${text}" names scheme ${a.scheme}, but ${e.id} uses ${e.scheme}. Use resolve for an address under another scheme`);
    }
    if (a.end || a.start.wordIndex !== undefined) throw new Error(`${call}: "${text}" is not one verse`);
    return a.start;
  }

  const point = (e: EditionStamp, r: Ref): string =>
    formatAddress({ scheme: e.scheme, start: { book: r.book, chapter: r.chapter, verse: r.verse, segment: r.segment } });

  const absent = (address: string, reason: AbsentReason): Absent => ({ kind: 'absent', address, reason });

  function toVerse(e: EditionStamp, book: string, u: VerseText, part?: string): Verse {
    const start = { book, chapter: u.chapter, verse: u.verse, segment: u.segment };
    const bridge = u.lastVerse > u.verse;
    const address = formatAddress({
      scheme: e.scheme,
      start,
      end: bridge ? { ...start, verse: u.lastVerse, segment: '' } : undefined,
    });
    const v: Verse = { kind: bridge ? 'bridge' : 'verse', address, ...start, lastVerse: u.lastVerse, text: u.text };
    return part ? { ...v, part } : v;
  }

  /** One address in one edition: the verse, the bridge that holds it, its parts, or absent. */
  function lookup(e: EditionStamp, r: Ref): Lookup | Parts {
    if (!refExists(schemeOf(e), r)) return absent(point(e, r), 'scheme');
    const unit = readVerseUnit(db, e.id, r.book, r.chapter, r.verse, r.segment);
    if (unit) return toVerse(e, r.book, unit);
    if (r.segment !== '') {
      // the edition doesn't mark the part: the whole unit, flagged
      const whole = readVerseUnit(db, e.id, r.book, r.chapter, r.verse);
      if (whole) return toVerse(e, r.book, whole, r.segment);
    } else {
      // the edition prints the verse only in parts
      const parts = readVerseText(db, e.id, r.book, r.chapter).filter((u) => u.verse <= r.verse && u.lastVerse >= r.verse);
      if (parts.length > 0) return { kind: 'parts', address: point(e, r), parts: parts.map((u) => toVerse(e, r.book, u)) };
    }
    return absent(point(e, r), 'text');
  }

  /** Every unit that holds each verse number of one chapter, in print order: a bridge under each of its numbers, a whole verse before its parts. */
  function unitsByVerse(e: EditionStamp, book: string, chapter: number): Map<number, VerseText[]> {
    const byVerse = new Map<number, VerseText[]>();
    for (const u of readVerseText(db, e.id, book, chapter)) {
      for (let v = u.verse; v <= u.lastVerse; v++) {
        const list = byVerse.get(v);
        if (list) list.push(u);
        else byVerse.set(v, [u]);
      }
    }
    return byVerse;
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
  function ownSteps(e: EditionStamp, steps: readonly Step[]): Lookup[] {
    const chapters = new Map<number, Map<number, VerseText[]>>();
    const found: Lookup[] = [];
    const seen = new Set<string>();
    for (const { r, exists } of steps) {
      if (!exists) {
        found.push(absent(point(e, r), 'scheme'));
        continue;
      }
      let units = chapters.get(r.chapter);
      if (!units) chapters.set(r.chapter, (units = unitsByVerse(e, r.book, r.chapter)));
      const held = units.get(r.verse);
      if (!held) {
        found.push(absent(point(e, r), 'text'));
        continue;
      }
      for (const u of held) {
        const l = toVerse(e, r.book, u);
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

  /** Add the edition's units for target refs under its scheme, merging the parts of one unit. */
  function place(e: EditionStamp, targets: readonly Ref[], out: Placed[]) {
    for (const t of targets) {
      const l = lookup(e, t);
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
  function otherSteps(e: EditionStamp, scheme: string, steps: readonly Step[]): Lookup[] {
    mappings ??= loadMappings(db, schemes);
    const placed: Placed[] = [];
    for (const { r, exists } of steps) {
      const targets = exists ? mappings.map(scheme, e.scheme, r) : [];
      if (targets.length > 0) place(e, targets, placed);
      else placed.push({ at: null, l: absent(formatAddress({ scheme, start: r }), 'scheme') });
    }
    return inOrder(placed).map((p) => p.l);
  }

  function schemeById(id: string, call: string): Scheme {
    const s = schemes.get(id);
    if (!s) throw new Error(`${call}: unknown scheme "${id}"`);
    return s;
  }

  return {
    async chapter(id, book, chapter): Promise<ChapterResult> {
      const e = edition(id);
      if (!Number.isInteger(chapter) || chapter < 1) throw new Error(`chapter: ${chapter} is not a chapter number`);
      if (lastVerse(schemeOf(e), book, chapter) === undefined) {
        return { kind: 'absent', edition: e, book, chapter, reason: 'scheme' };
      }
      const doc = readChapterDoc(db, e.id, book, chapter);
      if (!doc) return { kind: 'absent', edition: e, book, chapter, reason: 'text' };
      return {
        kind: 'chapter',
        edition: e,
        book,
        chapter,
        content: doc.content,
        front: chapter === 1 ? (readChapterDoc(db, e.id, book, 0)?.content ?? null) : null,
        verses: readVerseText(db, e.id, book, chapter).map((u) => toVerse(e, book, u)),
      };
    },

    async passage(id, reference, options = {}): Promise<PassageResult> {
      const e = edition(id);
      const scheme = options.scheme ?? e.scheme;
      const s = schemeById(scheme, 'passage');
      const parts = parseReference(reference).map((range): PassagePart => {
        const { address, steps } = walk(s, range);
        return { address, found: scheme === e.scheme ? ownSteps(e, steps) : otherSteps(e, scheme, steps) };
      });
      return { edition: e, reference, parts };
    },

    async verseText(id, address): Promise<VerseTextResult> {
      const e = edition(id);
      const r = verseRef(e, address, 'verseText');
      return { edition: e, asked: point(e, r), found: lookup(e, r) };
    },

    async map(fromId, address, toId): Promise<MapResult> {
      const from = edition(fromId);
      const to = edition(toId);
      const r = verseRef(from, address, 'map');
      const asked = point(from, r);
      if (!refExists(schemeOf(from), r)) throw new Error(`map: ${from.scheme} has no ${asked}`);
      mappings ??= loadMappings(db, schemes);
      const placed: Placed[] = [];
      place(to, mappings.map(from.scheme, to.scheme, r), placed);
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
        found = a.scheme === e.scheme ? ownSteps(e, steps) : otherSteps(e, a.scheme, steps);
      } else if (a.scheme === e.scheme) {
        const l = lookup(e, r);
        found = l.kind === 'parts' ? [...l.parts] : [l];
      } else {
        found = otherSteps(e, a.scheme, [{ r, exists: refExists(s, r) }]);
      }
      return { edition: e, asked: address, found };
    },

    async rights(id): Promise<RightsRecord> {
      const r = RIGHTS.get(id);
      if (!r) throw new Error(`rights: no rights record for edition "${id}"`);
      return r;
    },
  };
}

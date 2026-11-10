/**
 * The app contract (contract.ts) over the corpus DB, `build/corpus.db` today.
 * It reads through corpus-read.ts, so it runs on either sync drizzle driver.
 * Nothing from the DB leaves here but addresses, text, documents and stamps.
 */

import {
  readChapterDoc,
  readEdition,
  readMappings,
  readSchemes,
  readVerseText,
  readVerseUnit,
  type SyncSqliteDb,
} from '../db/corpus-read';
import { formatAddress, parseAddress, type Address, type VerseRef } from '../model/address';
import type { VerseText } from '../model/corpus';
import { Mappings, refExists, type Ref } from '../model/mapping';
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
  PassagePart,
  PassageResult,
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
      throw new Error(`${call}: "${text}" names scheme ${a.scheme}, but ${e.id} uses ${e.scheme}. Use map to move between schemes`);
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

  /** One address in one edition: the verse, the bridge that holds it, or absent. */
  function lookup(e: EditionStamp, r: Ref): Lookup {
    if (!refExists(schemeOf(e), r)) return absent(point(e, r), 'scheme');
    const unit = readVerseUnit(db, e.id, r.book, r.chapter, r.verse, r.segment);
    if (unit) return toVerse(e, r.book, unit);
    if (r.segment !== '') {
      // the edition doesn't mark the part: the whole unit, flagged
      const whole = readVerseUnit(db, e.id, r.book, r.chapter, r.verse);
      if (whole) return toVerse(e, r.book, whole, r.segment);
    }
    return absent(point(e, r), 'text');
  }

  /** Walk a range verse by verse under the edition's scheme. A bridge appears once. */
  function resolveRange(e: EditionStamp, range: BookRange): PassagePart {
    const s = schemeOf(e);
    const { book } = range;
    const chapters = s.verseCounts.get(book)?.length ?? range.start.chapter;
    const endChapter = Math.min(range.end.chapter, Math.max(chapters, range.start.chapter));
    const found: Lookup[] = [];
    const seen = new Set<string>();
    let first: VerseRef | undefined;
    let last: VerseRef | undefined;
    for (let c = range.start.chapter; c <= endChapter; c++) {
      const from =
        c === range.start.chapter && range.start.verse !== null ? range.start.verse : s.titles.has(`${book} ${c}`) ? 0 : 1;
      const lv = lastVerse(s, book, c);
      const to = lv === undefined ? from - 1 : c === endChapter && range.end.verse !== null ? Math.min(range.end.verse, lv) : lv;
      first ??= { book, chapter: c, verse: from, segment: '' };
      if (to < from) {
        // the scheme lacks the chapter, or the range starts past its end
        found.push(absent(point(e, { book, chapter: c, verse: from, segment: '' }), 'scheme'));
        last = { book, chapter: c, verse: from, segment: '' };
        continue;
      }
      for (let v = from; v <= to; v++) {
        const l = lookup(e, { book, chapter: c, verse: v, segment: '' });
        if (l.kind !== 'absent') {
          if (seen.has(l.address)) continue;
          seen.add(l.address);
        }
        found.push(l);
      }
      last = { book, chapter: c, verse: to, segment: '' };
    }
    const a: Address =
      first!.chapter === last!.chapter && first!.verse === last!.verse
        ? { scheme: e.scheme, start: first! }
        : { scheme: e.scheme, start: first!, end: last };
    return { address: formatAddress(a), found };
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

    async passage(id, reference): Promise<PassageResult> {
      const e = edition(id);
      return { edition: e, reference, parts: parseReference(reference).map((r) => resolveRange(e, r)) };
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
      mappings ??= new Mappings(readMappings(db), schemes);
      const verses: Verse[] = [];
      const missing: Absent[] = [];
      for (const t of mappings.map(from.scheme, to.scheme, r)) {
        const l = lookup(to, t);
        if (l.kind === 'absent') {
          missing.push(l);
          continue;
        }
        const i = verses.findIndex((v) => v.address === l.address);
        if (i < 0) verses.push(l);
        else if (verses[i].part !== l.part) {
          // two parts of one unit, or a part and the whole: the whole unit matches
          const { part: _, ...whole } = verses[i];
          verses[i] = whole;
        }
      }
      const kind: MapKind =
        verses.length === 0 ? 'absent' : verses.length > 1 ? 'several' : verses[0].part ? 'part' : 'one';
      return { from, to, asked, kind, verses, missing };
    },

    async rights(id): Promise<RightsRecord> {
      const r = RIGHTS.get(id);
      if (!r) throw new Error(`rights: no rights record for edition "${id}"`);
      return r;
    },
  };
}

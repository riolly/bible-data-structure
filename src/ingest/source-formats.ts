/**
 * The formats a pinned source comes in, one adapter each. An adapter finds a
 * source's book files, converts them to USFM, and gives what else the edition
 * gets from its format: readings (ADR-0007), original words (ADR-0003 and its
 * step 11 amendment), and the ids an alignment points at. run.ts calls every
 * format the same way.
 *
 *   usfm        the source's own `.usfm` files, and nothing else
 *   sblgnt-xml  upstream SBLGNT's per-book XML (sblgnt-xml.ts), its words
 *               joined to MACULA Greek's
 *   oshb-xml    upstream OSHB's per-book OSIS (oshb-xml.ts), with its qere
 *               readings and OSHB's own words, glossed by MACULA Hebrew
 */

import { join } from 'node:path';

import type { SourceFile } from './edition';
import type { BookRows, EditionWriter } from './edition-writer';
import { GREEK_EXCEPTIONS, checkExceptionsUsed, greekWords, hebrewWords, readMacula, type HubPart } from './original-words';
import { OSHB_BOOKS, oshbXmlToUsfm, type OshbReading, type OshbVerse } from './oshb-xml';
import { SBLGNT_BOOKS, sblgntXmlToUsfm } from './sblgnt-xml';
import { MACULA_GREEK, MACULA_HEBREW, type PinnedFile, type SourceDef } from './sources';

/** Every id an alignment can point at (a MACULA morpheme or Greek word), to the original word it is part of. */
export type HubIndex = Map<string, HubPart>;

/** The path of a pinned data file (MACULA), once it is checked against its pin (`pinnedPath`). */
export type OpenPinned = (pin: PinnedFile) => string;

export interface SourceFormat {
  /** The directory under the sources root that holds the source's book files. */
  dir(src: SourceDef): string;
  /** Whether a file in that directory may hold a book. Only these are read. */
  isBookFile(name: string): boolean;
  /** The book a file holds, or undefined when it holds none. */
  bookOf(name: string, text: string): string | undefined;
  /** The upstream books as USFM, in the same order, and the by-products of the conversion. */
  convert(raw: readonly SourceFile[], openPinned: OpenPinned): ConvertedSource;
}

export interface ConvertedSource {
  readonly files: SourceFile[];
  /**
   * Start the edition's turn: read the data files its by-products join to.
   * The ids an alignment points at go into `hub` as each book is added.
   */
  open(hub: HubIndex): EditionExtras;
}

export interface EditionExtras {
  /** Write one checked book through the edition's writer, with its by-products. */
  addBook(writer: EditionWriter, book: string, rows: BookRows): void;
  /** Run the checks that need every book, and return the edition's summary lines. Call it before the edition commits. */
  finish(): string[];
}

const USFM: SourceFormat = {
  dir: (src) => src.dir,
  isBookFile: (name) => name.toLowerCase().endsWith('.usfm'),
  bookOf: (_name, text) => text.match(/^\\id (\w{3})/)?.[1],
  convert: (raw) => ({
    files: [...raw],
    open: () => ({ addBook: (writer, book, rows) => writer.addBook(book, rows), finish: () => [] }),
  }),
};

const xmlDir = (src: SourceDef) => {
  if (!src.format) throw new Error(`${src.meta.abbrev}: an XML source needs format.path`);
  return join(src.dir, src.format.path);
};

const SBLGNT_XML: SourceFormat = {
  dir: xmlDir,
  isBookFile: (name) => name.endsWith('.xml'),
  bookOf: (name) => SBLGNT_BOOKS[name.slice(0, -4)],
  convert: (raw, openPinned) => ({
    files: raw.map((f) => ({ code: f.code, usfm: sblgntXmlToUsfm(f.usfm, f.code) })),
    open(hub) {
      const macula = readMacula(openPinned(MACULA_GREEK));
      const used = new Set<string>();
      const totals = { words: 0, noGloss: 0 };
      return {
        addBook(writer, book, rows) {
          writer.addBook(book, rows);
          const { words, stats } = greekWords(book, rows.tokens, macula, GREEK_EXCEPTIONS, used);
          for (const w of words) hub.set(w.owId, { source: 'macula-greek', owId: w.owId, strongs: w.strongs });
          writer.addOriginalWords(book, MACULA_GREEK.id, words);
          totals.words += words.length;
          totals.noGloss += stats.noGloss;
        },
        finish() {
          checkExceptionsUsed(GREEK_EXCEPTIONS, used);
          return [originalWordsLine(totals, MACULA_GREEK)];
        },
      };
    },
  }),
};

const OSHB_XML: SourceFormat = {
  dir: xmlDir,
  isBookFile: (name) => name.endsWith('.xml'),
  bookOf: (name) => OSHB_BOOKS[name.slice(0, -4)],
  convert(raw, openPinned) {
    const readings: OshbReading[] = [];
    const verses: OshbVerse[] = [];
    const files = raw.map((f) => {
      const converted = oshbXmlToUsfm(f.usfm, f.code);
      readings.push(...converted.readings);
      verses.push(...converted.verses);
      return { code: f.code, usfm: converted.usfm };
    });
    return {
      files,
      open(hub) {
        const macula = readMacula(openPinned(MACULA_HEBREW));
        const totals = { words: 0, noGloss: 0 };
        return {
          addBook(writer, book, rows) {
            // the writer checks the readings against the tokens before it stores them
            const bookReadings = readings.filter((r) => r.book === book);
            writer.addBook(book, rows, bookReadings);
            const bookVerses = verses.filter((v) => v.book === book);
            const { words, stats, morphemes } = hebrewWords(book, rows.tokens, bookVerses, bookReadings, macula);
            for (const [id, part] of morphemes) hub.set(id, part);
            writer.addOriginalWords(book, 'oshb', words);
            totals.words += words.length;
            totals.noGloss += stats.noGloss;
          },
          finish: () => [
            ...(readings.length > 0 ? [`${readings.length} qere readings (ADR-0007)`] : []),
            originalWordsLine(totals, MACULA_HEBREW),
          ],
        };
      },
    };
  },
};

const FORMATS = { usfm: USFM, 'sblgnt-xml': SBLGNT_XML, 'oshb-xml': OSHB_XML } as const;

/** The adapter for a source's format. */
export const formatOf = (src: SourceDef): SourceFormat => FORMATS[src.format?.kind ?? 'usfm'];

const originalWordsLine = (totals: { words: number; noGloss: number }, glosses: PinnedFile) =>
  `${totals.words} original words, glosses from ${glosses.id}: ${totals.noGloss} read words have none`;

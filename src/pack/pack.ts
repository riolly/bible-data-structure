/**
 * A pack (plan step 13): the file an app ships, built from `build/corpus.db`,
 * which never ships. `buildPack` writes it, `openPack` reads it through the
 * app contract, and `checkPack` stops unless a pack reads the same as the
 * corpus DB. format.ts holds what differs from the corpus DB on disk and the
 * reader that undoes it. A pack is a SQLite file with the corpus tables, and
 * it differs from the corpus DB in these ways:
 *
 * - It holds only the editions it names, plus the hub editions WLC and
 *   SBLGNT: every edition maps a verse to its Hebrew or Greek words (ADR-0008),
 *   and a BSB word's `originals` are addresses in them. An app ships one pack
 *   with all its editions, so the hub is in it once. Books, canons and data
 *   sources with their credits come whole.
 * - It holds only the schemes of ADR-0008's target editions and of its own
 *   editions, with their mappings. `resolve` throws on an address under
 *   another scheme (`lxx`, `vul`).
 * - It drops the `token` and `block` tables (`DROPPED`). A unit's words are
 *   its verse text's words (`verseWords`), which the ingest checks against
 *   the tokens.
 * - Each chapter document is deflated: `usj`, declared TEXT, holds a BLOB,
 *   which `packReader` (format.ts) inflates.
 *
 * Row ids are the corpus DB's: a pack is read alone, never merged with another.
 */

import { existsSync, rmSync } from 'node:fs';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { BibleContract } from '../contract/contract';
import { readerContract } from '../contract/corpus-contract';
import { LICENSED_EDITIONS } from '../contract/rights';
import * as schema from '../db/corpus-schema';
import { PIVOT } from '../model/mapping';
import { createCorpusDb, createIndexes } from '../ingest/write-db';
import { DROPPED, deflateDoc, packReader } from './format';

/** The hub texts (ADR-0003), in every pack. */
export const HUBS = ['WLC', 'SBLGNT'] as const;

/**
 * The schemes every pack holds besides its editions' own: the pivot, and the
 * schemes of ADR-0008's target editions that an app fetches from API.Bible,
 * so it can map them to the pack's editions.
 */
const SCHEMES = [PIVOT, 'kjv', ...[...LICENSED_EDITIONS.values()].map((e) => e.scheme)];

/** Tables every pack copies whole. */
const SHARED = ['data_source', 'book', 'canon', 'canon_section', 'canon_entry', 'canon_entry_book', 'book_name'] as const;

/** Tables a pack copies for its schemes only, by their `scheme` column (`id` in `scheme`). */
const PER_SCHEME = ['scheme_verse_count', 'scheme_excluded_verse', 'scheme_segment', 'scheme_title', 'scheme_mapping'] as const;

/** Tables a pack copies for its editions only, after `translation`. `chapter_doc` is deflated on the way. */
const PER_EDITION = ['verse_text', 'reading', 'original_word', 'word_alignment'] as const;

export interface PackOptions {
  /** Only these books (USFM codes) of each edition: a small pack for tests and app work. Default: every book. */
  readonly books?: readonly string[];
}

/**
 * Build a pack of `editions` (abbreviations) from the corpus DB at
 * `corpusPath`, at `outPath`. Returns every edition the pack holds, the hubs
 * last.
 */
export function buildPack(
  corpusPath: string,
  outPath: string,
  editions: readonly string[],
  { books }: PackOptions = {},
): string[] {
  if (books?.some((b) => !/^[0-9A-Z]{3}$/.test(b))) throw new Error(`pack: ${books.join(', ')} are not all USFM book codes`);
  if (!existsSync(corpusPath)) throw new Error(`${corpusPath}: no corpus DB, run \`bun run ingest\` first`);
  rmSync(outPath, { force: true });
  const { sqlite } = createCorpusDb(outPath, { deferIndexes: true });
  try {
    sqlite.prepare('ATTACH DATABASE ? AS src').run(corpusPath);
    const ids = new Map<string, number>();
    const schemes = new Set<string>(SCHEMES);
    const idOf = sqlite.prepare<[string], { id: number; scheme: string }>('SELECT id, scheme FROM src.translation WHERE abbrev = ?');
    for (const e of [...editions, ...HUBS]) {
      const row = idOf.get(e);
      if (!row) throw new Error(`pack: the corpus has no edition "${e}"`);
      ids.set(e, row.id);
      schemes.add(row.scheme);
    }
    const ofBooks = books ? ` AND book IN (${books.map((b) => `'${b}'`).join(', ')})` : '';
    // the editions the alignment rows point at: the hubs, checked
    const hubs = sqlite
      .prepare<number[], { abbrev: string; id: number }>(
        `SELECT DISTINCT t.abbrev, t.id FROM src.word_alignment a
         JOIN src.original_word o ON o.source = a.source AND o.ow_id = a.ow_id
         JOIN src.translation t ON t.id = o.translation_id
         WHERE a.translation_id IN (${[...ids.values()].map(() => '?').join(', ')})${ofBooks.replace('book', 'a.book')}
         ORDER BY t.abbrev`,
      )
      .all(...ids.values());
    const outside = hubs.filter((h) => !ids.has(h.abbrev));
    if (outside.length > 0) throw new Error(`pack: alignments point at ${outside.map((h) => h.abbrev).join(', ')}, which the pack lacks`);
    const inList = `(${[...ids.values()].join(', ')})`;

    sqlite.exec('BEGIN');
    for (const t of SHARED) sqlite.exec(`INSERT INTO main.${t} SELECT * FROM src.${t}`);
    const schemeList = `(${[...schemes].map((id) => `'${id}'`).join(', ')})`;
    sqlite.exec(`INSERT INTO main.scheme SELECT * FROM src.scheme WHERE id IN ${schemeList}`);
    for (const t of PER_SCHEME) sqlite.exec(`INSERT INTO main.${t} SELECT * FROM src.${t} WHERE scheme IN ${schemeList}`);
    sqlite.exec(`INSERT INTO main.translation SELECT * FROM src.translation WHERE id IN ${inList}`);
    const doc = sqlite.prepare('INSERT INTO main.chapter_doc (translation_id, book, chapter, usj, stamp) VALUES (?, ?, ?, ?, ?)');
    const docs = sqlite.prepare<[], { translation_id: number; book: string; chapter: number; usj: string; stamp: string }>(
      `SELECT translation_id, book, chapter, usj, stamp FROM src.chapter_doc WHERE translation_id IN ${inList}${ofBooks}`,
    );
    for (const d of docs.all()) {
      doc.run(d.translation_id, d.book, d.chapter, Buffer.from(deflateDoc(d.usj)), d.stamp);
    }
    for (const t of PER_EDITION) sqlite.exec(`INSERT INTO main.${t} SELECT * FROM src.${t} WHERE translation_id IN ${inList}${ofBooks}`);
    sqlite.exec('COMMIT');
    sqlite.exec('DETACH DATABASE src');

    createIndexes(sqlite);
    sqlite.exec(DROPPED.map((t) => `DROP TABLE ${t}`).join('; '));
    const broken = sqlite.pragma('foreign_key_check') as unknown[];
    if (broken.length > 0) throw new Error(`pack: ${broken.length} rows point at rows the pack lacks`);
    sqlite.exec('ANALYZE; VACUUM');
    return [...ids.keys()];
  } finally {
    sqlite.close();
  }
}

/** A pack opened read-only: the app contract over it, and its SQLite handle for measuring the file. */
export interface OpenPack {
  readonly sqlite: Database.Database;
  readonly contract: BibleContract;
}

/** Open the pack at `path` read-only. Close it with `sqlite.close()`. */
export function openPack(path: string): OpenPack {
  const sqlite = new Database(path, { readonly: true });
  return { sqlite, contract: readerContract(packReader(drizzle({ client: sqlite, schema }))) };
}

/** What `checkPack` read: the chapters and words it compared, and the time each pack chapter read took, in read order. */
export interface PackCheck {
  readonly chapters: number;
  readonly words: number;
  readonly ms: readonly number[];
}

/**
 * Check that `pack` reads the same as the corpus DB for each of `editions`:
 * every chapter the corpus DB holds of them, in `books` when given, and every
 * verse's words and map to each hub in each book's first chapter. The
 * chapter list comes from the corpus DB, so a chapter the pack lacks fails
 * (#66). Throws at the first difference. Every verse's words take about 3 ms
 * a call on each side, so the words check stops at a book's first chapter.
 */
export async function checkPack(
  pack: OpenPack,
  corpus: { readonly sqlite: Database.Database; readonly contract: BibleContract },
  editions: readonly string[],
  { books }: PackOptions = {},
): Promise<PackCheck> {
  const ofBooks = books ? ` AND d.book IN (${books.map(() => '?').join(', ')})` : '';
  const listChapters = corpus.sqlite.prepare<string[], { book: string; chapter: number }>(
    `SELECT d.book, d.chapter FROM chapter_doc d JOIN translation t ON t.id = d.translation_id
     JOIN book b ON b.code = d.book WHERE t.abbrev = ? AND d.chapter > 0${ofBooks} ORDER BY b.usfm_number, d.chapter`,
  );
  const ms: number[] = [];
  let chapters = 0;
  let words = 0;
  for (const edition of editions) {
    const list = listChapters.all(edition, ...(books ?? []));
    if (list.length === 0) throw new Error(`${edition}: the corpus DB has no chapter to check`);
    chapters += list.length;
    let lastBook = '';
    for (const { book, chapter } of list) {
      const t = performance.now();
      const got = await pack.contract.chapter(edition, book, chapter);
      ms.push(performance.now() - t);
      if (JSON.stringify(got) !== JSON.stringify(await corpus.contract.chapter(edition, book, chapter))) {
        throw new Error(`${edition} ${book} ${chapter}: the pack's chapter differs from the corpus DB's`);
      }
      if (got.kind !== 'chapter' || book === lastBook) continue;
      lastBook = book;
      for (const v of got.verses) {
        const [a, b] = await Promise.all([pack.contract.words(edition, v.address), corpus.contract.words(edition, v.address)]);
        if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${v.address}: the pack's words differ from the corpus DB's`);
        words += a.words.length;
        if (v.kind === 'bridge' || (HUBS as readonly string[]).includes(edition)) continue;
        for (const hub of HUBS) {
          const [m, n] = await Promise.all([pack.contract.map(edition, v.address, hub), corpus.contract.map(edition, v.address, hub)]);
          if (JSON.stringify(m) !== JSON.stringify(n)) throw new Error(`${v.address}: the pack maps it to ${hub} differently from the corpus DB`);
        }
      }
    }
  }
  return { chapters, words, ms };
}

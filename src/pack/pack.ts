/**
 * A pack (plan step 13): the file an app ships, built from `build/corpus.db`,
 * which never ships. It is a SQLite file with the corpus tables, so
 * `corpusContract` reads it unchanged, and it differs from the corpus DB in
 * three ways:
 *
 * - It holds only the editions it names, plus the hub editions WLC and
 *   SBLGNT: every edition maps a verse to its Hebrew or Greek words (ADR-0008),
 *   and a BSB word's `originals` are addresses in them. An app ships one pack
 *   with all its editions, so the hub is in it once. Books, canons and data
 *   sources with their credits come whole.
 * - It holds only the schemes of ADR-0008's target editions and of its own
 *   editions, with their mappings. `resolve` throws on an address under
 *   another scheme (`lxx`, `vul`).
 * - It has no `token` or `block` rows. A unit's words are its verse text's
 *   words (`verseWords`), which the ingest checks against the tokens.
 * - Each chapter document is deflated (`usj` holds a BLOB), which
 *   `readChapterDoc` inflates.
 *
 * Row ids are the corpus DB's: a pack is read alone, never merged with another.
 */

import { existsSync, rmSync } from 'node:fs';

import { deflateSync, strToU8 } from 'fflate';

import { LICENSED_EDITIONS } from '../contract/rights';
import { PIVOT } from '../model/mapping';
import { createCorpusDb, createIndexes } from '../ingest/write-db';

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
      doc.run(d.translation_id, d.book, d.chapter, Buffer.from(deflateSync(strToU8(d.usj), { level: 9 })), d.stamp);
    }
    for (const t of PER_EDITION) sqlite.exec(`INSERT INTO main.${t} SELECT * FROM src.${t} WHERE translation_id IN ${inList}${ofBooks}`);
    sqlite.exec('COMMIT');
    sqlite.exec('DETACH DATABASE src');

    createIndexes(sqlite);
    sqlite.exec('DROP TABLE token; DROP TABLE block');
    const broken = sqlite.pragma('foreign_key_check') as unknown[];
    if (broken.length > 0) throw new Error(`pack: ${broken.length} rows point at rows the pack lacks`);
    sqlite.exec('ANALYZE; VACUUM');
    return [...ids.keys()];
  } finally {
    sqlite.close();
  }
}

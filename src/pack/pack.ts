/**
 * A pack (plan step 13): the file an app ships, built from `build/corpus.db`,
 * which never ships. It is a SQLite file with the corpus tables, so
 * `corpusContract` reads it unchanged, and it differs from the corpus DB in
 * three ways:
 *
 * - It holds only the editions it names, plus the hub editions (WLC, SBLGNT)
 *   that their word alignments point at, since a BSB word's `originals` are
 *   addresses in them. The tables every edition needs (books, canons,
 *   schemes, mappings, data sources with their attributions) come whole.
 * - It has no `token` or `block` rows. A unit's words are its verse text's
 *   words (`verseWords`), which the ingest checks against the tokens.
 * - Each chapter document is deflated (`usj` holds a BLOB), which
 *   `readChapterDoc` inflates.
 *
 * Row ids are the corpus DB's: a pack is read alone, never merged with another.
 */

import { existsSync, rmSync } from 'node:fs';

import { deflateSync, strToU8 } from 'fflate';

import { createCorpusDb, createIndexes } from '../ingest/write-db';

/** Tables every pack copies whole. */
const SHARED = [
  'data_source',
  'book',
  'canon',
  'canon_section',
  'canon_entry',
  'canon_entry_book',
  'book_name',
  'scheme',
  'scheme_verse_count',
  'scheme_excluded_verse',
  'scheme_segment',
  'scheme_title',
  'scheme_mapping',
] as const;

/** Tables a pack copies for its editions only, after `translation`. `chapter_doc` is deflated on the way. */
const PER_EDITION = ['verse_text', 'reading', 'original_word', 'word_alignment'] as const;

/**
 * Build a pack of `editions` (abbreviations) from the corpus DB at
 * `corpusPath`, at `outPath`. Returns every edition the pack holds, the hubs
 * added for alignments last.
 */
export function buildPack(corpusPath: string, outPath: string, editions: readonly string[]): string[] {
  if (!existsSync(corpusPath)) throw new Error(`${corpusPath}: no corpus DB, run \`bun run ingest\` first`);
  rmSync(outPath, { force: true });
  const { sqlite } = createCorpusDb(outPath, { deferIndexes: true });
  try {
    sqlite.prepare('ATTACH DATABASE ? AS src').run(corpusPath);
    const ids = new Map<string, number>();
    const idOf = sqlite.prepare<[string], { id: number }>('SELECT id FROM src.translation WHERE abbrev = ?');
    for (const e of editions) {
      const row = idOf.get(e);
      if (!row) throw new Error(`pack: the corpus has no edition "${e}"`);
      ids.set(e, row.id);
    }
    // the hubs an edition's alignment rows point at
    const hubs = sqlite
      .prepare<number[], { abbrev: string; id: number }>(
        `SELECT DISTINCT t.abbrev, t.id FROM src.word_alignment a
         JOIN src.original_word o ON o.source = a.source AND o.ow_id = a.ow_id
         JOIN src.translation t ON t.id = o.translation_id
         WHERE a.translation_id IN (${[...ids.values()].map(() => '?').join(', ')})
         ORDER BY t.abbrev`,
      )
      .all(...ids.values());
    for (const h of hubs) if (!ids.has(h.abbrev)) ids.set(h.abbrev, h.id);
    const inList = `(${[...ids.values()].join(', ')})`;

    sqlite.exec('BEGIN');
    for (const t of SHARED) sqlite.exec(`INSERT INTO main.${t} SELECT * FROM src.${t}`);
    sqlite.exec(`INSERT INTO main.translation SELECT * FROM src.translation WHERE id IN ${inList}`);
    const doc = sqlite.prepare('INSERT INTO main.chapter_doc (translation_id, book, chapter, usj, stamp) VALUES (?, ?, ?, ?, ?)');
    const docs = sqlite.prepare<[], { translation_id: number; book: string; chapter: number; usj: string; stamp: string }>(
      `SELECT translation_id, book, chapter, usj, stamp FROM src.chapter_doc WHERE translation_id IN ${inList}`,
    );
    for (const d of docs.all()) {
      doc.run(d.translation_id, d.book, d.chapter, Buffer.from(deflateSync(strToU8(d.usj), { level: 9 })), d.stamp);
    }
    for (const t of PER_EDITION) sqlite.exec(`INSERT INTO main.${t} SELECT * FROM src.${t} WHERE translation_id IN ${inList}`);
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

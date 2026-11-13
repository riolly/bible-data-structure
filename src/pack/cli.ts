/**
 * `bun run pack [KJV BSB WLC+SBLGNT]`: build a pack per argument in
 * build/packs/ and measure it (plan step 13). For each pack it prints the file
 * size, gzipped and by table, and the time `chapter` takes for every chapter
 * of its first edition. Every chapter, and every verse's words in each book's
 * first chapter, must read the same from the pack as from build/corpus.db, or
 * it stops.
 */

import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { BibleContract } from '../contract/contract';
import { corpusContract } from '../contract/corpus-contract';
import * as schema from '../db/corpus-schema';
import { buildPack } from './pack';

const BUILD = join(import.meta.dirname, '..', '..', 'build');
const CORPUS = join(BUILD, 'corpus.db');
const OUT = join(BUILD, 'packs');

const open = (path: string) => {
  const sqlite = new Database(path, { readonly: true });
  return { sqlite, contract: corpusContract(drizzle({ client: sqlite, schema })) };
};

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

async function measure(names: readonly string[], corpus: BibleContract) {
  const edition = names[0];
  const path = join(OUT, `${names.join('+')}.db`);
  let t = performance.now();
  const editions = buildPack(CORPUS, path, names);
  console.log(`${names.join('+')}.db: ${editions.join(', ')}, built in ${((performance.now() - t) / 1000).toFixed(1)} s`);
  const bytes = statSync(path).size;
  console.log(`  ${mb(bytes)}, ${mb(gzipSync(readFileSync(path), { level: 9 }).length)} gzipped`);

  const { sqlite, contract } = open(path);
  const tables = sqlite
    .prepare<[], { name: string; bytes: number }>(
      `SELECT coalesce(m.tbl_name, d.name) name, sum(d.pgsize) bytes FROM dbstat d
       LEFT JOIN sqlite_master m ON m.name = d.name GROUP BY 1 ORDER BY 2 DESC`,
    )
    .all();
  console.log(`  ${tables.filter((r) => r.bytes >= 0.05 * bytes).map((r) => `${r.name} ${mb(r.bytes)}`).join(', ')}`);

  const chapters = sqlite
    .prepare<[string], { book: string; chapter: number }>(
      `SELECT d.book, d.chapter FROM chapter_doc d JOIN translation t ON t.id = d.translation_id
       JOIN book b ON b.code = d.book WHERE t.abbrev = ? AND d.chapter > 0 ORDER BY b.usfm_number, d.chapter`,
    )
    .all(edition);
  const ms: number[] = [];
  let words = 0;
  let lastBook = '';
  for (const { book, chapter } of chapters) {
    t = performance.now();
    const got = await contract.chapter(edition, book, chapter);
    ms.push(performance.now() - t);
    if (JSON.stringify(got) !== JSON.stringify(await corpus.chapter(edition, book, chapter))) {
      throw new Error(`${edition} ${book} ${chapter}: the pack's chapter differs from the corpus DB's`);
    }
    // every verse's words in each book's first chapter: about 3 ms a call on each side
    if (got.kind !== 'chapter' || book === lastBook) continue;
    lastBook = book;
    for (const v of got.verses) {
      const [a, b] = await Promise.all([contract.words(edition, v.address), corpus.words(edition, v.address)]);
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${v.address}: the pack's words differ from the corpus DB's`);
      words += a.words.length;
    }
  }
  sqlite.close();
  const first = ms[0];
  const sorted = ms.slice(1).sort((x, y) => x - y);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(2);
  console.log(`  ${chapters.length} ${edition} chapters, and the ${words} words of each book's first chapter, read the same as from the corpus DB`);
  console.log(`  chapter read: first ${first.toFixed(1)} ms, then median ${at(0.5)} ms, p95 ${at(0.95)} ms, max ${at(1)} ms`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const corpus = open(CORPUS);
  // a pack per argument, editions joined by `+`; the first edition's chapters are timed
  for (const pack of process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['KJV', 'BSB', 'WLC+SBLGNT']) {
    await measure(pack.split('+'), corpus.contract);
  }
  corpus.sqlite.close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});

/**
 * `bun run pack [WLC+SBLGNT KJV BSB KJV+BSB]`: build a pack per argument in
 * build/packs/ and measure it (plan step 13). Every pack holds the hubs. For
 * each pack it prints the file size, gzipped and by table, and the time
 * `chapter` takes for every chapter of its first edition. It stops unless
 * `checkPack` finds that the pack reads the same as build/corpus.db.
 */

import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { BibleContract } from '../contract/contract';
import { corpusContract } from '../contract/corpus-contract';
import * as schema from '../db/corpus-schema';
import { buildPack, checkPack, openPack } from './pack';

const BUILD = join(import.meta.dirname, '..', '..', 'build');
const CORPUS = join(BUILD, 'corpus.db');
const OUT = join(BUILD, 'packs');

const openCorpus = (path: string) => {
  const sqlite = new Database(path, { readonly: true });
  return { sqlite, contract: corpusContract(drizzle({ client: sqlite, schema })) };
};

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

async function measure(names: readonly string[], corpus: BibleContract) {
  const edition = names[0];
  const path = join(OUT, `${names.join('+')}.db`);
  const t = performance.now();
  const editions = buildPack(CORPUS, path, names);
  console.log(`${names.join('+')}.db: ${editions.join(', ')}, built in ${((performance.now() - t) / 1000).toFixed(1)} s`);
  const bytes = statSync(path).size;
  console.log(`  ${mb(bytes)}, ${mb(gzipSync(readFileSync(path), { level: 9 }).length)} gzipped`);

  const pack = openPack(path);
  const tables = pack.sqlite
    .prepare<[], { name: string; bytes: number }>(
      `SELECT coalesce(m.tbl_name, d.name) name, sum(d.pgsize) bytes FROM dbstat d
       LEFT JOIN sqlite_master m ON m.name = d.name GROUP BY 1 ORDER BY 2 DESC`,
    )
    .all();
  console.log(`  ${tables.filter((r) => r.bytes >= 0.05 * bytes).map((r) => `${r.name} ${mb(r.bytes)}`).join(', ')}`);

  const { chapters, words, ms } = await checkPack(pack, corpus, edition);
  pack.sqlite.close();
  const first = ms[0];
  const sorted = ms.slice(1).sort((x, y) => x - y);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(2);
  console.log(`  ${chapters} ${edition} chapters, and the ${words} words of each book's first chapter and its map to the hubs, read the same as from the corpus DB`);
  console.log(`  chapter read: first ${first.toFixed(1)} ms, then median ${at(0.5)} ms, p95 ${at(0.95)} ms, max ${at(1)} ms`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const corpus = openCorpus(CORPUS);
  // a pack per argument, editions joined by `+`; the first edition's chapters are timed
  for (const pack of process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['WLC+SBLGNT', 'KJV', 'BSB', 'KJV+BSB']) {
    await measure(pack.split('+'), corpus.contract);
  }
  corpus.sqlite.close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});

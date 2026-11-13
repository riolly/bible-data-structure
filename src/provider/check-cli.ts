/**
 * `bun run api-bible:check`: render plan step 10's done chapters through the
 * app contract, with local editions from `build/corpus.db` and licensed ones
 * from API.Bible through the kept responses in `build/api-bible/`. Prints
 * counts and stamps, never the licensed text. Exits 1 when a check fails.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { dbReader } from '../contract/reader';
import { LICENSED_EDITIONS } from '../contract/rights';
import * as schema from '../db/corpus-schema';
import { apiBibleKey, chapterFetcher } from './api-bible-cache';
import { provider } from './provider';

const CORPUS = join('build', 'corpus.db');
const key = apiBibleKey();
if (!existsSync(CORPUS)) {
  console.error(`${CORPUS} is missing: run bun run ingest`);
  process.exit(2);
}

const CHAPTERS: [edition: string, book: string, chapter: number][] = [
  ['NASB95', 'JHN', 3],
  ['NASB95', 'PSA', 119],
  ['NLT', 'NUM', 1],
  ['NIV', 'JHN', 3],
];

async function main(key: string) {
  const db = drizzle({ client: new Database(CORPUS, { readonly: true }), schema });
  const c = provider({ local: dbReader(db), fetchChapter: chapterFetcher({ key, dir: join('build', 'api-bible') }) });
  let failed = false;
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    failed ||= !ok;
  };

  for (const [edition, book, chapter] of CHAPTERS) {
    const ch = await c.chapter(edition, book, chapter);
    if (ch.kind === 'absent') {
      check(false, `${edition} ${book} ${chapter}: absent (${ch.reason})`);
      continue;
    }
    const units = ch.verses;
    const bridges = units.filter((u) => u.kind === 'bridge').map((u) => u.address);
    check(
      units.length > 0 && units.every((u) => u.chapterStamp === ch.stamp),
      `${edition} ${book} ${chapter}: ${units.length} units, ${units[0].address} to ${units.at(-1)!.address}, bridges [${bridges.join(', ')}], stamp ${ch.stamp}`,
    );
    const m = await c.map(edition, `${book} ${chapter}:1`, 'KJV');
    check(m.kind !== 'absent', `${edition} ${book} ${chapter}:1 maps to KJV ${m.verses.map((v) => v.address).join(', ')}`);
  }

  // NLT prints Numbers 1:20-21 as one unit (research/api-bible.md)
  const bridge = await c.verseText('NLT', 'NUM 1:21');
  check(bridge.found.kind === 'bridge' && bridge.found.address === 'NUM 1:20-21/nlt', `NLT NUM 1:21 is ${bridge.found.kind} ${bridge.found.address}`);

  for (const id of LICENSED_EDITIONS.keys()) {
    const r = await c.rights(id);
    console.log(`rights ${id}: ${r.route}, ${r.offline} ${r.refreshDays} days, copy ${r.copyLimit}, keep ${r.keepLimit}, AI ${r.aiUse}`);
  }
  const unsupported = c.unsupported();
  console.log(unsupported.size === 0 ? 'unsupported markers: none' : `unsupported markers: ${JSON.stringify(Object.fromEntries(unsupported))}`);
  process.exit(failed ? 1 : 0);
}

void main(key);

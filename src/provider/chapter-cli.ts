/**
 * `bun run api-bible:chapter NASB95 JHN 3`: fetch one licensed chapter (or
 * read the kept response) and print what the contract gets from it: the
 * provider's read (`readLicensedChapter`), with the edition's scheme from
 * src/ingest/schemes.ts. The text stays in `build/api-bible/`, which git
 * ignores.
 */

import { join } from 'node:path';

import { LICENSED_EDITIONS } from '../contract/rights';
import { loadSchemes } from '../ingest/schemes';
import { readLicensedChapter } from './api-bible';
import { apiBibleKey, cachedChapter } from './api-bible-cache';

const [edition, book, chapter] = process.argv.slice(2);
const licensed = LICENSED_EDITIONS.get(edition ?? '');
if (!licensed || !book || !/^\d+$/.test(chapter ?? '')) {
  console.error('usage: bun run api-bible:chapter <edition> <BOOK> <chapter>');
  process.exit(2);
}
const key = apiBibleKey();

async function main(key: string) {
  const scheme = loadSchemes().get(licensed!.scheme)!;
  const got = await cachedChapter(edition, book, Number(chapter), { key, dir: join('build', 'api-bible') });
  const read = await readLicensedChapter(edition, licensed!, scheme, book, Number(chapter), got.data);
  const units = read.verses;
  console.log(`${edition} ${book} ${chapter}: ${got.fetched ? 'fetched' : 'kept'} ${got.fetchedAt}`);
  console.log(`verse units ${units.length}, verses ${units[0]?.verse}-${units.at(-1)?.lastVerse}, bridges ${units.filter((u) => u.lastVerse > u.verse).length}`);
  console.log(`stamp ${read.stamp}`);
  console.log(`unsupported ${JSON.stringify(read.unsupported)}`);
}

void main(key);

/**
 * `bun run api-bible:chapter NASB95 JHN 3`: fetch one licensed chapter (or
 * read the kept response) and print what the contract would get from it. The
 * text stays in `build/api-bible/`, which git ignores.
 */

import { join } from 'node:path';

import { API_BIBLE_EDITIONS, readApiBibleChapter } from './api-bible';
import { apiBibleKey, cachedChapter } from './api-bible-cache';

const [edition, book, chapter] = process.argv.slice(2);
if (!edition || !book || !/^\d+$/.test(chapter ?? '')) {
  console.error('usage: bun run api-bible:chapter <edition> <BOOK> <chapter>');
  process.exit(2);
}
const key = apiBibleKey();

async function main(key: string) {
  const got = await cachedChapter(edition, book, Number(chapter), { key, dir: join('build', 'api-bible') });
  // a title before verse 1 is verse 0, by the edition's own title test, as the facts read it
  const read = await readApiBibleChapter(got.data, {
    isTitle: API_BIBLE_EDITIONS.get(edition)!.isTitle,
    titleChapters: new Set([Number(chapter)]),
  });
  const units = read.verses;
  console.log(`${edition} ${book} ${chapter}: ${got.fetched ? 'fetched' : 'kept'} ${got.fetchedAt}`);
  console.log(`verse units ${units.length}, verses ${units[0]?.verse}-${units.at(-1)?.lastVerse}, bridges ${units.filter((u) => u.lastVerse > u.verse).length}`);
  console.log(`stamp ${read.stamp}`);
  console.log(`unsupported ${JSON.stringify(read.unsupported)}`);
}

void main(key);

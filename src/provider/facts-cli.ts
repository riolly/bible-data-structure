/**
 * `bun run api-bible:facts NASB95`: fetch a licensed edition a passage at a
 * time (at most 200 verses a call, about 200 calls for a Bible), write its
 * facts to `src/provider/facts/<edition>.json`, and print how its chapters
 * differ from the `kjv` and `eng` schemes. The passages are kept in
 * `build/api-bible/` for 30 days, so a rerun makes no call.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { lastVerse } from '../model/scheme';
import { loadSchemes } from '../ingest/schemes';
import { TVTMS } from '../ingest/sources';
import { readTvtms } from '../ingest/tvtms';
import { API_BIBLE_EDITIONS, type ApiBibleNode } from './api-bible';
import { ApiBibleHttpError, apiBibleKey, cachedBooks, cachedPassage, type CacheOptions } from './api-bible-cache';
import { FACTS_DIR, editionFacts, type BookContent } from './edition-facts';

const PASSAGE_ID = /^([0-9A-Z]{3})\.(\d+)\.(\d+)-\1\.(\d+)\.(\d+)$/;

async function bookContent(edition: string, book: string, lastChapter: number, opts: CacheOptions) {
  const content: ApiBibleNode[] = [];
  let start = `${book}.1.1`;
  let calls = 0;
  let oldest = '9999';
  for (;;) {
    let got;
    try {
      got = await cachedPassage(edition, `${start}-${book}.${lastChapter}.999`, opts);
    } catch (e) {
      // a book of exactly 200n verses: the next start is past its end. Any
      // other error (429, 401, 403) stops the run rather than cut the book.
      if (e instanceof ApiBibleHttpError && (e.status === 400 || e.status === 404) && content.length > 0) break;
      throw e;
    }
    if (got.fetched) calls++;
    if (got.fetchedAt < oldest) oldest = got.fetchedAt;
    content.push(...got.data.content);
    const m = PASSAGE_ID.exec(got.data.id);
    if (!m) throw new Error(`${edition}: unexpected passage id "${got.data.id}"`);
    const [endChapter, endVerse] = [Number(m[4]), Number(m[5])];
    if (got.data.verseCount === undefined) throw new Error(`${edition}: passage ${got.data.id} has no verseCount`);
    if (got.data.verseCount < 200) break;
    start = `${book}.${endChapter}.${endVerse + 1}`;
  }
  return { content, calls, oldest };
}

async function main(edition: string, key: string) {
  const entry = API_BIBLE_EDITIONS.get(edition);
  if (!entry) throw new Error(`no API.Bible edition "${edition}"`);
  const opts: CacheOptions = { key, dir: join('build', 'api-bible') };
  const books = (await cachedBooks(edition, opts)).data;
  const contents: BookContent[] = [];
  let calls = 0;
  let oldest = '9999';
  for (const b of books) {
    const chapters = b.chapters.filter((c) => /^\d+$/.test(c.number)).map((c) => Number(c.number));
    const got = await bookContent(edition, b.id, Math.max(...chapters), opts);
    calls += got.calls;
    if (got.oldest < oldest) oldest = got.oldest;
    contents.push({ book: b.id, content: got.content });
    process.stdout.write(`${b.id} `);
  }
  console.log(`\n${calls} passage calls`);
  const meta = { edition, bibleId: entry.bibleId, fetched: oldest.slice(0, 10), tvtms: TVTMS.sha256 };
  const facts = editionFacts(meta, entry.isTitle, contents, readTvtms());
  await mkdir(FACTS_DIR, { recursive: true });
  await writeFile(join(FACTS_DIR, `${edition}.json`), JSON.stringify(facts, null, 1) + '\n');

  const schemes = loadSchemes();
  for (const id of ['kjv', 'eng']) {
    const s = schemes.get(id)!;
    const diffs: string[] = [];
    for (const [book, lasts] of Object.entries(facts.lastVerses)) {
      const n = Math.max(lasts.length, s.verseCounts.get(book)?.length ?? 0);
      for (let c = 1; c <= n; c++) {
        const ours = lasts[c - 1];
        const theirs = lastVerse(s, book, c);
        if (ours !== theirs) diffs.push(`${book} ${c}: ${ours ?? '-'} vs ${theirs ?? '-'}`);
      }
    }
    const titles = [...s.titles].filter((t) => t.startsWith('PSA '));
    const titled = new Set(facts.titled);
    console.log(`\nvs ${id}: ${diffs.length} chapters differ${diffs.length ? `\n  ${diffs.join('\n  ')}` : ''}`);
    console.log(`  titles only in ${edition}: ${facts.titled.filter((t) => !titles.includes(t)).join(' ') || 'none'}`);
    console.log(`  titles only in ${id}: ${titles.filter((t) => !titled.has(t)).join(' ') || 'none'}`);
  }
  console.log(`\nbridges ${facts.bridges.join(' ') || 'none'}`);
  console.log(`parts ${facts.parts.join(' ') || 'none'}`);
  console.log(`missing ${facts.missing.join(' ') || 'none'}`);
  console.log(`unsupported ${JSON.stringify(facts.unsupported)}`);
}

const [edition] = process.argv.slice(2);
if (!edition) {
  console.error('usage: bun run api-bible:facts <edition>');
  process.exit(2);
}
const key = apiBibleKey();
main(edition, key).catch((e) => {
  console.error(e);
  process.exit(1);
});

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { dbReader } from '../contract/reader';
import { LICENSED_EDITIONS, type LicensedEdition } from '../contract/rights';
import type { SyncSqliteDb } from '../db/corpus-read';
import { sqliteLoads } from '../ingest/native-probe';
import { loadSchemes } from '../ingest/schemes';
import { readLicensedChapter, type ApiBibleChapter } from './api-bible';
import { chapterFetcher } from './api-bible-cache';
import { provider } from './provider';

/**
 * A licensed edition's record drives both the cache and the provider. NASB95
 * stands in with API.Bible's public-domain KJV fixtures (api-bible.test.ts),
 * over an in-memory corpus with the schemes and no text. No key, no network.
 */

const fixture = (name: string) =>
  (JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')) as { data: ApiBibleChapter }).data;
const JHN_3 = fixture('api-bible-kjv-JHN.3.json');
const PSA_3 = fixture('api-bible-kjv-PSA.3.json');
const NASB95 = LICENSED_EDITIONS.get('NASB95')!;
const day = 86_400_000;

let dir: string;
beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'licensed-'))));
afterEach(() => rm(dir, { recursive: true, force: true }));

describe.skipIf(!sqliteLoads())('a licensed edition through the cache and the provider', () => {
  let db: SyncSqliteDb;
  beforeAll(async () => {
    const { memoryCorpus } = await import('../contract/test-corpus');
    db = await memoryCorpus();
  }, 30_000);

  it('a kept chapter older than a 7-day refresh window is fetched again, and the call reads it', async () => {
    const weekly: LicensedEdition = { ...NASB95, rights: { ...NASB95.rights, refreshDays: 7 } };
    let clock = Date.parse('2026-11-13T00:00:00Z');
    const urls: string[] = [];
    const fetch = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ data: JHN_3 }));
    }) as typeof globalThis.fetch;
    const p = provider({
      local: dbReader(db),
      fetchChapter: chapterFetcher({ key: 'k', dir, fetch, now: () => new Date(clock) }),
      editions: new Map([['NASB95', weekly]]),
      now: () => clock,
    });
    expect((await p.verseText('NASB95', 'JHN 3:16')).found).toMatchObject({ address: 'JHN 3:16/nasb95' });
    clock += 10 * day;
    expect((await p.verseText('NASB95', 'JHN 3:16')).found).toMatchObject({ address: 'JHN 3:16/nasb95' });
    expect(urls).toHaveLength(2);
    const kept = JSON.parse(await readFile(join(dir, NASB95.bibleId, 'JHN.3.json'), 'utf8'));
    expect(kept.fetchedAt).toBe('2026-11-23T00:00:00.000Z');
  });

  it('api-bible:chapter reads a chapter as the provider does, to the same stamp', async () => {
    const chapters = new Map([
      ['JHN 3', JHN_3],
      ['PSA 3', PSA_3],
    ]);
    const p = provider({
      local: dbReader(db),
      fetchChapter: async (_, book, chapter) => ({ data: chapters.get(`${book} ${chapter}`)!, fetchedAt: '2026-11-13T00:00:00Z' }),
    });
    for (const [at, data] of chapters) {
      const [book, chapter] = at.split(' ');
      const got = await p.chapter('NASB95', book, Number(chapter));
      // the call chapter-cli.ts makes, with the scheme from src/ingest/schemes.ts
      const cli = await readLicensedChapter('NASB95', NASB95, loadSchemes().get(NASB95.scheme)!, book, Number(chapter), data);
      expect(got.kind === 'chapter' && got.stamp).toBe(cli.stamp);
      expect(got.kind === 'chapter' && got.verses.length).toBe(cli.verses.length);
    }
  });
});

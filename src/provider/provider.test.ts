import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { ContractError } from '../contract/contract';
import { dbReader } from '../contract/reader';
import type { RightsRecord } from '../contract/rights';
import type { SyncSqliteDb } from '../db/corpus-read';
import { sqliteLoads } from '../ingest/native-probe';
import type { ApiBibleChapter, ApiBibleNode } from './api-bible';
import { provider, type FetchChapter, type LicensedEdition } from './provider';

/**
 * The provider over build/corpus.db and two stand-in licensed editions, with
 * no key and no network. `KJVAB` is API.Bible's public-domain KJV, whose
 * John 3 and Psalm 3 are in fixtures/ (api-bible.test.ts), on scheme `kjv`.
 * `NLTX` is a hand-made Numbers 1 on scheme `nlt`, with NLT's `\v 20-21`
 * bridge and one unsupported marker. The tests skip until `bun run ingest` has run.
 */

const CORPUS = join(import.meta.dirname, '..', '..', 'build', 'corpus.db');
const native = sqliteLoads();

const fixture = (name: string) =>
  (JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')) as { data: ApiBibleChapter }).data;

const text = (s: string): ApiBibleNode => ({ type: 'text', text: s });
const tag = (name: string, attrs: Record<string, string>, items: ApiBibleNode[] = []): ApiBibleNode => ({ type: 'tag', name, attrs, items });

/** Numbers 1 as NLT prints it on API.Bible: verse 1, then 20 and 21 under one marker. */
const NUM_1: ApiBibleChapter = {
  id: 'NUM.1',
  bibleId: 'test',
  bookId: 'NUM',
  number: '1',
  reference: 'Numbers 1',
  copyright: '',
  content: [
    tag('chapter', { number: '1', style: 'c', sid: 'NUM 1' }, [text('1')]),
    tag('para', { style: 'p' }, [tag('verse', { number: '1', style: 'v', sid: 'NUM 1:1' }, [text('1')]), text('The Lord spoke to Moses.')]),
    tag('para', { style: 'qm1' }, [tag('verse', { number: '20-21', style: 'v', sid: 'NUM 1:20-21' }, [text('20-21')]), text('Reuben: 46,500.')]),
  ],
};

const testRights = (edition: string): RightsRecord => ({
  edition,
  license: 'Public Domain',
  licenseUrl: 'https://api.bible/terms-and-conditions',
  route: 'api.bible',
  offline: 'cache',
  refreshDays: 30,
  copyLimit: null,
  keepLimit: null,
  aiUse: 'allowed',
  attribution: null,
  conditions: [],
});

const EDITIONS = new Map<string, LicensedEdition>([
  ['KJVAB', { name: 'King James (Authorised) Version', language: 'english', scheme: 'kjv', rights: testRights('KJVAB') }],
  ['NLTX', { name: 'NLT stand-in', language: 'english', scheme: 'nlt', rights: testRights('NLTX') }],
]);

const CHAPTERS = new Map<string, ApiBibleChapter>([
  ['KJVAB JHN 3', fixture('api-bible-kjv-JHN.3.json')],
  ['KJVAB PSA 3', fixture('api-bible-kjv-PSA.3.json')],
  ['NLTX NUM 1', NUM_1],
]);

describe.skipIf(!native || !existsSync(CORPUS))('the provider: local and licensed editions through one contract', () => {
  let db: SyncSqliteDb;
  let clock = Date.parse('2026-11-13T00:00:00Z');

  /** A provider whose fetch serves the chapters above, or null, and logs each call. */
  const make = () => {
    const fetches: string[] = [];
    const fetchChapter: FetchChapter = async (edition, book, chapter) => {
      const key = `${edition} ${book} ${chapter}`;
      fetches.push(key);
      const data = CHAPTERS.get(key);
      return data ? { data, fetchedAt: new Date(clock).toISOString() } : null;
    };
    return { p: provider({ local: dbReader(db), fetchChapter, editions: EDITIONS, now: () => clock }), fetches };
  };

  beforeAll(async () => {
    const { default: Database } = await import('better-sqlite3');
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const schema = await import('../db/corpus-schema');
    db = drizzle({ client: new Database(CORPUS, { readonly: true }), schema });
  });

  it('chapter: a fetched chapter with its stamp, and a licensed edition has no edition stamps', async () => {
    const { p, fetches } = make();
    const ch = await p.chapter('KJVAB', 'JHN', 3);
    if (ch.kind !== 'chapter') throw new Error('absent');
    expect(ch.edition).toEqual({ id: 'KJVAB', scheme: 'kjv', stamp: null, wordsStamp: null, textStamp: null });
    expect(ch.stamp).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(ch.front).toBeNull();
    expect(ch.verses).toHaveLength(36);
    expect(ch.verses[15]).toMatchObject({ kind: 'verse', address: 'JHN 3:16/kjv', chapterStamp: ch.stamp });
    // a local edition reads from the DB through the same contract
    expect((await p.verseText('KJV', 'JHN 3:16')).edition.stamp).toMatch(/^sha256:/);
    expect(fetches).toEqual(['KJVAB JHN 3']);
  });

  it('verseText: a held chapter is not fetched again, and two calls at once fetch it once', async () => {
    const { p, fetches } = make();
    const [a, b] = await Promise.all([p.verseText('KJVAB', 'JHN 3:16'), p.verseText('KJVAB', 'JHN 3:17')]);
    expect(a.found).toMatchObject({ address: 'JHN 3:16/kjv', text: expect.stringMatching(/^For God so loved the world/) });
    expect(b.found).toMatchObject({ address: 'JHN 3:17/kjv' });
    await p.verseText('KJVAB', 'JHN 3:18');
    expect(fetches).toEqual(['KJVAB JHN 3']);
  });

  it('map: a call that touches an unfetched chapter fetches it, from and to a local edition', async () => {
    const { p, fetches } = make();
    // WLC numbers Psalm 3's title as 3:1, and the scheme kjv as 3:0, so verse 2 is KJVAB's 3:1
    const to = await p.map('WLC', 'PSA 3:2', 'KJVAB');
    expect([to.kind, to.verses.map((v) => v.address)]).toEqual(['one', ['PSA 3:1/kjv']]);
    expect(fetches).toEqual(['KJVAB PSA 3']);
    const title = await p.map('KJVAB', 'PSA 3:0', 'WLC');
    expect([title.kind, title.verses.map((v) => v.address)]).toEqual(['one', ['PSA 3:1/org']]);
    const from = await p.map('KJVAB', 'JHN 3:16', 'BSB');
    expect([from.kind, from.verses.map((v) => v.address)]).toEqual(['one', ['JHN 3:16/bsb']]);
    // mapping from an edition reads only its scheme, so John 3 is never fetched
    expect(fetches).toEqual(['KJVAB PSA 3']);
  });

  it('passage: a chapter the edition does not print is absent, and asked for once', async () => {
    const { p, fetches } = make();
    const r = await p.passage('KJVAB', 'John 3:36-4:1');
    expect(r.parts[0].found.map((l) => `${l.kind} ${l.address}`)).toEqual(['verse JHN 3:36/kjv', 'absent JHN 4:1/kjv']);
    expect((await p.chapter('KJVAB', 'JHN', 4)).kind).toBe('absent');
    // the scheme has no 22nd chapter of John, so nothing is fetched for it
    expect((await p.chapter('KJVAB', 'JHN', 22)).kind).toBe('absent');
    expect(fetches).toEqual(['KJVAB JHN 3', 'KJVAB JHN 4']);
  });

  it('words: a licensed verse has its words, with no originals', async () => {
    const { p } = make();
    const w = await p.words('KJVAB', 'JHN 3:16!1');
    expect(w.words).toEqual([{ address: 'JHN 3:16!1/kjv', text: 'For', kind: 'word', strongs: [], original: null, originals: [] }]);
    // the hub's words still come from the DB
    expect((await p.words('SBLGNT', 'JHN 3:16!1')).words[0].strongs).toEqual(['G3779']);
  });

  it('a bridge: both numbers find the one unit, and map to it', async () => {
    const { p } = make();
    for (const v of ['NUM 1:20', 'NUM 1:21']) {
      expect((await p.verseText('NLTX', v)).found).toMatchObject({ kind: 'bridge', address: 'NUM 1:20-21/nlt', text: 'Reuben: 46,500.' });
    }
    const m = await p.map('KJV', 'NUM 1:21', 'NLTX');
    expect([m.kind, m.verses.map((v) => v.address)]).toEqual(['one', ['NUM 1:20-21/nlt']]);
    expect((await p.resolve('NLTX', 'NUM 1:20-21/nlt')).found.map((l) => l.address)).toEqual(['NUM 1:20-21/nlt']);
    // the `\qm1` paragraph keeps its text and is counted
    expect(p.unsupported()).toEqual(new Map([['NLTX NUM 1', { 'para:qm1': 1 }]]));
  });

  it('a held chapter older than refreshDays is fetched again', async () => {
    const { p, fetches } = make();
    await p.verseText('KJVAB', 'JHN 3:16');
    clock += 31 * 86_400_000;
    await p.verseText('KJVAB', 'JHN 3:16');
    expect(fetches).toEqual(['KJVAB JHN 3', 'KJVAB JHN 3']);
  });

  it('editions and books: the licensed editions after the local ones, their books listed without a fetch', async () => {
    const { p, fetches } = make();
    const editions = await p.editions();
    expect(editions.map((e) => e.id)).toEqual(['KJV', 'BSB', 'WLC', 'SBLGNT', 'RP', 'WEB', 'Brenton', 'KJVAB', 'NLTX']);
    expect(editions.at(-1)).toEqual({ id: 'NLTX', name: 'NLT stand-in', language: 'english', scheme: 'nlt', stamp: null, wordsStamp: null, textStamp: null });
    const books = await p.books('NLTX');
    expect(books).toHaveLength(66);
    expect([books[0], books[3], books.at(-1)]).toEqual([
      { book: 'GEN', name: 'Genesis', section: 'ot', chapters: 50 },
      { book: 'NUM', name: 'Numbers', section: 'ot', chapters: 36 },
      { book: 'REV', name: 'Revelation', section: 'nt', chapters: 22 },
    ]);
    expect((await p.books('KJV')).map((b) => [b.book, b.chapters])).toEqual((await p.books('KJVAB')).map((b) => [b.book, b.chapters]));
    expect(fetches).toEqual([]);
  });

  it('a failed fetch rejects the call as unavailable, with the fetch error as its cause', async () => {
    const offline: FetchChapter = async () => {
      throw new Error('offline');
    };
    const p = provider({ local: dbReader(db), fetchChapter: offline, editions: EDITIONS });
    const e = (await p.chapter('KJVAB', 'JHN', 3).catch((x: unknown) => x)) as ContractError;
    expect(e).toBeInstanceOf(ContractError);
    expect([e.code, e.message, (e.cause as Error).message]).toEqual(['unavailable', 'KJVAB JHN 3 could not be read: offline', 'offline']);
    expect(((await p.map('KJV', 'JHN 3:16', 'KJVAB').catch((x: unknown) => x)) as ContractError).code).toBe('unavailable');
    // a local edition still reads
    expect((await p.chapter('KJV', 'JHN', 3)).kind).toBe('chapter');
  });

  it('rights: the licensed records, and the local ones from rights.ts', async () => {
    const p = provider({ local: dbReader(db), fetchChapter: async () => null });
    for (const id of ['NASB95', 'NLT', 'NIV']) {
      expect(await p.rights(id)).toMatchObject({ edition: id, route: 'api.bible', offline: 'cache', refreshDays: 30, copyLimit: 100 });
      expect((await p.rights(id)).attribution).toMatch(/Copyright|copyright/);
    }
    // API.Bible allows a whole Bible to be kept (research/licensing.md, answered on 2026-11-17)
    expect(await Promise.all(['NASB95', 'NLT', 'NIV', 'KJV'].map(async (id) => (await p.rights(id)).keepLimit))).toEqual([null, null, null, null]);
    expect((await p.rights('NASB95')).aiUse).toBe('no-training');
    expect((await p.rights('NLT')).aiUse).toBe('no-training');
    expect((await p.rights('NIV')).aiUse).toBe('none');
    expect((await p.rights('NASB95')).conditions.join(' ')).toMatch(/1,000 verses/);
    expect((await p.rights('NLT')).conditions.join(' ')).toMatch(/exactly/);
    expect((await p.rights('KJV')).route).toBe('local');
    expect((await make().p.rights('KJVAB')).route).toBe('api.bible');
  });
});

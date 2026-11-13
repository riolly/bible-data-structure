import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readerContract } from '../contract/corpus-contract';
import type { CorpusReader } from '../contract/reader';
import type { LicensedEdition, RightsRecord } from '../contract/rights';
import type { Scheme } from '../model/scheme';
import type { ApiBibleChapter } from './api-bible';
import { licensedChapters, type FetchChapter } from './licensed-chapters';

/**
 * The licensed chapters alone: a stub fetch over API.Bible's KJV John 3
 * (fixtures/, api-bible.test.ts), a hand-made scheme and a clock. No SQLite.
 */

const JHN_3 = (JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'api-bible-kjv-JHN.3.json'), 'utf8')) as { data: ApiBibleChapter }).data;
const JHN_4: ApiBibleChapter = { ...JHN_3, id: 'JHN.4', number: '4', content: JHN_3.content.map((n) => (n.name === 'chapter' ? { ...n, attrs: { ...n.attrs, number: '4' } } : n)) };

const SCHEME: Scheme = {
  id: 'tst',
  name: 'Test',
  sourceUrl: '',
  note: '',
  verseCounts: new Map([['JHN', [51, 25, 36, 54]]]),
  excluded: new Set(),
  segments: new Map(),
  titles: new Set(),
};
const rights = { edition: 'KJVAB', route: 'api.bible', refreshDays: 30 } as RightsRecord;
const EDITIONS = new Map<string, LicensedEdition>([['KJVAB', { scheme: 'tst', rights }]]);
const day = 86_400_000;

/** Licensed chapters whose fetch logs each call and waits for `serve` when `hold` is set. */
function make(chapters = new Map([['JHN 3', JHN_3]])) {
  let clock = Date.parse('2026-11-13T00:00:00Z');
  const fetches: string[] = [];
  const waiting: (() => void)[] = [];
  const state = { hold: false, fail: false };
  const fetchChapter: FetchChapter = async (_, book, chapter) => {
    fetches.push(`${book} ${chapter}`);
    if (state.hold) await new Promise<void>((done) => waiting.push(done));
    if (state.fail) throw new Error('stub: network down');
    const data = chapters.get(`${book} ${chapter}`);
    return data ? { data, fetchedAt: new Date(clock).toISOString() } : null;
  };
  const held = licensedChapters({ editions: EDITIONS, fetchChapter, schemeOf: () => SCHEME, now: () => clock });
  return {
    held,
    fetches,
    state,
    chapters,
    serve: () => waiting.splice(0).forEach((done) => done()),
    later: (ms: number) => (clock += ms),
  };
}

describe('licensed chapters: hold, refresh and fetch', () => {
  it('a chapter is not held before its fetch, and held after it', async () => {
    const t = make();
    const first = t.held.chapter('KJVAB', 'JHN', 3);
    expect(first).toBeInstanceOf(Promise);
    const read = await first;
    expect(read?.verses).toHaveLength(36);
    expect(t.held.chapter('KJVAB', 'JHN', 3)).toBe(read);
    expect(t.fetches).toEqual(['JHN 3']);
  });

  it('a chapter past its refresh days is not held again, and the refreshed chapter has its own stamp', async () => {
    const t = make();
    const old = await t.held.chapter('KJVAB', 'JHN', 3);
    t.later(29 * day);
    expect(t.held.chapter('KJVAB', 'JHN', 3)).toBe(old);
    t.later(2 * day);
    // the edition changed the chapter: a space at its end changes the document
    t.chapters.set('JHN 3', { ...JHN_3, content: [...JHN_3.content, { type: 'text', text: ' ' }] });
    const again = t.held.chapter('KJVAB', 'JHN', 3);
    expect(again).toBeInstanceOf(Promise);
    expect((await again)?.stamp).not.toBe(old?.stamp);
    expect(t.fetches).toEqual(['JHN 3', 'JHN 3']);
  });

  it('two reads at once share one fetch', async () => {
    const t = make();
    t.state.hold = true;
    const a = t.held.chapter('KJVAB', 'JHN', 3);
    const b = t.held.chapter('KJVAB', 'JHN', 3);
    expect(b).toBe(a);
    t.serve();
    expect(await a).toBe(await b);
    expect(t.fetches).toEqual(['JHN 3']);
  });

  it('a failed fetch rejects the read, and the next read fetches again', async () => {
    const t = make();
    t.state.fail = true;
    await expect(t.held.chapter('KJVAB', 'JHN', 3)).rejects.toThrow('stub: network down');
    t.state.fail = false;
    expect((await t.held.chapter('KJVAB', 'JHN', 3))?.verses).toHaveLength(36);
    expect(t.fetches).toEqual(['JHN 3', 'JHN 3']);
  });

  it('a fetch that gives a copy past the refresh days fails the read', async () => {
    const t = make();
    await t.held.chapter('KJVAB', 'JHN', 3);
    const stale: FetchChapter = async () => ({ data: JHN_3, fetchedAt: '2026-01-01T00:00:00Z' });
    const held = licensedChapters({ editions: EDITIONS, fetchChapter: stale, schemeOf: () => SCHEME, now: () => Date.parse('2026-11-13T00:00:00Z') });
    await expect(held.chapter('KJVAB', 'JHN', 3)).rejects.toThrow(/KJVAB JHN 3 is still missing after its fetch/);
  });

  it('never fetches chapter 0 or a chapter outside the scheme, and holds a chapter the edition does not print', async () => {
    const t = make();
    expect(t.held.chapter('KJVAB', 'JHN', 0)).toBeNull();
    expect(t.held.chapter('KJVAB', 'JHN', 22)).toBeNull();
    expect(await t.held.chapter('KJVAB', 'JHN', 4)).toBeNull();
    expect(t.held.chapter('KJVAB', 'JHN', 4)).toBeNull();
    expect(t.fetches).toEqual(['JHN 4']);
  });

  it('the contract fetches the chapters of one call at once', async () => {
    const t = make(new Map([['JHN 3', JHN_3], ['JHN 4', JHN_4]]));
    t.state.hold = true;
    const reader: CorpusReader = {
      edition: (abbrev) => ({ abbrev, scheme: 'tst', edition: null, wordsStamp: null, textStamp: null }),
      chapter: (id, book, chapter) => t.held.chapter(id, book, chapter),
      chapterDoc: () => null,
      originalWords: () => [],
      wordAlignments: () => [],
      dataSources: () => [],
      schemes: () => new Map([['tst', SCHEME]]),
      mappings: () => {
        throw new Error('no mappings');
      },
    };
    const passage = readerContract(reader).passage('KJVAB', 'John 3:36-4:1');
    await new Promise((done) => setTimeout(done, 0));
    expect(t.fetches).toEqual(['JHN 3', 'JHN 4']);
    t.serve();
    expect((await passage).parts[0].found.map((l) => l.address)).toEqual(['JHN 3:36/tst', 'JHN 4:1/tst']);
  });
});

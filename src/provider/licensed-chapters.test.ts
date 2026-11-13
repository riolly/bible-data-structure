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
/** John 3's 36 verses under another chapter number. */
const renumbered = (number: string): ApiBibleChapter => ({
  ...JHN_3,
  id: `JHN.${number}`,
  number,
  content: JHN_3.content.map((n) => (n.name === 'chapter' ? { ...n, attrs: { ...n.attrs, number } } : n)),
});
const JHN_1 = renumbered('1');
const JHN_4 = renumbered('4');

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
const rights = { edition: 'KJVAB', route: 'api.bible', refreshDays: 30, keepLimit: null } as RightsRecord;
const EDITIONS = new Map<string, LicensedEdition>([['KJVAB', { scheme: 'tst', rights }]]);
const day = 86_400_000;

/** Licensed chapters whose fetch logs each call and waits for `serve` when `hold` is set. */
function make(chapters = new Map([['JHN 3', JHN_3]]), editions = EDITIONS) {
  let clock = Date.parse('2026-11-13T00:00:00Z');
  const fetches: string[] = [];
  const waiting: (() => void)[] = [];
  /** `late`: the milliseconds the clock moves between a fetch and its return. */
  const state = { hold: false, fail: false, late: 0 };
  const fetchChapter: FetchChapter = async (_, book, chapter) => {
    fetches.push(`${book} ${chapter}`);
    if (state.hold) await new Promise<void>((done) => waiting.push(done));
    if (state.fail) throw new Error('stub: network down');
    const data = chapters.get(`${book} ${chapter}`);
    const fetchedAt = new Date(clock).toISOString();
    clock += state.late;
    return data ? { data, fetchedAt } : null;
  };
  const held = licensedChapters({ editions, fetchChapter, schemeOf: () => SCHEME, now: () => clock });
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

  it('a fetch that never answers fails its reads after the timeout, and the next read fetches again', async () => {
    let calls = 0;
    const fetchChapter: FetchChapter = async () => {
      if (++calls === 1) await new Promise(() => {});
      return { data: JHN_3, fetchedAt: '2026-11-13T00:00:00Z' };
    };
    const held = licensedChapters({ editions: EDITIONS, fetchChapter, schemeOf: () => SCHEME, now: () => Date.parse('2026-11-13T00:00:00Z'), fetchTimeoutMs: 20 });
    const stuck = held.chapter('KJVAB', 'JHN', 3);
    expect(held.chapter('KJVAB', 'JHN', 3)).toBe(stuck);
    await expect(stuck).rejects.toThrow(/KJVAB JHN 3: the fetch gave no answer in 20 ms/);
    expect((await held.chapter('KJVAB', 'JHN', 3))?.verses).toHaveLength(36);
    expect(calls).toBe(2);
  });

  it('a copy stamped after now is held from now, and refreshed once its days pass', async () => {
    let clock = Date.parse('2026-11-13T00:00:00Z');
    let calls = 0;
    const ahead: FetchChapter = async () => (calls++, { data: JHN_3, fetchedAt: '2028-01-01T00:00:00Z' });
    const held = licensedChapters({ editions: EDITIONS, fetchChapter: ahead, schemeOf: () => SCHEME, now: () => clock });
    const read = await held.chapter('KJVAB', 'JHN', 3);
    clock += 29 * day;
    expect(held.chapter('KJVAB', 'JHN', 3)).toBe(read);
    clock += 2 * day;
    expect(held.chapter('KJVAB', 'JHN', 3)).toBeInstanceOf(Promise);
    // the clock set back before the fetch: the held copy has no known age
    await held.chapter('KJVAB', 'JHN', 3);
    clock -= 40 * day;
    expect(held.chapter('KJVAB', 'JHN', 3)).toBeInstanceOf(Promise);
    expect(calls).toBe(3);
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

  it('gives null for a chapter the edition does not print when nothing is kept (0 refresh days)', async () => {
    const editions = new Map<string, LicensedEdition>([['KJVAB', { scheme: 'tst', rights: { ...rights, refreshDays: 0 } }]]);
    const held = licensedChapters({ editions, fetchChapter: async () => null, schemeOf: () => SCHEME, now: () => 0 });
    expect(await held.chapter('KJVAB', 'JHN', 4)).toBeNull();
  });

  it('0 refresh days keeps nothing: each read fetches, and the read that fetched gets the chapter', async () => {
    const editions = new Map<string, LicensedEdition>([['KJVAB', { scheme: 'tst', rights: { ...rights, refreshDays: 0 } }]]);
    const t = make(undefined, editions);
    expect((await t.held.chapter('KJVAB', 'JHN', 3))?.verses).toHaveLength(36);
    expect(t.held.chapter('KJVAB', 'JHN', 3)).toBeInstanceOf(Promise);
    expect([...t.held.unsupported()]).toEqual([]);
    expect(t.fetches).toEqual(['JHN 3', 'JHN 3']);
    // a real clock moves between the fetch and the read
    t.state.late = 5;
    expect((await t.held.chapter('KJVAB', 'JHN', 3))?.verses).toHaveLength(36);
  });

  it('0 refresh days: one `chapter` call of the contract fetches the chapter once', async () => {
    const editions = new Map<string, LicensedEdition>([['KJVAB', { scheme: 'tst', rights: { ...rights, refreshDays: 0 } }]]);
    const t = make(undefined, editions);
    const reader: CorpusReader = {
      edition: (abbrev) => ({ abbrev, scheme: 'tst', edition: null, wordsStamp: null, textStamp: null }),
      chapter: (id, book, chapter) => t.held.chapter(id, book, chapter),
      chapterDoc: (id, book, chapter) => {
        const r = t.held.chapter(id, book, chapter);
        return r instanceof Promise ? r.then((x) => x && { ...x.doc, stamp: x.stamp }) : r && { ...r.doc, stamp: r.stamp };
      },
      originalWords: () => [],
      wordAlignments: () => [],
      dataSources: () => [],
      schemes: () => new Map([['tst', SCHEME]]),
      mappings: () => {
        throw new Error('no mappings');
      },
    };
    const contract = readerContract(reader);
    const got = await contract.chapter('KJVAB', 'JHN', 3);
    if (got.kind !== 'chapter') throw new Error('absent');
    expect(got.verses).toHaveLength(36);
    expect(t.fetches).toEqual(['JHN 3']);
    await contract.chapter('KJVAB', 'JHN', 3);
    expect(t.fetches).toEqual(['JHN 3', 'JHN 3']);
  });

  // the scheme gives John 1, 3 and 4 51, 36 and 54 verses, which is what a keep limit counts
  const limited = (keepLimit: number) =>
    new Map<string, LicensedEdition>([
      ['KJVAB', { scheme: 'tst', rights: { ...rights, keepLimit } }],
      ['OTHER', { scheme: 'tst', rights: { ...rights, edition: 'OTHER' } }],
    ]);
  const isHeld = (t: ReturnType<typeof make>, edition: string, chapter: number) => !(t.held.chapter(edition, 'JHN', chapter) instanceof Promise);

  it('a keep limit drops the least recently read chapters of the edition, and no chapter of another edition', async () => {
    const t = make(new Map([['JHN 1', JHN_1], ['JHN 3', JHN_3], ['JHN 4', JHN_4]]), limited(100));
    await t.held.chapter('OTHER', 'JHN', 3);
    await t.held.chapter('KJVAB', 'JHN', 3);
    await t.held.chapter('KJVAB', 'JHN', 4);
    // 36 + 54 verses are held. Reading John 3 again makes John 4 the least recently read
    expect(isHeld(t, 'KJVAB', 3)).toBe(true);
    // John 1 makes 141: dropping John 4 leaves 87
    expect((await t.held.chapter('KJVAB', 'JHN', 1))?.verses).toHaveLength(36);
    expect(t.fetches).toEqual(['JHN 3', 'JHN 3', 'JHN 4', 'JHN 1']);
    expect(isHeld(t, 'KJVAB', 1)).toBe(true);
    expect(isHeld(t, 'KJVAB', 3)).toBe(true);
    expect(isHeld(t, 'OTHER', 3)).toBe(true);
    expect(t.fetches).toHaveLength(4);
    // John 4 was dropped, so its read fetches. It makes 141 again, and John 1, now the least recently read, goes for it
    expect(await t.held.chapter('KJVAB', 'JHN', 4)).not.toBeNull();
    expect(t.fetches).toEqual(['JHN 3', 'JHN 3', 'JHN 4', 'JHN 1', 'JHN 4']);
    expect(isHeld(t, 'KJVAB', 3)).toBe(true);
    expect(isHeld(t, 'KJVAB', 4)).toBe(true);
    expect(t.fetches).toHaveLength(5);
    // John 1 is not held, so its read is a fetch
    const dropped = t.held.chapter('KJVAB', 'JHN', 1);
    expect(dropped).toBeInstanceOf(Promise);
    await dropped;
  });

  it('a chapter with more verses than the keep limit is read and not held', async () => {
    const t = make(undefined, limited(30));
    expect((await t.held.chapter('KJVAB', 'JHN', 3))?.verses).toHaveLength(36);
    expect((await t.held.chapter('KJVAB', 'JHN', 3))?.verses).toHaveLength(36);
    expect(t.fetches).toEqual(['JHN 3', 'JHN 3']);
  });

  it('a refreshed chapter counts once toward the keep limit', async () => {
    const t = make(new Map([['JHN 3', JHN_3], ['JHN 4', JHN_4]]), limited(100));
    await t.held.chapter('KJVAB', 'JHN', 4);
    await t.held.chapter('KJVAB', 'JHN', 3);
    t.later(31 * day);
    // John 3 is refetched: 54 + 36 still fit, so John 4 stays held, though it is past its refresh days
    await t.held.chapter('KJVAB', 'JHN', 3);
    t.later(-31 * day);
    expect(isHeld(t, 'KJVAB', 4)).toBe(true);
  });

  it('the contract gives one copy of a chapter that is replaced between its two reads', async () => {
    // two copies of John 3: the second ends with one more text node, so its stamp differs
    const copy = async (extra: string) => {
      const content = [...JHN_3.content, { type: 'text', text: extra }] as ApiBibleChapter['content'];
      const t = make(new Map([['JHN 3', { ...JHN_3, content }]]));
      return (await t.held.chapter('KJVAB', 'JHN', 3))!;
    };
    const [first, second] = [await copy(' a'), await copy(' b')];
    expect(first.stamp).not.toBe(second.stamp);
    const reader = (units: (typeof first)[]): CorpusReader => ({
      edition: (abbrev) => ({ abbrev, scheme: 'tst', edition: null, wordsStamp: null, textStamp: null }),
      // the units come from `units` in turn, the last one from then on; the document is always the second copy's
      chapter: () => (units.length > 1 ? units.shift()! : units[0]),
      chapterDoc: (_, __, chapter) => (chapter === 3 ? { ...second.doc, stamp: second.stamp } : null),
      originalWords: () => [],
      wordAlignments: () => [],
      dataSources: () => [],
      schemes: () => new Map([['tst', SCHEME]]),
      mappings: () => {
        throw new Error('no mappings');
      },
    });
    const got = await readerContract(reader([first, second])).chapter('KJVAB', 'JHN', 3);
    if (got.kind !== 'chapter') throw new Error('absent');
    expect(got.stamp).toBe(second.stamp);
    expect(got.content).toEqual(second.doc.content);
    expect(got.verses.map((v) => v.text)).toEqual(second.verses.map((v) => v.text));
    // units that never match the document are an error, not a mixed chapter
    await expect(readerContract(reader([first])).chapter('KJVAB', 'JHN', 3)).rejects.toThrow('chapter: KJVAB JHN 3 changed while it was read');
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

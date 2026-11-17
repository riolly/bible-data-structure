import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LICENSED_EDITIONS } from '../contract/rights';
import { cachedChapter, cachedPassage, withPassages } from './api-bible-cache';

const NASB = 'b8ee27bcd1cae43a-01';

/** A stand-in for API.Bible that counts calls. No network. */
function fakeApi(status = 200) {
  const urls: string[] = [];
  const keys: (string | null)[] = [];
  const body = JSON.stringify({ data: { id: 'JHN.3', number: '3', content: [] }, meta: { fumsToken: 'x' } });
  const fetch = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    keys.push(new Headers(init?.headers).get('api-key'));
    return new Response(body, { status });
  }) as typeof globalThis.fetch;
  return { fetch, urls, keys, body };
}

let dir: string;
beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'api-bible-'))));
afterEach(() => rm(dir, { recursive: true, force: true }));

const day = 86_400_000;
const at = (t: number) => () => new Date(Date.UTC(2026, 10, 12) + t);

describe('cachedChapter: one call per chapter per 30 days', () => {
  it('fetches once, keeps the body unchanged, and reads it back until 30 days pass', async () => {
    const api = fakeApi();
    const opts = { key: 'k', dir, fetch: api.fetch };
    const first = await cachedChapter('NASB95', 'JHN', 3, { ...opts, now: at(0) });
    expect(first).toMatchObject({ fetched: true, fetchedAt: '2026-11-12T00:00:00.000Z', data: { id: 'JHN.3' } });
    expect(api.urls).toEqual([
      'https://rest.api.bible/v1/bibles/b8ee27bcd1cae43a-01/chapters/JHN.3?content-type=json&include-notes=true&include-titles=true&include-chapter-numbers=true&include-verse-numbers=true&include-verse-spans=false',
    ]);
    expect(api.keys).toEqual(['k']);
    const kept = JSON.parse(await readFile(join(dir, 'b8ee27bcd1cae43a-01', 'JHN.3.json'), 'utf8'));
    expect(kept.body).toBe(api.body);

    expect(await cachedChapter('NASB95', 'JHN', 3, { ...opts, now: at(30 * day - 1) })).toMatchObject({ fetched: false });
    expect(api.urls).toHaveLength(1);

    expect(await cachedChapter('NASB95', 'JHN', 3, { ...opts, now: at(30 * day) })).toMatchObject({
      fetched: true,
      fetchedAt: '2026-12-12T00:00:00.000Z',
    });
    expect(api.urls).toHaveLength(2);
  });

  it('keeps no copy for a rights record with 0 refresh days, and fetches on every read', async () => {
    const api = fakeApi();
    const opts = { key: 'k', dir, fetch: api.fetch, now: at(0) };
    const rights = { ...LICENSED_EDITIONS.get('NASB95')!.rights, refreshDays: 0 };
    expect(await cachedChapter('NASB95', 'JHN', 3, opts, rights)).toMatchObject({ fetched: true, data: { id: 'JHN.3' } });
    expect(await cachedChapter('NASB95', 'JHN', 3, opts, rights)).toMatchObject({ fetched: true });
    expect(api.urls).toHaveLength(2);
    await expect(readFile(join(dir, 'b8ee27bcd1cae43a-01', 'JHN.3.json'), 'utf8')).rejects.toThrow();
  });

  it('throws on an HTTP error and keeps nothing', async () => {
    const api = fakeApi(403);
    await expect(cachedChapter('NASB95', 'JHN', 3, { key: 'k', dir, fetch: api.fetch })).rejects.toThrow(/HTTP 403/);
    await expect(readFile(join(dir, 'b8ee27bcd1cae43a-01', 'JHN.3.json'), 'utf8')).rejects.toThrow();
  });

  it('fetches again when the kept file does not parse, and keeps a whole one', async () => {
    const api = fakeApi();
    const file = join(dir, 'b8ee27bcd1cae43a-01', 'JHN.3.json');
    await mkdir(join(dir, 'b8ee27bcd1cae43a-01'), { recursive: true });
    for (const cut of ['{"fetchedAt":"2026-11-12T00:00:00.000Z","bo', JSON.stringify({ fetchedAt: '2026-11-12T00:00:00.000Z', body: '{"data":{"id":"JH' })]) {
      await writeFile(file, cut);
      expect(await cachedChapter('NASB95', 'JHN', 3, { key: 'k', dir, fetch: api.fetch, now: at(day) })).toMatchObject({ fetched: true, data: { id: 'JHN.3' } });
      expect(JSON.parse(await readFile(file, 'utf8')).body).toBe(api.body);
    }
    expect(api.urls).toHaveLength(2);
  });

  it('fetches again when the kept copy is stamped after now', async () => {
    const api = fakeApi();
    const opts = { key: 'k', dir, fetch: api.fetch };
    await cachedChapter('NASB95', 'JHN', 3, { ...opts, now: at(400 * day) });
    expect(await cachedChapter('NASB95', 'JHN', 3, { ...opts, now: at(0) })).toMatchObject({ fetched: true });
    expect(api.urls).toHaveLength(2);
  });

  it('two reads of one chapter at once both succeed', async () => {
    const api = fakeApi();
    const opts = { key: 'k', dir, fetch: api.fetch, now: at(0) };
    const all = await Promise.all([1, 2, 3].map(() => cachedChapter('NASB95', 'JHN', 3, opts)));
    expect(all.map((r) => r.data.id)).toEqual(['JHN.3', 'JHN.3', 'JHN.3']);
    expect(JSON.parse(await readFile(join(dir, 'b8ee27bcd1cae43a-01', 'JHN.3.json'), 'utf8')).body).toBe(api.body);
  });

  it('refuses a response with no data, and keeps nothing', async () => {
    const fetch = (async () => new Response('{"meta":{}}')) as typeof globalThis.fetch;
    await expect(cachedChapter('NASB95', 'JHN', 3, { key: 'k', dir, fetch })).rejects.toThrow(/no data/);
    await expect(readFile(join(dir, 'b8ee27bcd1cae43a-01', 'JHN.3.json'), 'utf8')).rejects.toThrow();
  });

  it('refuses an edition it has no API.Bible id for', async () => {
    await expect(cachedChapter('KJV', 'JHN', 3, { key: 'k', dir })).rejects.toThrow(/no API.Bible edition/);
  });
});

const kept = async () => (await readdir(join(dir, NASB))).sort();
/** A kept file as the cache writes it, fetched at `t`. */
async function keep(file: string, t: number) {
  await mkdir(join(dir, NASB, 'passages'), { recursive: true });
  await writeFile(join(dir, NASB, file), JSON.stringify({ fetchedAt: at(t)().toISOString(), body: '{"data":{"id":"x","content":[]}}' }));
}

describe('cachedChapter: kept chapters on disk', () => {
  it('keeps every fresh chapter, and leaves books.json and other files alone', async () => {
    const api = fakeApi();
    await keep('books.json', 0);
    await writeFile(join(dir, NASB, 'JHN.1.json.1.x.tmp'), '{"fetchedAt":"');
    for (const c of [1, 2, 3, 4]) await cachedChapter('NASB95', 'JHN', c, { key: 'k', dir, fetch: api.fetch, now: at(c) });
    expect(await kept()).toEqual(['JHN.1.json', 'JHN.1.json.1.x.tmp', 'JHN.2.json', 'JHN.3.json', 'JHN.4.json', 'books.json', 'passages']);
  });

  it('two processes writing chapters at once neither throw nor leave a file cut short', async () => {
    const api = fakeApi();
    const reads = [1, 2, 3, 4, 1, 2, 3, 4].map((c, i) => cachedChapter('NASB95', 'JHN', c, { key: 'k', dir, fetch: api.fetch, now: at(i) }));
    const all = await Promise.all(reads);
    expect(all.map((r) => r.data.id)).toEqual(Array(8).fill('JHN.3'));
    for (const f of await kept()) expect(JSON.parse(await readFile(join(dir, NASB, f), 'utf8')).body).toBe(api.body);
  });
});

describe('cachedChapter: a kept file past its refresh days is deleted', () => {
  it.each([
    ['too old', () => keep('JHN.3.json', 0)],
    ['unreadable', async () => (await keep('JHN.3.json', 0), writeFile(join(dir, NASB, 'JHN.3.json'), '{"fetchedAt'))],
    ['stamped in the future', () => keep('JHN.3.json', 400 * day)],
  ])('deletes a kept chapter that is %s before fetching, so a failed fetch leaves nothing', async (_, setup) => {
    await setup();
    const api = fakeApi(503);
    await expect(cachedChapter('NASB95', 'JHN', 3, { key: 'k', dir, fetch: api.fetch, now: at(31 * day) })).rejects.toThrow(/HTTP 503/);
    expect(await kept()).toEqual(['passages']);
  });

  it('deletes a passage past its refresh days before fetching it again', async () => {
    await keep('passages/JHN.1.1-JHN.4.999.json', 0);
    const api = fakeApi(503);
    await expect(cachedPassage('NASB95', 'JHN.1.1-JHN.4.999', { key: 'k', dir, fetch: api.fetch, now: at(31 * day) })).rejects.toThrow(/HTTP 503/);
    expect(await readdir(join(dir, NASB, 'passages'))).toEqual([]);
  });

  it("writing a chapter deletes the edition's other chapters past their refresh days, and leaves books.json and passages", async () => {
    await keep('JHN.1.json', 0);
    await keep('JHN.2.json', 20 * day);
    await keep('books.json', 0);
    await keep('passages/JHN.1.1-JHN.4.999.json', 0);
    const api = fakeApi();
    await cachedChapter('NASB95', 'JHN', 3, { key: 'k', dir, fetch: api.fetch, now: at(31 * day) });
    expect(await kept()).toEqual(['JHN.2.json', 'JHN.3.json', 'books.json', 'passages']);
    expect(await readdir(join(dir, NASB, 'passages'))).toEqual(['JHN.1.1-JHN.4.999.json']);
  });
});

describe('withPassages: the passages api-bible:facts fetches last only for its run', () => {
  it('deletes the passages once the run succeeds, and leaves books.json and chapters', async () => {
    await keep('passages/JHN.1.1-JHN.4.999.json', 0);
    await keep('books.json', 0);
    await keep('JHN.3.json', 0);
    expect(await withPassages('NASB95', { key: 'k', dir }, async () => 'facts')).toBe('facts');
    expect(await kept()).toEqual(['JHN.3.json', 'books.json']);
  });

  it('leaves the passages when the run fails, so a rerun spends no call on them', async () => {
    await keep('passages/JHN.1.1-JHN.4.999.json', 0);
    await expect(
      withPassages('NASB95', { key: 'k', dir }, async () => {
        throw new Error('stub: HTTP 429');
      }),
    ).rejects.toThrow(/429/);
    expect(await readdir(join(dir, NASB, 'passages'))).toEqual(['JHN.1.1-JHN.4.999.json']);
  });

  it('is not an error when there are no passages', async () => {
    await expect(withPassages('NASB95', { key: 'k', dir }, async () => 1)).resolves.toBe(1);
  });
});

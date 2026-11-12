import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cachedChapter } from './api-bible-cache';

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

  it('throws on an HTTP error and keeps nothing', async () => {
    const api = fakeApi(403);
    await expect(cachedChapter('NASB95', 'JHN', 3, { key: 'k', dir, fetch: api.fetch })).rejects.toThrow(/HTTP 403/);
    await expect(readFile(join(dir, 'b8ee27bcd1cae43a-01', 'JHN.3.json'), 'utf8')).rejects.toThrow();
  });

  it('refuses an edition it has no API.Bible id for', async () => {
    await expect(cachedChapter('KJV', 'JHN', 3, { key: 'k', dir })).rejects.toThrow(/no API.Bible edition/);
  });
});

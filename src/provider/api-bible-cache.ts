/**
 * Fetch API.Bible chapters on this machine and keep each response, unchanged,
 * under `build/api-bible/` (plan step 10). Git ignores `build/`, so licensed
 * text is never committed. A kept response is used for `refreshDays` (30,
 * section 11 of API.Bible's terms), then fetched again. Starter allows 5,000
 * calls a month, so every read goes through here.
 *
 * Node only. The key is `API_BIBLE_KEY` in `.env` (research/api-bible.md).
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { API_BIBLE_EDITIONS, CHAPTER_QUERY, type ApiBibleChapter } from './api-bible';

export const API_BASE = 'https://rest.api.bible/v1';

/** A kept response: when it was fetched, and the body exactly as API.Bible sent it. */
export interface KeptResponse {
  readonly fetchedAt: string;
  readonly body: string;
}

export interface CacheOptions {
  readonly key: string;
  readonly dir: string;
  readonly refreshDays?: number;
  readonly now?: () => Date;
  readonly fetch?: typeof fetch;
}

export interface CachedChapter {
  readonly data: ApiBibleChapter;
  readonly fetchedAt: string;
  /** Whether this read called API.Bible. */
  readonly fetched: boolean;
}

/** One chapter of a licensed edition, from the kept response or a fresh fetch. */
export async function cachedChapter(edition: string, book: string, chapter: number, opts: CacheOptions): Promise<CachedChapter> {
  const bibleId = API_BIBLE_EDITIONS.get(edition)?.bibleId;
  if (!bibleId) throw new Error(`no API.Bible edition "${edition}"`);
  const now = (opts.now ?? (() => new Date()))();
  const file = join(opts.dir, bibleId, `${book}.${chapter}.json`);
  const maxAge = (opts.refreshDays ?? 30) * 86_400_000;

  const kept = await readFile(file, 'utf8').then((s) => JSON.parse(s) as KeptResponse, () => null);
  if (kept && now.getTime() - Date.parse(kept.fetchedAt) < maxAge) {
    return { data: dataOf(kept.body), fetchedAt: kept.fetchedAt, fetched: false };
  }

  const res = await (opts.fetch ?? fetch)(`${API_BASE}/bibles/${bibleId}/chapters/${book}.${chapter}?${CHAPTER_QUERY}`, {
    headers: { 'api-key': opts.key },
  });
  if (!res.ok) throw new Error(`API.Bible ${edition} ${book} ${chapter}: HTTP ${res.status}`);
  const body = await res.text();
  const data = dataOf(body);
  const fresh: KeptResponse = { fetchedAt: now.toISOString(), body };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(fresh));
  await rename(`${file}.tmp`, file);
  return { data, fetchedAt: fresh.fetchedAt, fetched: true };
}

const dataOf = (body: string) => (JSON.parse(body) as { data: ApiBibleChapter }).data;

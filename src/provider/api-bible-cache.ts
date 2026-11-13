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
import type { FetchChapter } from './provider';

const API_BASE = 'https://rest.api.bible/v1';

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

/** An HTTP error from API.Bible, with its status. */
export class ApiBibleHttpError extends Error {
  constructor(
    readonly what: string,
    readonly status: number,
  ) {
    super(`API.Bible ${what}: HTTP ${status}`);
  }
}

const bibleIdOf = (edition: string) => {
  const bibleId = API_BIBLE_EDITIONS.get(edition)?.bibleId;
  if (!bibleId) throw new Error(`no API.Bible edition "${edition}"`);
  return bibleId;
};

/**
 * GET `path` under the edition's Bible, from the kept response when it is
 * younger than `refreshDays`. `file` names the kept copy under the Bible's
 * directory.
 */
async function cachedGet<T>(edition: string, path: string, file: string, opts: CacheOptions): Promise<Cached<T>> {
  const bibleId = bibleIdOf(edition);
  const now = (opts.now ?? (() => new Date()))();
  const kept = join(opts.dir, bibleId, file);
  const maxAge = (opts.refreshDays ?? 30) * 86_400_000;

  const old = await readFile(kept, 'utf8').then((s) => JSON.parse(s) as KeptResponse, () => null);
  if (old && now.getTime() - Date.parse(old.fetchedAt) < maxAge) {
    return { data: dataOf<T>(old.body), fetchedAt: old.fetchedAt, fetched: false };
  }

  const res = await (opts.fetch ?? fetch)(`${API_BASE}/bibles/${bibleId}${path}`, { headers: { 'api-key': opts.key } });
  if (!res.ok) throw new ApiBibleHttpError(`${edition} ${path.split('?')[0]}`, res.status);
  const body = await res.text();
  const data = dataOf<T>(body);
  const fresh: KeptResponse = { fetchedAt: now.toISOString(), body };
  await mkdir(dirname(kept), { recursive: true });
  await writeFile(`${kept}.tmp`, JSON.stringify(fresh));
  await rename(`${kept}.tmp`, kept);
  return { data, fetchedAt: fresh.fetchedAt, fetched: true };
}

export interface Cached<T> {
  readonly data: T;
  readonly fetchedAt: string;
  /** Whether this read called API.Bible. */
  readonly fetched: boolean;
}

export type CachedChapter = Cached<ApiBibleChapter>;

/** One chapter of a licensed edition, from the kept response or a fresh fetch. */
export function cachedChapter(edition: string, book: string, chapter: number, opts: CacheOptions): Promise<CachedChapter> {
  return cachedGet(edition, `/chapters/${book}.${chapter}?${CHAPTER_QUERY}`, `${book}.${chapter}.json`, opts);
}

/**
 * The provider's fetch on Node (provider.ts): each chapter through the kept
 * responses. A 404 is a chapter the edition doesn't print.
 */
export const chapterFetcher =
  (opts: CacheOptions): FetchChapter =>
  async (edition, book, chapter) => {
    try {
      const { data, fetchedAt } = await cachedChapter(edition, book, chapter, opts);
      return { data, fetchedAt };
    } catch (e) {
      if (e instanceof ApiBibleHttpError && e.status === 404) return null;
      throw e;
    }
  };

/**
 * A passage such as `PSA.18.22-PSA.150.999`. API.Bible returns at most 200
 * verses, from the start up to the end, and names the range it returned in
 * `id`. A start past a chapter's end begins at the next chapter.
 */
export function cachedPassage(edition: string, passage: string, opts: CacheOptions): Promise<Cached<ApiBibleChapter>> {
  return cachedGet(edition, `/passages/${passage}?${CHAPTER_QUERY}`, join('passages', `${passage}.json`), opts);
}

/** The edition's books, each with its chapters (`intro` among them). */
export function cachedBooks(edition: string, opts: CacheOptions): Promise<Cached<ApiBibleBook[]>> {
  return cachedGet(edition, '/books?include-chapters=true', 'books.json', opts);
}

export interface ApiBibleBook {
  readonly id: string;
  readonly chapters: readonly { readonly id: string; readonly number: string }[];
}

const dataOf = <T>(body: string) => (JSON.parse(body) as { data: T }).data;

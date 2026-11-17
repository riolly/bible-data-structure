/**
 * Fetch API.Bible chapters on this machine and keep each response, unchanged,
 * under `build/api-bible/` (plan step 10). Git ignores `build/`, so licensed
 * text is never committed. A kept response is used for its edition's
 * `refreshDays` from the rights record (src/contract/rights.ts), then deleted
 * and fetched again. With 0 refresh days no response is kept. Starter allows
 * 5,000 calls a month, so every read goes through here.
 *
 * Writing a chapter deletes the edition's other kept chapters past their
 * refresh days. The passages that `api-bible:facts` fetches are deleted once
 * its run has written the facts file (`withPassages`). `books.json` holds no
 * verse text and is kept with no refresh limit.
 *
 * Deletion touches only `<BOOK>.<chapter>.json` and `passages/*.json` in the
 * edition's own directory, and a file already gone is not an error, so two
 * processes may share the directory. Each write goes through a temp file and
 * a rename, so no reader sees half a file.
 *
 * Node only. The key is `API_BIBLE_KEY` in `.env` (research/api-bible.md).
 */

import { existsSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { LICENSED_EDITIONS, type RightsRecord } from '../contract/rights';
import { CHAPTER_QUERY, type ApiBibleChapter } from './api-bible';
import type { FetchChapter } from './licensed-chapters';

const API_BASE = 'https://rest.api.bible/v1';

/** A kept response: when it was fetched, and the body exactly as API.Bible sent it. */
export interface KeptResponse {
  readonly fetchedAt: string;
  readonly body: string;
}

export interface CacheOptions {
  readonly key: string;
  readonly dir: string;
  readonly now?: () => Date;
  readonly fetch?: typeof fetch;
  /** Milliseconds a call to API.Bible may take before it fails. Default: 30,000. */
  readonly timeoutMs?: number;
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

const apiBibleEdition = (edition: string) => {
  const e = LICENSED_EDITIONS.get(edition);
  if (!e) throw new Error(`no API.Bible edition "${edition}"`);
  return e;
};

/** Whether a copy fetched at `fetchedAt` may still be read at `now`. A copy stamped after now (the clock ran ahead when it was kept) has no known age. */
function fresh(fetchedAt: string, now: Date, rights: RightsRecord): boolean {
  const age = now.getTime() - Date.parse(fetchedAt);
  return age >= 0 && (rights.refreshDays === null || age < rights.refreshDays * 86_400_000);
}

/** Delete `file`. One already gone, deleted by another process, is not an error. */
const remove = (file: string) => unlink(file).catch((e: NodeJS.ErrnoException) => {
  if (e.code !== 'ENOENT') throw e;
});

/**
 * GET `path` under the edition's Bible, from the kept response when it is
 * younger than `rights.refreshDays`. `file` names the kept copy under the
 * Bible's directory. `rights` is the edition's record unless the provider
 * passes its own. With `expires`, a kept copy that can't be read is deleted
 * before the fetch, so a failed fetch leaves no expired text. `afterWrite`
 * runs once a fresh copy is kept.
 */
async function cachedGet<T>(
  edition: string,
  path: string,
  file: string,
  opts: CacheOptions,
  rights: RightsRecord = apiBibleEdition(edition).rights,
  expires = false,
  afterWrite?: (now: Date) => Promise<void>,
): Promise<Cached<T>> {
  const { bibleId } = apiBibleEdition(edition);
  const now = (opts.now ?? (() => new Date()))();
  const kept = join(opts.dir, bibleId, file);

  const keeps = rights.refreshDays !== 0;

  if (keeps) {
    const old = await readKept<T>(kept);
    if (old && fresh(old.fetchedAt, now, rights)) return { data: old.data, fetchedAt: old.fetchedAt, fetched: false };
    if (expires) await remove(kept);
  }

  const what = `${edition} ${path.split('?')[0]}`;
  const res = await (opts.fetch ?? fetch)(`${API_BASE}/bibles/${bibleId}${path}`, {
    headers: { 'api-key': opts.key },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  if (!res.ok) throw new ApiBibleHttpError(what, res.status);
  const body = await res.text();
  const data = dataOf<T>(body);
  if (data === undefined) throw new Error(`API.Bible ${what}: the response has no data`);
  const fetched: KeptResponse = { fetchedAt: now.toISOString(), body };
  if (!keeps) return { data, fetchedAt: fetched.fetchedAt, fetched: true };
  await mkdir(dirname(kept), { recursive: true });
  // a name of its own, so two writers of one chapter don't rename each other's file away
  const tmp = `${kept}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(fetched));
  await rename(tmp, kept);
  await afterWrite?.(now);
  return { data, fetchedAt: fetched.fetchedAt, fetched: true };
}

/** A kept chapter's file name: `JHN.3.json`. Temp files and `books.json` don't match. */
const CHAPTER_FILE = /^[0-9A-Z]{3}\.\d+\.json$/;

/**
 * After `written` was kept at `now`, delete the edition's other kept chapters
 * past their refresh days, stamped after now, or with no `fetchedAt`. It
 * reads only the start of each file, so a whole kept Bible stays cheap to sweep.
 */
async function dropStaleChapters(bibleDir: string, written: string, rights: RightsRecord, now: Date): Promise<void> {
  const names = await readdir(bibleDir).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  });
  for (const name of names) {
    if (name === written || !CHAPTER_FILE.test(name)) continue;
    const file = join(bibleDir, name);
    const fetchedAt = await readFetchedAt(file);
    if (fetchedAt === null || !fresh(fetchedAt, now, rights)) await remove(file);
  }
}

/** `KeptResponse.fetchedAt` from the first bytes of a kept file, which `JSON.stringify` writes first. Null when absent, or the file is gone. */
async function readFetchedAt(file: string): Promise<string | null> {
  const f = await open(file).catch(() => null);
  if (!f) return null;
  try {
    const { buffer, bytesRead } = await f.read({ buffer: Buffer.alloc(64), position: 0 });
    const m = /^\{"fetchedAt":"([^"]+)"/.exec(buffer.toString('utf8', 0, bytesRead));
    return m && !Number.isNaN(Date.parse(m[1])) ? m[1] : null;
  } finally {
    await f.close();
  }
}

/** The kept copy at `file`, or null when there is none or it doesn't parse (a write cut short): the caller fetches again. */
async function readKept<T>(file: string): Promise<{ data: T; fetchedAt: string } | null> {
  try {
    const { fetchedAt, body } = JSON.parse(await readFile(file, 'utf8')) as KeptResponse;
    const data = dataOf<T>(body);
    return data === undefined || Number.isNaN(Date.parse(fetchedAt)) ? null : { data, fetchedAt };
  } catch {
    return null;
  }
}

export interface Cached<T> {
  readonly data: T;
  readonly fetchedAt: string;
  /** Whether this read called API.Bible. */
  readonly fetched: boolean;
}

export type CachedChapter = Cached<ApiBibleChapter>;

/** One chapter of a licensed edition, from the kept response or a fresh fetch. */
export async function cachedChapter(
  edition: string,
  book: string,
  chapter: number,
  opts: CacheOptions,
  rights: RightsRecord = apiBibleEdition(edition).rights,
): Promise<CachedChapter> {
  const file = `${book}.${chapter}.json`;
  const bibleDir = join(opts.dir, apiBibleEdition(edition).bibleId);
  return cachedGet(edition, `/chapters/${book}.${chapter}?${CHAPTER_QUERY}`, file, opts, rights, true, (now) =>
    dropStaleChapters(bibleDir, file, rights, now),
  );
}

/**
 * The provider's fetch on Node (provider.ts): each chapter through the kept
 * responses, kept for the provider's rights record. A 404 is a chapter the
 * edition doesn't print.
 */
export const chapterFetcher =
  (opts: CacheOptions): FetchChapter =>
  async (edition, book, chapter, licensed) => {
    try {
      const { data, fetchedAt } = await cachedChapter(edition, book, chapter, opts, licensed.rights);
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
  return cachedGet(edition, `/passages/${passage}?${CHAPTER_QUERY}`, join('passages', `${passage}.json`), opts, undefined, true);
}

/**
 * Run `run`, which reads the edition's passages, and delete the kept
 * passages once it succeeds. A failed run leaves them, so a rerun resumes
 * without spending calls again.
 */
export async function withPassages<T>(edition: string, opts: CacheOptions, run: () => Promise<T>): Promise<T> {
  const result = await run();
  await rm(join(opts.dir, apiBibleEdition(edition).bibleId, 'passages'), { recursive: true, force: true });
  return result;
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

/** The key for a CLI: `API_BIBLE_KEY` from `.env` or the environment. Exits with code 2 when it is not set. */
export function apiBibleKey(): string {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const key = process.env.API_BIBLE_KEY;
  if (!key) {
    console.error('API_BIBLE_KEY is not set: put it in .env (research/api-bible.md)');
    process.exit(2);
  }
  return key;
}

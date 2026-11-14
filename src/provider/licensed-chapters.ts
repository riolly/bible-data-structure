/**
 * The licensed chapters a provider holds (plan step 10): each chapter of a
 * licensed edition as `readLicensedChapter` derives it, fetched when a read
 * asks for it and fetched again once it is older than the rights record's
 * `refreshDays`. A read of a chapter not held is a promise
 * (`ChapterRead` in src/contract/reader.ts), so the contract awaits it.
 *
 * With 0 refresh days nothing is held: every read fetches, and the chapter
 * goes only to the reads that waited for that fetch.
 *
 * An edition whose rights record has a `keepLimit` never has more verses
 * held than that. Holding a chapter drops the edition's least recently read
 * chapters until it fits, and a read of a dropped chapter fetches it again.
 *
 * Chapter 0, the front matter, and a chapter outside the edition's scheme
 * are never fetched. Reads of one chapter at the same time share one fetch.
 *
 * No Node-only import here: the fetch is injected (`chapterFetcher` in
 * api-bible-cache.ts on Node).
 */

import type { ChapterRead } from '../contract/reader';
import type { LicensedEdition } from '../contract/rights';
import { lastVerse, type Scheme } from '../model/scheme';
import { readLicensedChapter, type ApiBibleChapter, type ReadChapter } from './api-bible';

/**
 * One chapter as fetched, with when it was fetched, or null when the edition
 * doesn't print it. `licensed` is the edition's record: a fetch that keeps
 * copies keeps them for its rights record's `refreshDays` and under its
 * `keepLimit`, as the provider does, counting verses with `keptVerses` over `scheme`, the edition's scheme.
 * A fetch that hasn't settled after `fetchTimeoutMs` fails the reads that wait for it.
 */
export type FetchChapter = (
  edition: string,
  book: string,
  chapter: number,
  licensed: LicensedEdition,
  scheme: Scheme,
) => Promise<{ readonly data: ApiBibleChapter; readonly fetchedAt: string } | null>;

/** What a keep limit counts for a printed chapter: the verses the edition's scheme gives it. */
export const keptVerses = (scheme: Scheme, book: string, chapter: number): number => lastVerse(scheme, book, chapter) ?? 0;

export interface LicensedChaptersOptions {
  readonly editions: ReadonlyMap<string, LicensedEdition>;
  readonly fetchChapter: FetchChapter;
  /** The edition's scheme. */
  readonly schemeOf: (edition: string) => Scheme;
  /** Milliseconds since the epoch. */
  readonly now: () => number;
  /** Milliseconds a fetch may take before the reads waiting for it fail. Default: 60,000. */
  readonly fetchTimeoutMs?: number;
}

export interface LicensedChapters {
  /** The chapter, or a promise when it isn't held or is past its refresh days. Null when the edition doesn't print it. */
  chapter(edition: string, book: string, chapter: number): ChapterRead<ReadChapter>;
  /** The markers outside the supported list in each held chapter that has any, keyed `NLT NUM 1`. A chapter dropped for a keep limit is not in it. */
  unsupported(): ReadonlyMap<string, Readonly<Record<string, number>>>;
}

interface Held {
  /** Null when the edition doesn't print the chapter. */
  readonly read: ReadChapter | null;
  readonly fetchedAt: number;
  readonly edition: string;
  /** What a keep limit counts: the verses the edition's scheme gives the chapter, or 0 when the edition doesn't print it. */
  readonly verses: number;
}

export function licensedChapters(opts: LicensedChaptersOptions): LicensedChapters {
  const held = new Map<string, Held>();
  const pending = new Map<string, Promise<ReadChapter | null>>();

  /** A copy fetched after now (the clock ran ahead when it was fetched) has no known age, so it isn't fresh. */
  const fresh = (e: LicensedEdition, fetchedAt: number) => {
    const age = opts.now() - fetchedAt;
    return age >= 0 && (e.rights.refreshDays === null || age < e.rights.refreshDays * 86_400_000);
  };
  const timeoutMs = opts.fetchTimeoutMs ?? 60_000;
  /** Whether the edition's chapters are held at all (`RightsRecord.refreshDays`). */
  const keeps = (e: LicensedEdition) => e.rights.refreshDays !== 0;

  /**
   * Hold a chapter as the most recently read. Under a keep limit, the
   * edition's least recently read chapters are dropped until its held verses
   * fit, and a chapter with more verses than the limit is not held.
   */
  function hold(key: string, e: LicensedEdition, h: Held): void {
    held.delete(key);
    const limit = e.rights.keepLimit;
    if (limit !== null) {
      if (h.verses > limit) return;
      let total = h.verses;
      for (const other of held.values()) if (other.edition === h.edition) total += other.verses;
      // a Map lists its keys in the order they were set: the least recently read first
      for (const [k, other] of held) {
        if (total <= limit) break;
        if (other.edition !== h.edition) continue;
        held.delete(k);
        total -= other.verses;
      }
    }
    held.set(key, h);
  }

  /** Fetch one chapter, once however many reads ask for it at the same time. */
  function fetchOne(key: string, id: string, e: LicensedEdition, book: string, chapter: number): Promise<ReadChapter | null> {
    const waiting = pending.get(key);
    if (waiting) return waiting;
    let timedOut = false;
    const work = (async () => {
      const got = await opts.fetchChapter(id, book, chapter, e, opts.schemeOf(id));
      const read = got ? await readLicensedChapter(id, e, opts.schemeOf(id), book, chapter, got.data) : null;
      // a copy stamped after now (the fetch's clock is ahead of ours) counts as fetched now
      const fetchedAt = got ? Math.min(Date.parse(got.fetchedAt), opts.now()) : opts.now();
      // an answer after the timeout is not held: a later read may hold a newer copy by now
      if (!keeps(e) || timedOut) return read;
      if (got && !fresh(e, fetchedAt)) {
        throw new Error(`${key} is still missing after its fetch: the fetch gave a copy from ${got.fetchedAt}, older than ${e.rights.refreshDays} days`);
      }
      // a refresh replaces the held chapter here: a changed stamp (held.get(key)?.read?.stamp) would be reported here
      hold(key, e, { read, fetchedAt, edition: id, verses: read ? keptVerses(opts.schemeOf(id), book, chapter) : 0 });
      return read;
    })();
    // a fetch that never settles must not block the chapter: after the timeout the next read fetches again
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`${key}: the fetch gave no answer in ${timeoutMs} ms`));
      }, timeoutMs);
    });
    const p: Promise<ReadChapter | null> = Promise.race([work, timeout]).finally(() => {
      clearTimeout(timer);
      if (pending.get(key) === p) pending.delete(key);
    });
    pending.set(key, p);
    return p;
  }

  return {
    chapter(id, book, chapter) {
      const e = opts.editions.get(id);
      if (!e) throw new Error(`${id} is not a licensed edition`);
      if (chapter < 1 || lastVerse(opts.schemeOf(id), book, chapter) === undefined) return null;
      const key = `${id} ${book} ${chapter}`;
      const h = held.get(key);
      if (h && fresh(e, h.fetchedAt)) {
        // a read makes the chapter the most recently read
        held.delete(key);
        held.set(key, h);
        return h.read;
      }
      return fetchOne(key, id, e, book, chapter);
    },
    unsupported: () =>
      new Map(
        [...held].flatMap(([key, h]) => (h.read && Object.keys(h.read.unsupported).length > 0 ? [[key, h.read.unsupported] as const] : [])),
      ),
  };
}

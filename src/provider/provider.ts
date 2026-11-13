/**
 * The provider (plan step 10): one app contract (contract.ts) over local
 * editions read from a DB, the corpus or a pack, and licensed editions
 * fetched a chapter at a time. The DB also gives the schemes, the mappings
 * and the hub's original words, so `map` and `words` work across both.
 *
 * A licensed chapter is held in memory as `readLicensedChapter` derives it:
 * its document, its verse units and its chapter stamp. A licensed edition has
 * no edition, words or text stamp (ADR-0005, 2026-11-11 amendment), no
 * original words and no alignment rows.
 *
 * Each call runs the contract's sync reads. A read of a licensed chapter the
 * provider doesn't hold, in a chapter the edition's scheme has, records a
 * miss and reads as empty. The provider fetches the misses and runs the call
 * again until there are none, so it never has to predict which chapters
 * `map`, `passage` or `resolve` touch. A held chapter older than the rights
 * record's `refreshDays` is a miss again.
 *
 * No Node-only import here: the fetch is injected (`chapterFetcher` in
 * api-bible-cache.ts on Node).
 */

import type { BibleContract } from '../contract/contract';
import { readerContract } from '../contract/corpus-contract';
import { dbReader, type CorpusReader } from '../contract/reader';
import { LICENSED_EDITIONS, type LicensedEdition } from '../contract/rights';
import type { SyncSqliteDb } from '../db/corpus-read';
import type { Mappings } from '../model/mapping';
import { lastVerse, type Scheme } from '../model/scheme';
import { readLicensedChapter, type ApiBibleChapter, type ReadChapter } from './api-bible';

export type { LicensedEdition } from '../contract/rights';

/**
 * One chapter as fetched, with when it was fetched, or null when the edition
 * doesn't print it. `licensed` is the edition's record: a fetch that keeps
 * copies keeps them for its rights record's `refreshDays`, as the provider does.
 */
export type FetchChapter = (
  edition: string,
  book: string,
  chapter: number,
  licensed: LicensedEdition,
) => Promise<{ readonly data: ApiBibleChapter; readonly fetchedAt: string } | null>;

export interface ProviderOptions {
  /** The corpus DB or a pack: the local editions, the schemes and the mappings. */
  readonly db: SyncSqliteDb;
  readonly fetchChapter: FetchChapter;
  /** Default: `LICENSED_EDITIONS`. */
  readonly editions?: ReadonlyMap<string, LicensedEdition>;
  /** Milliseconds since the epoch. Default: `Date.now`. */
  readonly now?: () => number;
}

export interface Provider extends BibleContract {
  /**
   * The markers outside the supported list in each held chapter that has
   * any, keyed `NLT NUM 1`, with how many times each occurred (`AdaptedChapter.unsupported`).
   * Their text is kept, so the chapter still reads.
   */
  unsupported(): ReadonlyMap<string, Readonly<Record<string, number>>>;
}

interface Held {
  /** Null when the edition doesn't print the chapter. */
  readonly read: ReadChapter | null;
  readonly fetchedAt: number;
}

type Miss = readonly [edition: string, book: string, chapter: number];

export function provider(opts: ProviderOptions): Provider {
  const editions = opts.editions ?? LICENSED_EDITIONS;
  const now = opts.now ?? Date.now;
  const db = dbReader(opts.db);
  let schemes: Map<string, Scheme> | undefined;
  let mappings: Mappings | undefined;
  const held = new Map<string, Held>();
  // written only while a call's sync reads run, see `run`
  let misses = new Map<string, Miss>();

  function schemeOf(id: string): Scheme {
    const name = editions.get(id)!.scheme;
    const s = (schemes ??= db.schemes()).get(name);
    if (!s) throw new Error(`${id}: the DB has no scheme "${name}"`);
    return s;
  }

  function chapterOf(id: string, book: string, chapter: number): ReadChapter | null {
    const key = `${id} ${book} ${chapter}`;
    const h = held.get(key);
    const days = editions.get(id)!.rights.refreshDays;
    if (h && (days === null || now() - h.fetchedAt < days * 86_400_000)) return h.read;
    // chapter 0, the front matter, is never fetched
    if (chapter >= 1 && lastVerse(schemeOf(id), book, chapter) !== undefined) misses.set(key, [id, book, chapter]);
    return null;
  }

  const licensed = (id: string) => editions.has(id);
  const reader: CorpusReader = {
    edition(id) {
      if (!licensed(id)) return db.edition(id);
      return { abbrev: id, scheme: schemeOf(id).id, edition: null, wordsStamp: null, textStamp: null };
    },
    chapter(id, book, chapter) {
      if (!licensed(id)) return db.chapter(id, book, chapter);
      const r = chapterOf(id, book, chapter);
      return r && { stamp: r.stamp, verses: r.verses };
    },
    chapterDoc: (id, book, chapter) => (licensed(id) ? (chapterOf(id, book, chapter)?.doc ?? null) : db.chapterDoc(id, book, chapter)),
    originalWords: (id, ...at) => (licensed(id) ? [] : db.originalWords(id, ...at)),
    wordAlignments: (id, ...at) => (licensed(id) ? [] : db.wordAlignments(id, ...at)),
    dataSources: () => db.dataSources(),
    schemes: () => (schemes ??= db.schemes()),
    mappings: (s) => (mappings ??= db.mappings(s)),
  };

  let inner = readerContract(reader);
  const pending = new Map<string, Promise<void>>();

  /** Fetch one chapter, once however many calls miss it at the same time. */
  function fetchOne(key: string, [id, book, chapter]: Miss): Promise<void> {
    let p = pending.get(key);
    if (p) return p;
    p = (async () => {
      const e = editions.get(id)!;
      const got = await opts.fetchChapter(id, book, chapter, e);
      const read = got ? await readLicensedChapter(id, e, schemeOf(id), book, chapter, got.data) : null;
      held.set(key, { read, fetchedAt: got ? Date.parse(got.fetchedAt) : now() });
    })().finally(() => pending.delete(key));
    pending.set(key, p);
    return p;
  }

  /** Run one call until it misses no chapter. */
  async function run<T>(call: (c: BibleContract) => Promise<T>): Promise<T> {
    const fetched = new Set<string>();
    for (;;) {
      misses = new Map();
      // the contract does all its reads before it returns its promise, so these misses are this call's
      const result = call(inner);
      const mine = misses;
      misses = new Map();
      if (mine.size === 0) return result;
      // a run with misses read empty chapters: its result or error is dropped
      result.catch(() => {});
      for (const key of mine.keys()) {
        if (fetched.has(key)) throw new Error(`${key} is still missing after its fetch`);
        fetched.add(key);
      }
      await Promise.all([...mine].map(([key, miss]) => fetchOne(key, miss)));
      // a new contract drops its cached chapter stamps, which a refreshed chapter may change
      inner = readerContract(reader);
    }
  }

  return {
    chapter: (...a) => run((c) => c.chapter(...a)),
    passage: (...a) => run((c) => c.passage(...a)),
    verseText: (...a) => run((c) => c.verseText(...a)),
    map: (...a) => run((c) => c.map(...a)),
    resolve: (...a) => run((c) => c.resolve(...a)),
    words: (...a) => run((c) => c.words(...a)),
    rights: async (id) => editions.get(id)?.rights ?? inner.rights(id),
    credits: () => inner.credits(),
    unsupported: () =>
      new Map(
        [...held].flatMap(([key, h]) => (h.read && Object.keys(h.read.unsupported).length > 0 ? [[key, h.read.unsupported] as const] : [])),
      ),
  };
}

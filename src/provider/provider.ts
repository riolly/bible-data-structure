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
 * licensed-chapters.ts holds the licensed chapters, and fetches one when a
 * call reads it and the provider doesn't hold it, or holds it past the rights
 * record's `refreshDays`. The contract awaits that read, so a call returns
 * once its chapters are held or a fetch has failed.
 *
 * No Node-only import here: the fetch is injected (`chapterFetcher` in
 * api-bible-cache.ts on Node).
 */

import type { BibleContract } from '../contract/contract';
import { readerContract } from '../contract/corpus-contract';
import type { CorpusReader, EditionRow } from '../contract/reader';
import { LICENSED_EDITIONS, type LicensedEdition } from '../contract/rights';
import type { Mappings } from '../model/mapping';
import type { Scheme } from '../model/scheme';
import type { ReadChapter } from './api-bible';
import { licensedChapters, type FetchChapter } from './licensed-chapters';

export type { LicensedEdition } from '../contract/rights';
export type { FetchChapter } from './licensed-chapters';

export interface ProviderOptions {
  /**
   * The reader over the corpus DB (`dbReader`) or a pack (`packReader` in
   * src/pack/format.ts): the local editions, the schemes and the mappings.
   */
  readonly local: CorpusReader;
  readonly fetchChapter: FetchChapter;
  /** Default: `LICENSED_EDITIONS`. */
  readonly editions?: ReadonlyMap<string, LicensedEdition>;
  /** Milliseconds since the epoch. Default: `Date.now`. */
  readonly now?: () => number;
  /** Milliseconds a fetch may take before the calls waiting for it fail. Default: 60,000. */
  readonly fetchTimeoutMs?: number;
}

export interface Provider extends BibleContract {
  /**
   * The markers outside the supported list in each held chapter that has
   * any, keyed `NLT NUM 1`, with how many times each occurred (`AdaptedChapter.unsupported`).
   * Their text is kept, so the chapter still reads.
   */
  unsupported(): ReadonlyMap<string, Readonly<Record<string, number>>>;
}

/** `f` of a chapter read, waiting only when the read waits. */
const thenRead = <T, U>(r: T | null | Promise<T | null>, f: (x: T) => U): U | null | Promise<U | null> =>
  r instanceof Promise ? r.then((x) => x && f(x)) : r && f(r);

export function provider(opts: ProviderOptions): Provider {
  const editions = opts.editions ?? LICENSED_EDITIONS;
  const local = opts.local;
  let schemes: Map<string, Scheme> | undefined;
  let mappings: Mappings | undefined;

  function schemeOf(id: string): Scheme {
    const name = editions.get(id)!.scheme;
    const s = (schemes ??= local.schemes()).get(name);
    if (!s) throw new Error(`${id}: the DB has no scheme "${name}"`);
    return s;
  }

  const held = licensedChapters({
    editions,
    fetchChapter: opts.fetchChapter,
    schemeOf,
    now: opts.now ?? Date.now,
    fetchTimeoutMs: opts.fetchTimeoutMs,
  });
  const licensed = (id: string) => editions.has(id);
  /** A licensed edition has no edition, words or text stamp (ADR-0005, 2026-11-11 amendment). */
  const licensedRow = (id: string, e: LicensedEdition): EditionRow => ({
    abbrev: id,
    name: e.name,
    language: e.language,
    scheme: schemeOf(id).id,
    edition: null,
    wordsStamp: null,
    textStamp: null,
  });
  const reader: CorpusReader = {
    edition(id) {
      const e = editions.get(id);
      return e ? licensedRow(id, e) : local.edition(id);
    },
    editions: () => [...local.editions(), ...[...editions].map(([id, e]) => licensedRow(id, e))],
    // a licensed edition's books and chapter counts are its scheme's: nothing is fetched to list them
    books: (id) => (licensed(id) ? new Map([...schemeOf(id).verseCounts].map(([book, counts]) => [book, counts.length])) : local.books(id)),
    bookList: () => local.bookList(),
    chapter: (id, book, chapter) => (licensed(id) ? held.chapter(id, book, chapter) : local.chapter(id, book, chapter)),
    chapterDoc: (id, book, chapter) =>
      licensed(id) ? thenRead(held.chapter(id, book, chapter), (r: ReadChapter) => ({ ...r.doc, stamp: r.stamp })) : local.chapterDoc(id, book, chapter),
    originalWords: (id, ...at) => (licensed(id) ? [] : local.originalWords(id, ...at)),
    wordAlignments: (id, ...at) => (licensed(id) ? [] : local.wordAlignments(id, ...at)),
    dataSources: () => local.dataSources(),
    schemes: () => (schemes ??= local.schemes()),
    mappings: (s) => (mappings ??= local.mappings(s)),
  };
  const contract = readerContract(reader);

  return {
    ...contract,
    rights: async (id) => editions.get(id)?.rights ?? contract.rights(id),
    unsupported: () => held.unsupported(),
  };
}

/**
 * What an app imports: the contract and its result types, the readers that
 * implement it over a pack or the corpus DB, the provider for licensed
 * editions, the rights records and the address parser.
 *
 * Nothing reachable from here imports a Node module (index.test.ts), so it
 * bundles for a browser, React Native, Bun or Node. The app brings a sync
 * drizzle SQLite driver. `chapterFetcher`, the Node fetch with its disk
 * cache, is in the Node entry (src/node.ts). `openPack` and `buildPack`
 * (src/pack/pack.ts, better-sqlite3) stay in this repo: an app opens its
 * pack with its own driver.
 */

export * from './contract/contract';
export { corpusContract, readerContract } from './contract/corpus-contract';
export {
  dbReader,
  type AlignedOriginal,
  type ChapterRead,
  type ChapterUnits,
  type CorpusReader,
  type EditionRow,
  type ListedBook,
} from './contract/reader';
export { LICENSED_EDITIONS, RIGHTS, type AiUse, type ApiBibleEdition, type LicensedEdition, type Offline, type Route } from './contract/rights';
export type { SyncSqliteDb } from './db/corpus-read';
/** The corpus tables, for the app's drizzle handle: `drizzle({ client, schema })`. */
export * as schema from './db/corpus-schema';
/** A verse text's words in word-index order, to match a tapped word to its `Word` (ADR-0004). */
export { verseWords } from './ingest/tokenize';
export { formatAddress, parseAddress, type Address, type VerseRef } from './model/address';
export type { OriginalWordKind, UsjBook, UsjChapter, UsjChar, UsjElement, UsjNode, UsjNote, UsjPara, UsjVerse } from './model/corpus';
export { packContract, packReader } from './pack/format';
export type { ApiBibleChapter } from './provider/api-bible';
export { provider, type FetchChapter, type Provider, type ProviderOptions } from './provider/provider';

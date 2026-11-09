import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { BlockRole } from '../model/corpus';

/**
 * Corpus DB schema (read-only, bundled asset — old-repo ADR-0009, schema.dbml). Shared
 * by BOTH sides of the Drizzle seam:
 *   - the build-time ingest writer (scripts/ingest, better-sqlite3 driver)
 *   - the app reader (expo-sqlite driver, opened from the bundled asset)
 *
 * Integer pks here are STORAGE ids only — regenerated wholesale on every
 * re-ingest. Outside references use addresses (src/model/address.ts): scheme +
 * USFM book code + chapter + verse + word index, never these ids (ADR-0002).
 */

export const translation = sqliteTable('translation', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  abbrev: text('abbrev').notNull().unique(),
  language: text('language').notNull(),
  year: integer('year'),
  license: text('license'),
  /** e.g. "av11n"; ties to versification_map. */
  versification: text('versification').notNull(),
  /**
   * TEXT EDITION stamp (ADR-0005): deterministic identifier of the source text
   * this ingest was built from (sha256 over the source USFM). Markup rows
   * record the edition they were minted against; an edition change triggers
   * the consent-gated quote-witness reconciliation pass.
   */
  edition: text('edition').notNull(),
});

/**
 * A book of scripture, keyed by its USFM code (ADR-0002). Names live in
 * `book_name`, order and grouping in the canon tables.
 */
export const book = sqliteTable('book', {
  code: text('code').primaryKey(),
  /** The USFM spec's book number (`01`, `A4`). A file sort key, not an id. */
  usfmNumber: text('usfm_number').notNull(),
});

/** One tradition's list of books (ADR-0002 "Canon shape"). */
export const canon = sqliteTable('canon', {
  id: text('id').primaryKey(),
  tradition: text('tradition').notNull(),
  sourceUrl: text('source_url').notNull(),
  note: text('note').notNull(),
});

/** A group inside a canon. Sections form a tree through `parent_section_id`. */
export const canonSection = sqliteTable(
  'canon_section',
  {
    canonId: text('canon_id')
      .notNull()
      .references(() => canon.id),
    sectionId: text('section_id').notNull(),
    parentSectionId: text('parent_section_id'),
    ordinal: integer('ordinal').notNull(),
    labelKey: text('label_key').notNull(),
  },
  (t) => [primaryKey({ columns: [t.canonId, t.sectionId] })],
);

/** One counted item in a canon, in canon order. Holds one or more books. */
export const canonEntry = sqliteTable(
  'canon_entry',
  {
    canonId: text('canon_id')
      .notNull()
      .references(() => canon.id),
    entryId: text('entry_id').notNull(),
    sectionId: text('section_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    status: text('status', { enum: ['canonical', 'readable', 'appendix'] }).notNull(),
    /** NULL: label the entry with its only book's name. */
    labelKey: text('label_key'),
  },
  (t) => [primaryKey({ columns: [t.canonId, t.entryId] })],
);

export const canonEntryBook = sqliteTable(
  'canon_entry_book',
  {
    canonId: text('canon_id').notNull(),
    entryId: text('entry_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    bookCode: text('book_code')
      .notNull()
      .references(() => book.code),
  },
  (t) => [primaryKey({ columns: [t.canonId, t.entryId, t.ordinal] })],
);

/** A book's names in one language. `canon_id` NULL is the default; a canon row overrides it. */
export const bookName = sqliteTable('book_name', {
  bookCode: text('book_code')
    .notNull()
    .references(() => book.code),
  lang: text('lang').notNull(),
  canonId: text('canon_id').references(() => canon.id),
  long: text('long').notNull(),
  short: text('short').notNull(),
  abbr: text('abbr'),
  source: text('source').notNull(),
});

export const block = sqliteTable(
  'block',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    translationId: integer('translation_id')
      .notNull()
      .references(() => translation.id),
    book: text('book')
      .notNull()
      .references(() => book.code),
    chapter: integer('chapter').notNull(),
    /** Typesetting branch. */
    genre: text('genre', { enum: ['prose', 'poetry', 'heading'] }).notNull(),
    /** REGISTERED role vocabulary — see model/corpus.ts BlockRole. */
    role: text('role').$type<BlockRole>(),
    /** Poetry line depth (\q1–\q4); 0 for prose/heading. */
    indent: integer('indent').notNull().default(0),
    /** Render order within the chapter (= seq of its first token). */
    seq: integer('seq').notNull(),
  },
  (t) => [index('block_order').on(t.translationId, t.book, t.seq)],
);

export const token = sqliteTable(
  'token',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    translationId: integer('translation_id')
      .notNull()
      .references(() => translation.id),
    book: text('book')
      .notNull()
      .references(() => book.code),
    chapter: integer('chapter').notNull(),
    /**
     * Canonical verse (av11n); NULL = non-verse content. EVERY heading token
     * (incl. mid-chapter \s) carries NULL — never 0, never the preceding verse.
     */
    verse: integer('verse'),
    /**
     * Word ordinal within verse, punct excluded; NULL on punct tokens and on
     * heading/non-verse word tokens.
     */
    wordIndex: integer('word_index'),
    /** Dense render order within chapter. */
    seq: integer('seq').notNull(),
    kind: text('kind', { enum: ['word', 'punct'] }).notNull(),
    text: text('text').notNull(),
    blockId: integer('block_id')
      .notNull()
      .references(() => block.id),
    /** First word token of a verse — drives the verse-number ornament. */
    verseStart: integer('verse_start', { mode: 'boolean' }).notNull().default(false),
    /** SEAM P3: head Original Word string key — null until aligned. */
    owId: text('ow_id'),
  },
  (t) => [
    index('token_render').on(t.translationId, t.book, t.chapter, t.verse, t.seq),
    index('token_anchor').on(t.translationId, t.book, t.chapter, t.verse, t.wordIndex),
  ],
);

/**
 * Sparse native↔canonical reconciliation: a row exists ONLY where a
 * translation's native numbering differs from canonical. Populated in #12.
 */
export const versificationMap = sqliteTable(
  'versification_map',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    translationId: integer('translation_id')
      .notNull()
      .references(() => translation.id),
    book: text('book')
      .notNull()
      .references(() => book.code),
    srcChapter: integer('src_chapter').notNull(),
    srcVerse: integer('src_verse').notNull(),
    canonChapter: integer('canon_chapter').notNull(),
    canonVerse: integer('canon_verse').notNull(),
  },
  (t) => [index('vmap_src').on(t.translationId, t.book, t.srcChapter, t.srcVerse)],
);

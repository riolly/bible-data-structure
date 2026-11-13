import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Corpus DB schema (old-repo ADR-0009). Shared by the ingest writer
 * (src/ingest/write-db.ts, edition-writer.ts) and the reader (corpus-read.ts).
 *
 * Integer pks here are STORAGE ids only — regenerated wholesale on every
 * re-ingest. Outside references use addresses (src/model/address.ts): scheme +
 * USFM book code + chapter + verse + word index, never these ids (ADR-0002).
 */

/** A versification scheme from the registry (src/ingest/schemes.ts). */
export const scheme = sqliteTable('scheme', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sourceUrl: text('source_url').notNull(),
  note: text('note').notNull(),
});

/** A scheme's definition: the last verse of each chapter of each book. */
export const schemeVerseCount = sqliteTable(
  'scheme_verse_count',
  {
    scheme: text('scheme')
      .notNull()
      .references(() => scheme.id),
    book: text('book')
      .notNull()
      .references(() => book.code),
    chapter: integer('chapter').notNull(),
    verseCount: integer('verse_count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scheme, t.book, t.chapter] })],
);

/** A verse inside a chapter's count that the scheme leaves out (`.vrs` `-` lines). */
export const schemeExcludedVerse = sqliteTable(
  'scheme_excluded_verse',
  {
    scheme: text('scheme')
      .notNull()
      .references(() => scheme.id),
    book: text('book')
      .notNull()
      .references(() => book.code),
    chapter: integer('chapter').notNull(),
    verse: integer('verse').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scheme, t.book, t.chapter, t.verse] })],
);

export const translation = sqliteTable('translation', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  abbrev: text('abbrev').notNull().unique(),
  language: text('language').notNull(),
  year: integer('year'),
  license: text('license'),
  /** The edition's native versification scheme (ADR-0002). Its verse addresses use it. */
  scheme: text('scheme')
    .notNull()
    .references(() => scheme.id),
  /**
   * TEXT EDITION stamp (ADR-0005): deterministic identifier of the source text
   * this ingest was built from (sha256 over the source USFM). Markup rows
   * record the edition they were minted against; an edition change triggers
   * the consent-gated quote-witness reconciliation pass.
   */
  edition: text('edition').notNull(),
  /**
   * WORDS stamp (ADR-0005 amendment): sha256 over every word address and the
   * word stored there. It changes when a text fix, the tokenizer or the parser
   * changes stored words, which the edition stamp can't see. Set after the
   * edition's books are written.
   */
  wordsStamp: text('words_stamp'),
  /**
   * TEXT stamp (ADR-0005 amendment, 2026-11-11): sha256 over the edition's
   * chapter stamps. It changes when any stored document or verse text does,
   * punctuation and notes included. Set after the edition's books are written.
   */
  textStamp: text('text_stamp'),
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
  /** A data_source id. */
  source: text('source')
    .notNull()
    .references(() => dataSource.id),
});

/**
 * The stored truth of an edition's text: one chapter's USJ nodes, from its
 * `\c` up to the next, as JSON (ADR-0001 amendment, plan step 7). Chapter 0
 * is the front matter. Blocks, tokens and verse text are derived from it.
 */
export const chapterDoc = sqliteTable(
  'chapter_doc',
  {
    translationId: integer('translation_id')
      .notNull()
      .references(() => translation.id),
    book: text('book')
      .notNull()
      .references(() => book.code),
    chapter: integer('chapter').notNull(),
    /**
     * JSON array of the chapter's USJ nodes, with word attributes dropped
     * (ADR-0001 amendment). A pack stores it deflated, as a BLOB (src/pack/format.ts).
     */
    usj: text('usj').notNull(),
    /**
     * The chapter stamp (ADR-0005 amendment, 2026-11-11): sha256 over `usj`
     * and the chapter's verse text. A caller stores it beside a quote.
     */
    stamp: text('stamp').notNull(),
  },
  (t) => [primaryKey({ columns: [t.translationId, t.book, t.chapter] })],
);

/**
 * One verse unit and its surface text, derived from `chapter_doc`: notes left
 * out, whitespace runs made one space. Empty when the marker is printed with
 * no words; no row when the edition skips the verse. A bridge (`\v 20-21`) is
 * one row whose every number from `verse` to `last_verse` resolves to it
 * (ADR-0004 v1.5).
 */
export const verseText = sqliteTable(
  'verse_text',
  {
    translationId: integer('translation_id')
      .notNull()
      .references(() => translation.id),
    book: text('book')
      .notNull()
      .references(() => book.code),
    chapter: integer('chapter').notNull(),
    /** The first verse: the number the unit's tokens carry. */
    verse: integer('verse').notNull(),
    /** The last verse: above `verse` for a bridge, equal to it otherwise. */
    lastVerse: integer('last_verse').notNull(),
    segment: text('segment').notNull().default(''),
    text: text('text').notNull(),
  },
  (t) => [primaryKey({ columns: [t.translationId, t.book, t.chapter, t.verse, t.segment] })],
);

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
    /** Typesetting branch, derived from the marker. */
    genre: text('genre', { enum: ['prose', 'poetry', 'heading'] }).notNull(),
    /** The paragraph's USFM marker with its level (`p`, `q2`, `pi2`, `s2`), as the source wrote it. */
    marker: text('marker').notNull(),
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
     * Verse number under the translation's scheme; NULL = non-verse content. A heading token
     * (incl. mid-chapter \s) carries NULL, never the preceding verse. 0 is a Psalm title the
     * scheme numbers as verse 0 (ADR-0001 amendment).
     */
    verse: integer('verse'),
    /** The verse's lettered part (`1KI 2:35a` in Brenton), `''` when the source letters none. */
    segment: text('segment').notNull().default(''),
    /**
     * Word ordinal within the verse segment, punct excluded; NULL on punct tokens and on
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
    // A word address names one word (NULL word indexes are distinct in SQLite).
    uniqueIndex('token_anchor').on(t.translationId, t.book, t.chapter, t.verse, t.segment, t.wordIndex),
  ],
);

/**
 * A qere: another reading of a range of written words, beside the token stream
 * so it never moves a word address (ADR-0007). The range is
 * [word_index, word_index + word_count) of one verse segment. `word_count` 0
 * is read before word `word_index`; empty `text` is a written word not read.
 */
export const reading = sqliteTable(
  'reading',
  {
    translationId: integer('translation_id')
      .notNull()
      .references(() => translation.id),
    book: text('book')
      .notNull()
      .references(() => book.code),
    chapter: integer('chapter').notNull(),
    verse: integer('verse').notNull(),
    segment: text('segment').notNull().default(''),
    wordIndex: integer('word_index').notNull(),
    wordCount: integer('word_count').notNull(),
    kind: text('kind', { enum: ['qere'] }).notNull(),
    /** The reading's own text, pointed, NFC. */
    text: text('text').notNull(),
    /** The source's ids of the reading's words, space-separated, in order: what an alignment points at (ADR-0003). */
    owIds: text('ow_ids').notNull(),
    /** A data_source id: whose ids `ow_ids` are. */
    source: text('source')
      .notNull()
      .references(() => dataSource.id),
  },
  (t) => [primaryKey({ columns: [t.translationId, t.book, t.chapter, t.verse, t.segment, t.wordIndex, t.wordCount] })],
);

/**
 * One word of an original-language edition, WLC or SBLGNT, with its lexical
 * data (ADR-0003 and its step 11 amendment, `OriginalWord` in
 * src/model/corpus.ts). A written word is the token at `word_index`; a qere has
 * none. `seq` is read order within the verse.
 */
export const originalWord = sqliteTable(
  'original_word',
  {
    /** A data_source id: whose id `ow_id` is (`oshb`, `macula-greek`). */
    source: text('source')
      .notNull()
      .references(() => dataSource.id),
    /** The source's id for the word: what an alignment and `reading.ow_ids` point at. */
    owId: text('ow_id').notNull(),
    translationId: integer('translation_id')
      .notNull()
      .references(() => translation.id),
    book: text('book')
      .notNull()
      .references(() => book.code),
    chapter: integer('chapter').notNull(),
    verse: integer('verse').notNull(),
    segment: text('segment').notNull().default(''),
    seq: integer('seq').notNull(),
    wordIndex: integer('word_index'),
    kind: text('kind', { enum: ['word', 'ketiv', 'qere'] }).notNull(),
    text: text('text').notNull(),
    lemma: text('lemma').notNull(),
    /** Space-separated Strong's numbers (`H1961`, `G5228 G1537 G4053`), `''` when none: join keys, never addresses. */
    strongs: text('strongs').notNull(),
    morph: text('morph').notNull(),
    gloss: text('gloss'),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.owId] }),
    uniqueIndex('original_word_verse').on(t.translationId, t.book, t.chapter, t.verse, t.segment, t.seq),
  ],
);

/**
 * One original word an edition's word translates (ADR-0003 and its step 12
 * amendment): the word's address, the original word's id, and the Strong's
 * numbers of the parts the word aligns to. `seq` orders one word's rows.
 * Built for the BSB from Clear Bible's alignments, and for the KJV from its own
 * checked `\w` tags (`aligned_by`).
 */
export const wordAlignment = sqliteTable(
  'word_alignment',
  {
    translationId: integer('translation_id')
      .notNull()
      .references(() => translation.id),
    book: text('book')
      .notNull()
      .references(() => book.code),
    chapter: integer('chapter').notNull(),
    verse: integer('verse').notNull(),
    segment: text('segment').notNull().default(''),
    wordIndex: integer('word_index').notNull(),
    seq: integer('seq').notNull(),
    /** A data_source id: whose id `ow_id` is (`oshb`, `macula-greek`). */
    source: text('source')
      .notNull()
      .references(() => dataSource.id),
    owId: text('ow_id').notNull(),
    /** Space-separated Strong's numbers of the parts of this original word the word's group aligns to: Hebrew morphemes' own (`H871 H7225`), or the Greek word's. */
    strongs: text('strongs').notNull(),
    /** A data_source id: whose alignment this is (`clear-bsb`, `kjv-strongs`). */
    alignedBy: text('aligned_by')
      .notNull()
      .references(() => dataSource.id),
  },
  (t) => [primaryKey({ columns: [t.translationId, t.book, t.chapter, t.verse, t.segment, t.wordIndex, t.seq] })],
);

/**
 * Where seeded data came from, with the attribution and note of changes each
 * licence asks for: the USFM spec's book names, TVTMS and OSHB's word ids
 * (CC BY 4.0), and the libpalaso `.vrs` files (MIT).
 */
export const dataSource = sqliteTable('data_source', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  sha256: text('sha256'),
  license: text('license').notNull(),
  attribution: text('attribution').notNull(),
  changes: text('changes').notNull(),
});

/** The segments a verse is divided into, in order (`''` = the unmarked first part). */
export const schemeSegment = sqliteTable(
  'scheme_segment',
  {
    scheme: text('scheme')
      .notNull()
      .references(() => scheme.id),
    book: text('book')
      .notNull()
      .references(() => book.code),
    chapter: integer('chapter').notNull(),
    verse: integer('verse').notNull(),
    ordinal: integer('ordinal').notNull(),
    segment: text('segment').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scheme, t.book, t.chapter, t.verse, t.ordinal] })],
);

/** A chapter whose title the scheme numbers as verse 0. */
export const schemeTitle = sqliteTable(
  'scheme_title',
  {
    scheme: text('scheme')
      .notNull()
      .references(() => scheme.id),
    book: text('book')
      .notNull()
      .references(() => book.code),
    chapter: integer('chapter').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scheme, t.book, t.chapter] })],
);

/**
 * Sparse mapping rows from a scheme to the pivot (ADR-0006). A verse with no
 * row maps to the same reference in the pivot. Rows may be many-to-many and
 * cross books; a row with NULL pivot columns marks the verse absent.
 */
export const schemeMapping = sqliteTable(
  'scheme_mapping',
  {
    scheme: text('scheme')
      .notNull()
      .references(() => scheme.id),
    book: text('book')
      .notNull()
      .references(() => book.code),
    chapter: integer('chapter').notNull(),
    verse: integer('verse').notNull(),
    segment: text('segment').notNull(),
    pivotBook: text('pivot_book').references(() => book.code),
    pivotChapter: integer('pivot_chapter'),
    pivotVerse: integer('pivot_verse'),
    pivotSegment: text('pivot_segment'),
    /** TVTMS action, or how a `.vrs` line read. */
    kind: text('kind').notNull(),
    /** Where the row came from: `tvtms` or `vrs` (see data_source). */
    source: text('source')
      .notNull()
      .references(() => dataSource.id),
  },
  (t) => [
    index('mapping_from').on(t.scheme, t.book, t.chapter, t.verse),
    index('mapping_to').on(t.scheme, t.pivotBook, t.pivotChapter, t.pivotVerse),
  ],
);

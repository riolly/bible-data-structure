/**
 * Framework-agnostic corpus row shapes — the domain form of the read-only
 * corpus DB (schema.dbml: `block` / `token`). The build-time ingester (#6)
 * writes rows of this shape; the layout engine (#7) consumes them.
 *
 * INVARIANTS (CONTEXT.md):
 * - Blocks PARTITION the token stream: every Token belongs to exactly one Block.
 * - Whitespace is never a Token — spacing is a presentation concern.
 * - The stored truth is the chapter document (ChapterDoc). Blocks, tokens and
 *   verse text are derived from it (ADR-0001 amendment, plan step 7).
 * - Heading Tokens carry verse=null and wordIndex=null; a mid-chapter
 *   section heading never inherits the preceding verse. A Psalm title the
 *   scheme numbers as verse 0 carries verse 0 and word indexes (ADR-0001).
 * - `id` fields are STORAGE ids only. Outside references use addresses
 *   (address.ts), never these ids; they do not survive re-ingest.
 *
 * No Skia / CanvasKit import in this layer (old-repo ADR-0008).
 */

/** Typesetting branch of a Block (schema.dbml `genre`). */
export type Genre = 'prose' | 'poetry' | 'heading';

/** Word/punct classification is registered anchor policy (ADR-0004). */
export type TokenKind = 'word' | 'punct';

/** One literary unit — a prose paragraph, a poetry line, or a heading. */
export interface Block {
  readonly id: number;
  readonly chapter: number;
  readonly genre: Genre;
  /**
   * The paragraph's USFM marker with its level, as the source wrote it (`p`,
   * `q2`, `pi2`, `li2`, `s2`, `d`). The supported list is in ADR-0001's step 7
   * amendment and in normalize.ts.
   */
  readonly marker: string;
  /** Render order within the chapter (= seq of its first token). */
  readonly seq: number;
}

/** One word- or punctuation-occurrence in a translation's text. */
export interface Token {
  readonly id: number;
  readonly blockId: number;
  readonly chapter: number;
  /** Verse number under the edition's scheme; 0 = a numbered Psalm title; null = other non-verse content. */
  readonly verse: number | null;
  /**
   * The verse's lettered part, `''` when the source letters none. Brenton
   * numbers Septuagint pluses as letters on the previous verse (`1KI 2:35a`).
   */
  readonly segment: string;
  /** Word ordinal within the verse segment, punct excluded; null on punct and heading tokens. */
  readonly wordIndex: number | null;
  /** Dense render order within the chapter. */
  readonly seq: number;
  readonly kind: TokenKind;
  /** Surface text. */
  readonly text: string;
  /** First word token of a verse — drives the verse-number ornament. */
  readonly verseStart: boolean;
  /** Head Original Word id (Phase-3 seam) — null until aligned. */
  readonly owId: string | null;
}

/**
 * Another reading of written words, kept beside the token stream so it never
 * moves a word address (ADR-0007). Today only the Hebrew qere ("what is
 * read") of a ketiv ("what is written").
 *
 * It covers the half-open word range [wordIndex, wordIndex + wordCount) of
 * one verse segment. `wordCount` 0 is a reading with no written word, read
 * before word `wordIndex` (equal to the verse's word count at its end).
 * `text` '' is a written word with no reading.
 */
export interface Reading {
  readonly book: string;
  readonly chapter: number;
  readonly verse: number;
  readonly segment?: string;
  readonly wordIndex: number;
  readonly wordCount: number;
  readonly kind: 'qere';
  /** The reading's own text, pointed, NFC. */
  readonly text: string;
  /** The source's ids of the reading's words, in order: what an alignment points at (ADR-0003). */
  readonly owIds: readonly string[];
}

//---- the stored chapter document (ADR-0001 amendment, plan step 7) ----

/** A USJ node: text, or an element as usfm-grammar 3.x writes it. */
export type UsjNode = string | UsjElement;

export interface UsjElement {
  readonly type: string;
  readonly marker?: string;
  /** Chapter and verse number (`5`, `35a`, `17-18`). */
  readonly number?: string;
  /** Published number (`\cp`, `\vp`). */
  readonly pubnumber?: string;
  /** Alternate number (`\ca`, `\va`). */
  readonly altnumber?: string;
  readonly code?: string;
  readonly caller?: string;
  readonly content?: UsjNode[];
  readonly strong?: string;
}

/**
 * One chapter of an edition as its source has it: the USJ nodes from its `\c`
 * up to the next, unchanged. Chapter 0 is the front matter before `\c 1`.
 */
export interface ChapterDoc {
  readonly chapter: number;
  readonly content: UsjNode[];
}

/**
 * One verse marker's surface text, derived from the chapter document: notes
 * left out, whitespace runs made one space, a space where the verse crosses a
 * block. Empty when the marker is printed with no words.
 */
export interface VerseText {
  readonly chapter: number;
  readonly verse: number;
  readonly segment: string;
  readonly text: string;
}

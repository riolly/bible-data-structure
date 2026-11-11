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

/**
 * An element of a stored chapter document. The markers are the supported
 * list of ADR-0001's step 7 amendment, and nothing else: the ingest checks
 * every node against it (normalize.ts) before it stores a document, and stops
 * on any other. A step 10 adapter keeps an unsupported marker's text as a
 * plain run, so its output fits this type too.
 */
export type UsjElement = UsjBook | UsjChapter | UsjVerse | UsjPara | UsjChar | UsjNote;

/** A numbered marker's levels: the bare form and 1 to 4 (`\s`, `\s1` to `\s4`). */
type Level = '' | '1' | '2' | '3' | '4';
/** Paragraphs that make a block with genre `heading`. */
export type HeadingMarker = `${'mt' | 'ms' | 's' | 'is'}${Level}` | 'd' | 'qa' | 'sp';
/** Paragraphs that make a block with genre `prose`. */
export type ProseMarker = `${'pi' | 'li'}${Level}` | 'p' | 'm' | 'nb' | 'mi' | 'pc' | 'pmo' | 'ip';
/** Paragraphs that make a block with genre `poetry`. */
export type PoetryMarker = `q${Level}` | 'qr';
/** Paragraphs whose text is metadata, not scripture: kept in the document, no block. */
export const METADATA_PARAS = ['h', 'toc1', 'toc2', 'toc3', 'ide', 'cl'] as const;
/** Reference lines under a heading: kept in the document, no block. */
export const REFERENCE_PARAS = ['r', 'mr'] as const;
export type ParaMarker =
  | HeadingMarker
  | ProseMarker
  | PoetryMarker
  | (typeof METADATA_PARAS)[number]
  | (typeof REFERENCE_PARAS)[number]
  /** A stanza break. */
  | 'b';
/** Character styles whose text is scripture surface text. usfm-grammar writes `\+w` as `w`. */
export const CHAR_STYLES = ['w', 'add', 'nd', 'sc', 'wj', 'qs', 'tl', 'it', 'bk'] as const;
/** Markers inside a note, besides the character styles. */
export const NOTE_PARTS = ['fr', 'ft', 'fq', 'fqa', 'fl', 'xo', 'xt', 'wh'] as const;
export type CharMarker = (typeof CHAR_STYLES)[number] | (typeof NOTE_PARTS)[number];
export const NOTES = ['f', 'x'] as const;

/** The `\id` line. */
export interface UsjBook {
  readonly type: 'book';
  readonly marker: 'id';
  readonly code: string;
  readonly content?: UsjNode[];
}

interface Numbered {
  /** Chapter and verse number (`5`, `35a`, `17-18`). */
  readonly number: string;
  /** usfm-grammar's reference for the marker, `JHN 3:16`. */
  readonly sid?: string;
  /** Published number (`\cp`, `\vp`). */
  readonly pubnumber?: string;
  /** Alternate number (`\ca`, `\va`). */
  readonly altnumber?: string;
}

export interface UsjChapter extends Numbered {
  readonly type: 'chapter';
  readonly marker: 'c';
}

export interface UsjVerse extends Numbered {
  readonly type: 'verse';
  readonly marker: 'v';
}

export interface UsjPara {
  readonly type: 'para';
  readonly marker: ParaMarker;
  readonly content?: UsjNode[];
}

/**
 * A character style, with no attributes. The ingest drops the source's word
 * attributes (`strong`, `x-morph`) because nothing checks them: ADR-0003 found
 * WEB's Strong's numbers shifted, and plan step 12 adds checked tags as their
 * own data (ADR-0001 amendment).
 */
export interface UsjChar {
  readonly type: 'char';
  readonly marker: CharMarker;
  readonly content?: UsjNode[];
}

export interface UsjNote {
  readonly type: 'note';
  readonly marker: (typeof NOTES)[number];
  /** `+`, `-` or the caller the source prints. */
  readonly caller?: string;
  readonly content?: UsjNode[];
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
 * One verse unit and its surface text, derived from the chapter document:
 * notes left out, whitespace runs made one space, a space where the verse
 * crosses a block. Empty when the marker is printed with no words.
 *
 * A unit is one verse marker. A bridge (`\v 20-21`) is one unit whose every
 * number resolves to it; its tokens carry the first number (ADR-0004 v1.5).
 */
export interface VerseText {
  readonly chapter: number;
  /** The first verse; the number the unit's tokens carry. */
  readonly verse: number;
  /** The last verse: above `verse` for a bridge, equal to it otherwise. */
  readonly lastVerse: number;
  readonly segment: string;
  readonly text: string;
}

/** Every number a verse unit resolves from: 20 and 21 for a bridge `\v 20-21` (ADR-0004 v1.5). */
export function verseNumbers(u: { readonly verse: number; readonly lastVerse: number }): number[] {
  return Array.from({ length: u.lastVerse - u.verse + 1 }, (_, i) => u.verse + i);
}

/**
 * The unit that holds `chapter:verse` (and `segment`), or undefined when the
 * edition has none: `\v 5-6` resolves from both 5 and 6 (ADR-0004 v1.5).
 */
export function verseUnitOf<U extends Omit<VerseText, 'text'>>(
  units: readonly U[],
  chapter: number,
  verse: number,
  segment = '',
): U | undefined {
  return units.find((u) => u.chapter === chapter && u.segment === segment && u.verse <= verse && verse <= u.lastVerse);
}

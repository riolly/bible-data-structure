/**
 * The app contract (plan step 9): the five calls an app makes to read the
 * model, with the reading screen as the first consumer.
 *
 *     chapter(edition, book, chapter)    a chapter's document and verse units
 *     passage(edition, reference)        a human reference, "1 Cor 13:4-7"
 *     verseText(edition, address)        one verse unit, from `JHN 3:16`
 *     map(from, address, to)             one verse in another edition
 *     rights(edition)                    what the edition's license allows
 *
 * An edition is named by its abbreviation (`KJV`, `BSB`). The edition
 * supplies the versification scheme, so app code writes `JHN 3:16`, and every
 * address the contract returns names the scheme (`JHN 3:16/kjv`, ADR-0002).
 * A book is its USFM code.
 *
 * Results never hold a row id, which a re-ingest rebuilds. A caller that
 * stores a reference stores the address with the edition stamps and the verse
 * text as its quote (ADR-0005 quote witness), all of which every result
 * carries.
 *
 * The calls return promises and take no storage types, so `build/corpus.db`
 * (`corpus-contract.ts`), a pack (plan step 13) and a licensed provider
 * (step 10) can each implement the same interface.
 *
 * No Node-only import here.
 */

import type { UsjNode } from '../model/corpus';
import type { RightsRecord } from './rights';

export type { RightsRecord } from './rights';

/** The stamps a caller stores beside a reference to an edition (ADR-0005). */
export interface EditionStamp {
  /** The edition's abbreviation: `KJV`. */
  readonly id: string;
  /** The edition's native scheme: every address it returns names this. */
  readonly scheme: string;
  /** The edition stamp: names the upstream text. */
  readonly stamp: string;
  /** The words stamp: changes whenever what a word address holds changes. Reconciliation keys on it. */
  readonly wordsStamp: string | null;
}

/**
 * A verse unit the edition prints (ADR-0004 v1.5). `kind` is `bridge` when
 * one verse marker covers several verses (`\v 5-6`): every number in the
 * range finds the same unit.
 */
export interface Verse {
  readonly kind: 'verse' | 'bridge';
  /** The unit's address: `JHN 3:16/kjv`, or its range for a bridge, `JHN 1:5-6/kjv`. */
  readonly address: string;
  readonly book: string;
  readonly chapter: number;
  /** The first verse. 0 is a Psalm title the scheme numbers. */
  readonly verse: number;
  /** The last verse: above `verse` for a bridge, equal to it otherwise. */
  readonly lastVerse: number;
  /** The unit's segment letter, `''` for a whole verse. */
  readonly segment: string;
  /**
   * Set when the address asked for part of this unit (`REV 13:1a/kjv`) and
   * the edition doesn't mark that part. The text is the whole unit.
   */
  readonly part?: string;
  /** Surface text without notes. `''` when the edition prints the number with no words (a footnote only). */
  readonly text: string;
}

/**
 * Why an address finds nothing in an edition:
 *
 * - `scheme`: the edition's scheme has no such verse (`REV 12:18/kjv`).
 * - `text`: the scheme has the verse, and the edition prints no marker for it
 *   (BSB's `ACT 8:37/bsb`, which it gives only in a footnote of 8:36).
 */
export type AbsentReason = 'scheme' | 'text';

export interface Absent {
  readonly kind: 'absent';
  /** The address asked for, with the edition's scheme. */
  readonly address: string;
  readonly reason: AbsentReason;
}

/** What one address gives in one edition: the verse, the bridge that contains it, or absent. */
export type Lookup = Verse | Absent;

export interface VerseTextResult {
  readonly edition: EditionStamp;
  /** The asked address with the edition's scheme: `JHN 3:16/kjv`. */
  readonly asked: string;
  readonly found: Lookup;
}

export type ChapterResult =
  | {
      readonly kind: 'chapter';
      readonly edition: EditionStamp;
      readonly book: string;
      readonly chapter: number;
      /**
       * The chapter document: the source's USJ nodes from this `\c` up to the
       * next, unchanged (ADR-0001 amendment). Render it, footnotes and all.
       */
      readonly content: readonly UsjNode[];
      /** Chapter 1 only: the book's front matter (`\mt` titles), rendered above the chapter. */
      readonly front: readonly UsjNode[] | null;
      /** The chapter's verse units in order, each with its address and text. */
      readonly verses: readonly Verse[];
    }
  | {
      readonly kind: 'absent';
      readonly edition: EditionStamp;
      readonly book: string;
      readonly chapter: number;
      readonly reason: AbsentReason;
    };

/** One range of a reference, resolved in the edition. */
export interface PassagePart {
  /**
   * The range under the edition's scheme: `1CO 13:4-7/kjv`, or `PSA 23:0-6/kjv`
   * for a whole Psalm with a title. A chapter the scheme lacks gives its first
   * verse, absent.
   */
  readonly address: string;
  /**
   * One lookup per verse unit in the range, in order. A bridge appears once.
   * A verse the edition skips is an `absent` entry in its place, so the
   * reader sees the gap (BSB's MAT 17:21).
   */
  readonly found: readonly Lookup[];
}

export interface PassageResult {
  readonly edition: EditionStamp;
  /** The text as given. */
  readonly reference: string;
  /** Empty when the text holds no English reference to the 66 books. */
  readonly parts: readonly PassagePart[];
}

/**
 * The kind of a mapping result, and how to display it. This table is the
 * one home of the display rules (CONTEXT.md, "Mapping result").
 *
 * | Kind      | When                                                         | Display |
 * |-----------|--------------------------------------------------------------|---------|
 * | `one`     | The verse matches one unit of the target edition.            | Show that unit with its own number, which may differ from the source's. BSB `PHP 1:16` is KJV `PHP 1:17`. A bridge shows its range. |
 * | `several` | It matches two or more units.                                | Show them all in order, each with its own number, as one block. A unit with `part` set is shown whole and marked as only partly matching. KJV's Psalm 51 title is WLC's 51:1-2. |
 * | `part`    | It matches part of one unit, and the target doesn't mark it. | Show the whole unit, marked as only partly matching. Never cut its text. SBLGNT `REV 12:18` is the first part of KJV `REV 13:1`. |
 * | `absent`  | No unit of the target edition matches.                       | Show "not in this edition" with the asked address. Never show a neighbouring verse in its place. `missing` says why. |
 *
 * Mapping goes through the pivot (ADR-0006), never by number. It can't see a
 * clause that moves between verses with the same numbers (ADR-0006,
 * Consequences), so `one` means "the same verse", not "the same words".
 */
export type MapKind = 'one' | 'several' | 'part' | 'absent';

export interface MapResult {
  readonly from: EditionStamp;
  readonly to: EditionStamp;
  /** The source address with the source edition's scheme: `PSA 51:1/org`. */
  readonly asked: string;
  readonly kind: MapKind;
  /** The matching units in the target, in order. Empty for `absent`. */
  readonly verses: readonly Verse[];
  /**
   * Target verses the mapping names that the target edition lacks, each with
   * its reason. For `absent` with no entries, the target scheme has no
   * counterpart at all (the pivot marks the verse absent).
   */
  readonly missing: readonly Absent[];
}

export interface BibleContract {
  /**
   * One chapter of an edition. Absent when the scheme has no such chapter
   * (`scheme`) or the edition doesn't print it (`text`).
   */
  chapter(edition: string, book: string, chapter: number): Promise<ChapterResult>;

  /**
   * A human reference in English ("Ps 23", "1 Cor 13:4-7", "Matt 17:20-22;
   * Acts 8:37"), resolved under the edition's scheme. A whole chapter starts
   * at its title where the scheme numbers one. A verse number past the
   * chapter's end stops at the end.
   */
  passage(edition: string, reference: string): Promise<PassageResult>;

  /**
   * One verse address: `JHN 3:16`, `PSA 51:0` (a title) or `REV 13:1a`. The
   * edition supplies the scheme. A `/scheme` suffix is allowed only when it
   * is the edition's own: use `map` to move between schemes. Throws on a
   * range or a word address.
   */
  verseText(edition: string, address: string): Promise<VerseTextResult>;

  /**
   * Where one verse of the `from` edition is in the `to` edition, through the
   * pivot. The address takes the `from` edition's scheme. Throws when that
   * scheme has no such verse. See `MapKind` for the display rules.
   */
  map(from: string, address: string, to: string): Promise<MapResult>;

  /** The edition's rights record. Throws for an edition with none. */
  rights(edition: string): Promise<RightsRecord>;
}

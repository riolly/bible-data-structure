/**
 * The app contract (plan step 9): the calls an app makes to read the model,
 * with the reading screen as the first consumer.
 *
 *     chapter(edition, book, chapter)    a chapter's document and verse units
 *     passage(edition, reference)        a human reference, "1 Cor 13:4-7"
 *     verseText(edition, address)        one verse unit, from `JHN 3:16`
 *     map(from, address, to)             one verse in another edition
 *     resolve(edition, address)          a stored address, under any scheme
 *     words(edition, address)            a verse's words, or one word, with Strong's numbers
 *     rights(edition)                    what the edition's license allows
 *     credits()                          the credit each data source in the file asks for
 *
 * An edition is named by its abbreviation (`KJV`, `BSB`). The edition
 * supplies the versification scheme, so app code writes `JHN 3:16`, and every
 * address the contract returns names the scheme (`JHN 3:16/kjv`, ADR-0002).
 * A book is its USFM code.
 *
 * Results never hold a row id, which a re-ingest rebuilds. A caller that
 * stores a reference stores the address, the verse text as its quote and the
 * verse's chapter stamp (ADR-0005 quote witness and its 2026-11-11
 * amendment), all of which every `Verse` carries, and reads it back with
 * `resolve`. A changed chapter stamp means the quote must be checked again.
 * A mark on part of a verse also stores the words stamp, and is checked
 * again when that changes. A mark on a licensed edition stores the quote's
 * sha256, not its text (ADR-0005, step 14 amendment).
 *
 * The calls return promises and take no storage types, so `build/corpus.db`
 * (`corpus-contract.ts`), a pack (plan step 13) and a licensed provider
 * (step 10) can each implement the same interface.
 *
 * No Node-only import here.
 */

import type { OriginalWordKind, UsjNode } from '../model/corpus';
import type { RightsRecord } from './rights';

export type { RightsRecord } from './rights';

/**
 * An edition and its stamps (ADR-0005). An edition fetched a chapter at a
 * time (plan step 10) has no source files and no whole text, so it has none
 * of the three stamps, and only its chapter stamps say when its text changed.
 */
export interface EditionStamp {
  /** The edition's abbreviation: `KJV`. */
  readonly id: string;
  /** The edition's native scheme: every address it returns names this. */
  readonly scheme: string;
  /** The edition stamp: names the upstream text. */
  readonly stamp: string | null;
  /** The words stamp: changes whenever what a word address holds changes. Word anchors reconcile on it. */
  readonly wordsStamp: string | null;
  /** The text stamp: changes whenever any chapter stamp does. */
  readonly textStamp: string | null;
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
  /** The stamp of the unit's chapter: store it beside `text` when it is kept as a quote. */
  readonly chapterStamp: string;
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

/**
 * A whole verse the edition prints only in parts, with no unit for the whole
 * (Brenton's `SIR 6:2`, printed as 6:2a and 6:2b). Show every part in order.
 */
export interface Parts {
  readonly kind: 'parts';
  /** The asked address with the edition's scheme: `SIR 6:2/brenton`. */
  readonly address: string;
  readonly parts: readonly Verse[];
}

export interface VerseTextResult {
  readonly edition: EditionStamp;
  /** The asked address with the edition's scheme: `JHN 3:16/kjv`. */
  readonly asked: string;
  readonly found: Lookup | Parts;
}

export type ChapterResult =
  | {
      readonly kind: 'chapter';
      readonly edition: EditionStamp;
      readonly book: string;
      readonly chapter: number;
      /** The chapter stamp: covers `content` and the text of `verses`. */
      readonly stamp: string;
      /**
       * The chapter document: the source's USJ nodes from this `\c` up to the
       * next, without word attributes (ADR-0001 amendment). Every element is
       * one of the supported markers (`UsjElement`). Render it, footnotes and
       * all.
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
   * The range under the reference's scheme, which is the edition's unless
   * `PassageOptions.scheme` names another: `1CO 13:4-7/kjv`, or
   * `PSA 23:0-6/kjv` for a whole Psalm with a title. A chapter the scheme
   * lacks gives its first verse, absent. Under another scheme, `found` is what
   * `resolve` gives for this address.
   */
  readonly address: string;
  /**
   * One lookup per verse unit in the range, in order. A bridge appears once.
   * A verse the edition prints in parts gives each unit the edition prints
   * for it, as `chapter` does: Brenton's 1KI 2:35 is the whole verse, then
   * 35a to 35o. A verse the edition skips is an `absent` entry in its place, so the
   * reader sees the gap (BSB's MAT 17:21).
   */
  readonly found: readonly Lookup[];
}

export interface PassageOptions {
  /**
   * The scheme the reference's numbers are written in. Default: the edition's
   * own. An app passing an English reader's reference to WLC or SBLGNT, whose
   * scheme is `org`, passes `kjv`, or "Ps 51:1" finds the Hebrew title.
   */
  readonly scheme?: string;
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
  /** The matching units in the target, in text order. Empty for `absent`. */
  readonly verses: readonly Verse[];
  /**
   * Target verses the mapping names that the target edition lacks, each with
   * its reason. For `absent` with no entries, the target scheme has no
   * counterpart at all (the pivot marks the verse absent).
   */
  readonly missing: readonly Absent[];
}

export interface ResolveResult {
  readonly edition: EditionStamp;
  /** The address as given: `PHP 1:16/kjv`. */
  readonly asked: string;
  /**
   * The edition's units for the address, in text order, as `PassagePart.found`
   * lists them. A unit with `part` set matches only in part (`MapKind` `part`).
   * Under another scheme, a verse the edition's scheme has no counterpart for
   * is an `absent` entry with the asked verse's address and reason `scheme`.
   */
  readonly found: readonly Lookup[];
}

/** One data source and the credit its license asks for (`data_source`). */
export interface Credit {
  /** `macula-greek`, `clear-bsb`, `tvtms`. */
  readonly id: string;
  readonly url: string;
  /** `CC BY 4.0`, `MIT`. */
  readonly license: string;
  /** The credit line to show. */
  readonly attribution: string;
  /** What we changed, which CC BY 4.0 asks to state. */
  readonly changes: string;
}

/** An original word's own data (ADR-0003, plan step 11). */
export interface OriginalWordData {
  /** The source's id for the word: OSHB's for Hebrew, MACULA's for Greek. What an alignment points at. */
  readonly owId: string;
  /** The source's lemma: OSHB's Strong's form (`c/1961`), or the Greek dictionary form (`λόγος`). */
  readonly lemma: string;
  /** The raw morphology code: OSHB's (`HC/Vqw3ms`), `/` between morphemes, or MACULA's (`N-NSF`). */
  readonly morph: string;
  /** The editorial gloss. Null on a ketiv (show its qere's) and on the few words the source leaves unglossed. */
  readonly gloss: string | null;
}

/** An original word that a translation's word translates (ADR-0003 step 12 amendment). */
export interface OriginalRef {
  /** `WLC` or `SBLGNT`: read the word with `words(edition, address)`. */
  readonly edition: string;
  /** The original word's address, `GEN 1:1!1/org`. Null for a qere, which is not written. */
  readonly address: string | null;
  readonly owId: string;
}

/**
 * One word of a verse unit. In WLC and SBLGNT each word is an original word.
 * The Hebrew list is in read order: a ketiv (written, read otherwise) is
 * followed by its qere words (read, not written).
 */
export interface Word {
  /** The word address, `GEN 1:1!1/org`. Null for a qere, which is not written. */
  readonly address: string | null;
  readonly text: string;
  /** `word`, or in Hebrew `ketiv` or `qere` (ADR-0007). */
  readonly kind: OriginalWordKind;
  /**
   * The word's Strong's numbers (`H7225`, `G3056`). An original word has one,
   * or several for a Greek compound. Empty when there is none: 2 SBLGNT words
   * Strong's dictionary lacks (`Ἀρνί`, `ἄμωμον`). A BSB word has the numbers
   * of what its aligned group translates: `In`, `the` and `beginning` in GEN
   * 1:1 each have `H871 H7225` (the prefix בְּ and רֵאשִׁית). None when the word
   * has no alignment, as in every Psalm title.
   */
  readonly strongs: readonly string[];
  /** Set on the words of WLC and SBLGNT, null on a translation's. */
  readonly original: OriginalWordData | null;
  /** The original words a translation's word translates, in order. Empty on WLC and SBLGNT, and on unaligned words. */
  readonly originals: readonly OriginalRef[];
}

export interface WordsResult {
  readonly edition: EditionStamp;
  /** The asked address with the edition's scheme: `GEN 1:1/org` or `GEN 1:1!3/org`. */
  readonly asked: string;
  /** What the verse part of the address finds, as `verseText` gives it. */
  readonly found: Lookup | Parts;
  /**
   * The words of each unit found, in order: none when absent. A word address
   * gives that word only, twice in the 12 places where OSHB divides one
   * written Hebrew word in two (1CH 15:13).
   */
  readonly words: readonly Word[];
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
   * at its title where the scheme numbers one, and a book on its own is the
   * whole book. A verse number past the chapter's end stops at the end. A
   * part letter is ignored: "1 Kgs 2:35a" gives all of 2:35 with its parts.
   * Use `verseText` to ask for one part.
   */
  passage(edition: string, reference: string, options?: PassageOptions): Promise<PassageResult>;

  /**
   * One verse address: `JHN 3:16`, `PSA 51:0` (a title) or `REV 13:1a`. A
   * verse printed only in parts gives `parts`. The
   * edition supplies the scheme. A `/scheme` suffix is allowed only when it
   * is the edition's own: use `resolve` for an address under another scheme.
   * Throws on a range or a word address.
   */
  verseText(edition: string, address: string): Promise<VerseTextResult>;

  /**
   * Where one verse of the `from` edition is in the `to` edition, through the
   * pivot. The address takes the `from` edition's scheme. Throws when that
   * scheme has no such verse. See `MapKind` for the display rules.
   */
  map(from: string, address: string, to: string): Promise<MapResult>;

  /**
   * Any verse address the contract returned, read back in an edition: a
   * verse, a part (`REV 13:1a/kjv`), a bridge or a range (`1CO 13:4-7/kjv`).
   * The address must name its scheme. Under the edition's own scheme it reads
   * like `passage`, except that a part letter is kept. Under another scheme
   * it moves each verse through the pivot (ADR-0006), as `map` does, so an
   * address stored before the edition changed scheme still reads (BSB's
   * `PHP 1:16/kjv` is `PHP 1:17/bsb`). This is the read path for a stored
   * reference. Throws on a word address or an unknown scheme.
   */
  resolve(edition: string, address: string): Promise<ResolveResult>;

  /**
   * The words of one verse (`GEN 1:1`) or one word (`GEN 1:1!3`), with their
   * Strong's numbers. For the Hebrew or Greek words of a verse in another
   * edition, `map` it to WLC or SBLGNT and read each verse it gives:
   *
   *     const m = await c.map('KJV', 'GEN 1:1', 'WLC');
   *     for (const v of m.verses) (await c.words('WLC', v.address)).words;
   *
   * The edition supplies the scheme, as for `verseText`. Throws on a range,
   * except a bridge's own address (`JHN 1:5-6/kjv`), and on a word address in
   * a verse printed only in parts, which needs the part's letter (`SIR 6:2a!1`).
   */
  words(edition: string, address: string): Promise<WordsResult>;

  /** The edition's rights record. Throws for an edition with none. */
  rights(edition: string): Promise<RightsRecord>;

  /**
   * Every data source the file holds data from, besides the edition texts,
   * whose credits are in `rights`: Strong's numbers, glosses, alignments,
   * mappings and book names. Show each `attribution` and `changes` on the
   * app's credits screen (CC BY 4.0 and MIT ask for it).
   */
  credits(): Promise<readonly Credit[]>;
}

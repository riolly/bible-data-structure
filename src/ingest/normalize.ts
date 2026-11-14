/**
 * Chapter documents → derived rows (the normalize step of ADR-0001).
 *
 * The stored truth of an edition is one USJ document per chapter
 * (`splitChapters`, ADR-0001 amendment, plan step 7). `normalizeChapters`
 * derives from those documents, and from nothing else, a Token stream with
 * Block overlays and one verse-text row per verse marker, as the canonical
 * model types (src/model/corpus.ts). Invariants enforced here (CONTEXT.md):
 *
 *  - Blocks PARTITION the token stream; whitespace is never a Token.
 *  - EVERY heading token (incl. mid-chapter \s) carries verse=NULL and
 *    wordIndex=NULL — a heading never INHERITS the preceding verse. One
 *    exception: an unnumbered \d title before a chapter's first verse is
 *    verse 0, with word indexes, where the edition's scheme numbers that
 *    chapter's title as verse 0 (`titleChapters`, ADR-0001 amendment). An
 *    EXPLICIT \v inside a heading para is different: some translations set
 *    real verse text as a descriptive title (BSB Zech 12: \d containing
 *    \v 1), and those tokens carry their verse — the invariant bans
 *    inheritance, not versified titles (else the verse would vanish from the
 *    translation and be unanchorable).
 *  - `word_index` counts word tokens only (punct excluded) and CONTINUES
 *    across block boundaries within a verse (poetry lines, mid-verse \p).
 *
 * Only the markers listed in ADR-0001's step 7 amendment are supported, at
 * any depth. Any other marker or node type throws, so the ingest stops
 * instead of guessing. Note text (footnotes, cross-references) stays in the
 * document and never becomes tokens; the stats bag counts it.
 *
 * Front matter before \c 1 (\mt book title, intro headings) lands in
 * chapter 0 — the reader fetches chapter 0 alongside chapter 1.
 */

import {
  CHAR_STYLES,
  METADATA_PARAS,
  NOTE_PARTS,
  NOTES,
  REFERENCE_PARAS,
  verseNumbers,
  type Block,
  type ChapterDoc,
  type Genre,
  type Token,
  type VerseText,
} from '../model/corpus';
import { storedText } from './text-form';
import { tokenize, withoutParagraphMarks } from './tokenize';

/**
 * A USJ node as usfm-grammar writes it, before `normalizeChapters` checks it
 * against the supported markers. Only that check makes a `UsjNode`.
 */
export type RawUsjNode = string | RawUsjElement;

export interface RawUsjElement {
  readonly type: string;
  readonly marker?: string;
  readonly number?: string;
  readonly pubnumber?: string;
  readonly altnumber?: string;
  readonly code?: string;
  readonly caller?: string;
  /** A `\w` word's Strong's number (`H0430`, `G2316`). Read when `NormalizeOptions.wordTags` is set, and never stored. */
  readonly strong?: string;
  readonly content?: readonly RawUsjNode[];
}

export interface UsjDoc {
  readonly type: 'USJ';
  readonly version: string;
  readonly content: RawUsjNode[];
}

/** One chapter's raw nodes, from `splitChapters`. */
export interface RawChapterDoc {
  readonly chapter: number;
  readonly content: readonly RawUsjNode[];
}

//---- stats: what the documents hold beyond the tokens, counted ----

export interface IngestStats {
  footnotes: number; // \f notes (in the document, never tokens)
  xrefs: number; // \x notes (in the document, never tokens)
  wordsOfJesus: number; // \wj spans (text is tokens)
  selah: number; // \qs spans (text is tokens)
  wWrapped: number; // \w-wrapped words
  preVerseWordTokens: number; // word tokens with verse=NULL (headings/titles)
  sectionRefs: number; // \r and \mr reference lines (no block)
  altVerseNumbers: number; // \va and \vp numbers on a verse
  altChapterNumbers: number; // \ca and \cp numbers on a chapter
  verseBridges: number; // \v 17-18 bridged verses (one unit with a range)
  metadataParas: Record<string, number>; // \h, \toc1 … paragraphs (no block)
}

export interface NormalizeResult {
  /** The documents, checked against the supported markers: what the corpus stores. */
  docs: readonly ChapterDoc[];
  blocks: Block[];
  tokens: Token[];
  verses: VerseText[];
  /** Empty verse markers outside the scheme, which got no row (`NormalizeOptions.hasVerse`). */
  droppedVerses: { chapter: number; verse: number }[];
  /** The source's `\w strong=` tags in reading order, with the words each covers (`NormalizeOptions.wordTags`). */
  wordTags: WordTag[];
  stats: IngestStats;
}

/**
 * One `\w strong=` tag of a verse unit, and the word indexes of the words its
 * text touches: `these things|G5023` covers two. A word that only part of a
 * tag's text touches (`LORD's` from `\w LORD\w*'s`) counts too. A tag split by
 * a verse marker gives one entry per unit.
 */
export interface WordTag {
  readonly chapter: number;
  readonly verse: number;
  readonly segment: string;
  readonly wordIndexes: readonly number[];
  /** As the source writes them, `H0430`. */
  readonly strongs: readonly string[];
}

//---- the supported markers (ADR-0001 amendment, plan step 7) ----

const METADATA = new Set<string>(METADATA_PARAS);
const REFERENCES = new Set<string>(REFERENCE_PARAS);
const STYLES = new Set<string>(CHAR_STYLES);
const NOTE_MARKERS = new Set<string>(NOTES);
const PARTS = new Set<string>(NOTE_PARTS);

/** The genre of a block marker, or null when the marker is not supported. */
export function blockGenre(marker: string): Genre | null {
  if (/^(mt|ms|s|is)[1-4]?$/.test(marker) || ['d', 'qa', 'sp'].includes(marker)) return 'heading';
  if (/^q[1-4]?$/.test(marker) || marker === 'qr') return 'poetry';
  if (/^(pi|li)[1-4]?$/.test(marker) || ['p', 'm', 'nb', 'mi', 'pc', 'pmo', 'ip'].includes(marker)) return 'prose';
  return null;
}

const unsupported = (what: string, marker: string | undefined) =>
  new Error(`unsupported ${what} "\\${marker ?? '?'}": add it to the supported list in ADR-0001 and normalize.ts consciously`);

/**
 * Split a book's USJ into one document per chapter. Chapter 0 is everything
 * before the first `\c`. The nodes are unchanged: `normalizeChapters` drops
 * the word attributes from the documents it returns.
 */
export function splitChapters(usj: UsjDoc): RawChapterDoc[] {
  const docs: { chapter: number; content: RawUsjNode[] }[] = [{ chapter: 0, content: [] }];
  for (const node of usj.content) {
    if (typeof node !== 'string' && node.type === 'chapter') {
      const n = /^\d+$/.test(node.number ?? '') ? Number(node.number) : NaN;
      if (!(n >= 1)) throw new Error(`unparseable chapter number "${node.number}"`);
      if (docs.some((d) => d.chapter === n)) throw new Error(`chapter ${n} printed twice`);
      docs.push({ chapter: n, content: [] });
    }
    docs[docs.length - 1].content.push(node);
  }
  return docs[0].content.length === 0 ? docs.slice(1) : docs;
}

/** A node with every character style's attributes dropped, at any depth. Text is unchanged. */
function withoutWordAttributes(node: RawUsjNode): RawUsjNode {
  if (typeof node === 'string') return node;
  if (node.type === 'char') {
    const { type, marker, content } = node;
    return content ? { type, marker, content: content.map(withoutWordAttributes) } : { type, marker };
  }
  return node.content ? { ...node, content: node.content.map(withoutWordAttributes) } : node;
}

const newStats = (): IngestStats => ({
  footnotes: 0,
  xrefs: 0,
  wordsOfJesus: 0,
  selah: 0,
  wWrapped: 0,
  preVerseWordTokens: 0,
  sectionRefs: 0,
  altVerseNumbers: 0,
  altChapterNumbers: 0,
  verseBridges: 0,
  metadataParas: {},
});

export interface NormalizeOptions {
  /**
   * Chapters whose title the edition's scheme numbers as verse 0 (the
   * scheme's `titles` for this book). An unnumbered \d title before the
   * chapter's first verse becomes verse 0 there.
   */
  readonly titleChapters?: ReadonlySet<number>;
  /**
   * Whether the edition's scheme has a verse of this book. A verse marker
   * printed with no words, for a verse the scheme lacks (WEB's ROM 16:25), gets
   * no verse-text row and is listed in `droppedVerses`: its address would name
   * a verse the scheme lacks. The marker stays in the document. Without this
   * option every verse marker gets a row.
   */
  readonly hasVerse?: (chapter: number, verse: number) => boolean;
  /**
   * Whether a paragraph is a Psalm title. Default: a `\d` paragraph. NASB 1995
   * on API.Bible prints its titles as `\ms`, after an `\ms PSALM 3` line
   * (research/api-bible.md), so its provider passes its own test.
   */
  readonly isTitle?: (para: RawUsjElement) => boolean;
  /**
   * Collect the `\w strong=` tags in `wordTags`. Only the KJV's are used,
   * after a check against the original words (ADR-0003, KJV amendment).
   */
  readonly wordTags?: boolean;
}

/** Normalize one book's USJ: split it into chapter documents and derive from those. */
export function normalizeUsj(usj: UsjDoc, opts: NormalizeOptions = {}): NormalizeResult {
  return normalizeChapters(splitChapters(usj), opts);
}

/** Derive one book's blocks, tokens, verse text and stats from its chapter documents, in order. */
export function normalizeChapters(docs: readonly RawChapterDoc[], opts: NormalizeOptions = {}): NormalizeResult {
  const blocks: Block[] = [];
  const tokens: Token[] = [];
  const verses: VerseText[] = [];
  const stats = newStats();

  let chapter = 0; // front matter before \c 1 = chapter 0
  let verse: number | null = null;
  let segment = ''; // the lettered part of `verse` (\v 35a), '' when none
  let wordIndexInVerse = 0;
  let seqInChapter = 0;
  let pendingVerseStart = false;
  // the verse unit that text of the current verse goes to
  type VerseRow = { chapter: number; verse: number; lastVerse: number; segment: string; text: string };
  let verseText: VerseRow | null = null;

  // the block a para WILL create if it emits a token (lazy: empty paras — e.g.
  // a para holding only a verse marker — must not break the partition with an
  // empty block)
  let pendingMarker: { marker: string; genre: Genre } | null = null;
  let cur: Block | null = null;
  let inHeading = false;
  // verse carried by heading tokens: null unless an EXPLICIT \v occurred
  // inside the current heading para (a heading never inherits `verse`)
  let headingVerse: number | null = null;
  let buf = '';
  // Tag spans are offsets into all the text walked so far; `bufStart` is where `buf` begins.
  let bufStart = 0;
  type OpenTag = { start: number; end: number; strongs: string[]; units: Map<string, WordTag & { wordIndexes: number[] }> };
  let openTags: OpenTag[] = [];
  const wordTags: (WordTag & { wordIndexes: number[] })[] = [];

  // The verse-text row per `chapter:verse+segment`, for a title printed in several \d paragraphs.
  const verseRows = new Map<string, VerseRow>();
  // Rule 6a (ADR-0004 v1.5): within a chapter each unit's first verse is above
  // the previous unit's last verse, or the same single verse with a later letter.
  const startVerseText = (v: number, last = v) => {
    const prev = verses.at(-1);
    if (prev && prev.chapter === chapter) {
      const rises = v > prev.lastVerse || (v === prev.verse && v === prev.lastVerse && v === last && segment > prev.segment);
      if (!rises) {
        const show = (u: { verse: number; lastVerse: number; segment: string }) =>
          `${u.verse}${u.segment}${u.lastVerse > u.verse ? `-${u.lastVerse}` : ''}`;
        throw new Error(
          `chapter ${chapter}: verse ${show({ verse: v, lastVerse: last, segment })} does not rise after ${show(prev)}`,
        );
      }
    }
    verseText = { chapter, verse: v, lastVerse: last, segment, text: '' };
    verseRows.set(`${chapter}:${v}${segment}`, verseText);
    verses.push(verseText);
  };

  const ensureBlock = (): Block => {
    if (cur) return cur;
    if (!pendingMarker) throw new Error(`chapter ${chapter}: text outside a paragraph`);
    cur = { id: blocks.length, chapter, genre: pendingMarker.genre, marker: pendingMarker.marker, seq: seqInChapter };
    blocks.push(cur);
    return cur;
  };

  const flushText = () => {
    if (!buf) return;
    // NFC before tokenizing, except Hebrew (storedText, ADR-0004 v1.6):
    // Greek polytonic arrives decomposed. Idempotent on already-NFC text.
    const run = storedText(buf);
    const raw = tokenize(run, { paragraphMarks: !inHeading });
    const runStart = bufStart;
    if (openTags.length > 0 && run !== buf) {
      throw new Error(`chapter ${chapter}: a tagged run changes under NFC (storedText), so its word tags can't be placed`);
    }
    bufStart += buf.length;
    buf = '';
    // Heading tokens carry only a verse EXPLICITLY set inside the heading
    // (never the inherited one); other tokens need a \v seen.
    const effectiveVerse = inHeading ? headingVerse : verse;
    const inVerse = effectiveVerse != null;
    if (inVerse && verseText) verseText.text += ` ${run}`;
    if (raw.length === 0) return;
    const blk = ensureBlock();
    let at = 0; // the token's offset in `run`: tokens cover every non-space character in order
    for (const t of raw) {
      const isWord = t.kind === 'word';
      at = run.indexOf(t.text, at);
      const span = { start: runStart + at, end: runStart + at + t.text.length };
      at += t.text.length;
      if (isWord && inVerse && openTags.length > 0) {
        for (const tag of openTags) {
          if (tag.start >= span.end || tag.end <= span.start) continue;
          const key = `${effectiveVerse}${segment}`;
          let unit = tag.units.get(key);
          if (!unit) {
            unit = { chapter, verse: effectiveVerse, segment, wordIndexes: [], strongs: tag.strongs };
            tag.units.set(key, unit);
            wordTags.push(unit);
          }
          unit.wordIndexes.push(wordIndexInVerse);
        }
      }
      tokens.push({
        id: tokens.length,
        blockId: blk.id,
        chapter,
        verse: inVerse ? effectiveVerse : null,
        segment: inVerse ? segment : '',
        wordIndex: inVerse && isWord ? wordIndexInVerse++ : null,
        seq: seqInChapter++,
        kind: t.kind,
        text: t.text,
        verseStart: inVerse && isWord ? consumeVerseStart() : false,
        owId: null,
      });
      if (isWord && !inVerse) stats.preVerseWordTokens++;
    }
    openTags = openTags.filter((tag) => tag.end > bufStart);
  };

  const consumeVerseStart = () => {
    const v = pendingVerseStart;
    pendingVerseStart = false;
    return v;
  };

  /** Check a note's parts against the supported list. Note text is never surface text. */
  const checkNote = (nodes: readonly RawUsjNode[]) => {
    for (const node of nodes) {
      if (typeof node === 'string') continue;
      if (node.type !== 'char' || !(PARTS.has(node.marker ?? '') || STYLES.has(node.marker ?? ''))) {
        throw unsupported(`marker inside a note (${node.type})`, node.marker);
      }
      checkNote(node.content ?? []);
    }
  };

  /** Walk inline content, appending scripture surface text to the buffer. */
  const walkInline = (nodes: readonly RawUsjNode[]) => {
    for (const node of nodes) {
      if (typeof node === 'string') {
        buf += node;
        continue;
      }
      switch (node.type) {
        case 'verse': {
          flushText();
          // a lettered verse (\v 35a) is a segment, and its words count from 0;
          // a bridge (\v 17-18) is one unit with a range, and has no letters
          const m = (node.number ?? '').match(/^(\d+)(?:([a-z])|-(\d+))?$/);
          if (!m) throw new Error(`unparseable verse number "${node.number}"`);
          const first = parseInt(m[1], 10);
          const last = m[3] ? parseInt(m[3], 10) : first;
          if (m[3] && last <= first) throw new Error(`verse range "${node.number}" does not rise`);
          if (m[3]) stats.verseBridges++;
          if (node.altnumber !== undefined) stats.altVerseNumbers++;
          if (node.pubnumber !== undefined) stats.altVerseNumbers++;
          verse = first;
          segment = m[2] ?? '';
          if (inHeading) headingVerse = verse; // versified title (\d + \v)
          wordIndexInVerse = 0;
          pendingVerseStart = true;
          startVerseText(first, last);
          break;
        }
        case 'char': {
          const marker = node.marker ?? '';
          if (!STYLES.has(marker)) throw unsupported('character style', node.marker);
          if (marker === 'w') stats.wWrapped++;
          if (marker === 'wj') stats.wordsOfJesus++;
          if (marker === 'qs') stats.selah++;
          if (opts.wordTags && node.strong !== undefined) {
            const tag: OpenTag = { start: bufStart + buf.length, end: Infinity, strongs: node.strong.split(/[\s,]+/).filter(Boolean), units: new Map() };
            openTags.push(tag);
            walkInline(node.content ?? []);
            tag.end = bufStart + buf.length;
          } else walkInline(node.content ?? []);
          break;
        }
        case 'note': {
          if (!NOTE_MARKERS.has(node.marker ?? '')) throw unsupported('note', node.marker);
          if (node.marker === 'f') stats.footnotes++;
          else stats.xrefs++;
          checkNote(node.content ?? []);
          break; // note content is never scripture surface text
        }
        default:
          throw unsupported(`inline node "${node.type}"`, node.marker);
      }
    }
  };

  for (const doc of docs) {
    const first = doc.content[0];
    if (doc.chapter === 0) {
      if (typeof first !== 'string' && first?.type === 'chapter') throw new Error('chapter 0 document starts with a \\c');
    } else if (typeof first === 'string' || first?.type !== 'chapter' || Number(first.number) !== doc.chapter) {
      throw new Error(`chapter ${doc.chapter} document does not start with its own \\c`);
    }
    for (const node of doc.content) {
      if (typeof node === 'string') {
        if (node.trim()) throw new Error(`chapter ${doc.chapter}: text outside a paragraph`);
        continue;
      }
      switch (node.type) {
        case 'book':
          if (node.marker !== 'id' || typeof node.code !== 'string') throw unsupported('book line', node.marker);
          break; // \id line — metadata
        case 'chapter': {
          if (node !== first) throw new Error(`chapter ${doc.chapter} document holds a second \\c`);
          if (node.altnumber !== undefined) stats.altChapterNumbers++;
          if (node.pubnumber !== undefined) stats.altChapterNumbers++;
          chapter = doc.chapter;
          verse = null;
          segment = '';
          wordIndexInVerse = 0;
          seqInChapter = 0;
          pendingVerseStart = false;
          verseText = null;
          cur = null;
          pendingMarker = null;
          inHeading = false;
          break;
        }
        case 'para': {
          const marker = node.marker ?? '';
          cur = null;
          bufStart += buf.length;
          buf = '';
          if (marker === 'b') break; // stanza break — never a block
          if (REFERENCES.has(marker)) {
            stats.sectionRefs++;
            break;
          }
          if (METADATA.has(marker)) {
            stats.metadataParas[marker] = (stats.metadataParas[marker] ?? 0) + 1;
            break;
          }
          const genre = blockGenre(marker);
          if (!genre) throw unsupported('paragraph', node.marker);
          pendingMarker = { marker, genre };
          inHeading = genre === 'heading';
          headingVerse = null; // a heading starts unversed — no inheritance
          if ((opts.isTitle ? opts.isTitle(node) : marker === 'd') && verse === null && opts.titleChapters?.has(chapter)) {
            headingVerse = 0; // the scheme numbers this title as verse 0
            // A title printed as several \d paragraphs is one verse 0: later
            // ones continue its text and its word indexes.
            const title = verseRows.get(`${chapter}:0`);
            if (title) verseText = title;
            else {
              wordIndexInVerse = 0;
              startVerseText(0);
            }
          }
          walkInline(node.content ?? []);
          flushText();
          cur = null;
          pendingMarker = null;
          inHeading = false;
          break;
        }
        default:
          throw unsupported(`top-level node "${node.type}"`, node.marker);
      }
    }
  }
  flushText();

  const kept: VerseText[] = [];
  const droppedVerses: { chapter: number; verse: number }[] = [];
  for (const row of verses) {
    // a paragraph mark printed as text is no part of the verse's words: a quote leaves it out (ADR-0001 amendment, 2026-11-14)
    const v = { ...row, text: withoutParagraphMarks(row.text).replace(/\s+/g, ' ').trim() };
    if (v.text !== '' || v.verse === 0 || opts.hasVerse === undefined) {
      kept.push(v);
      continue;
    }
    // an empty unit keeps only the numbers its scheme has: `\v 25-27` with 27 outside keeps 25-26
    const inside = verseNumbers(v).filter((n) => opts.hasVerse!(v.chapter, n));
    for (const n of verseNumbers(v)) if (!inside.includes(n)) droppedVerses.push({ chapter: v.chapter, verse: n });
    if (inside.length === 0) continue;
    if (inside.at(-1)! - inside[0] + 1 !== inside.length) {
      throw new Error(`chapter ${v.chapter}: the scheme has verses ${inside.join(', ')} of the empty bridge ${v.verse}-${v.lastVerse}, not one run`);
    }
    kept.push({ ...v, verse: inside[0], lastVerse: inside.at(-1)! });
  }
  // Character styles lose the source's word attributes (`strong`, `x-morph`):
  // no stored document carries them (ADR-0001 amendment). Every node passed
  // the checks above, so the documents have the stored type.
  const stored = docs.map((d) => ({ ...d, content: d.content.map(withoutWordAttributes) }));
  return { docs: stored as readonly ChapterDoc[], blocks, tokens, verses: kept, droppedVerses, wordTags, stats };
}

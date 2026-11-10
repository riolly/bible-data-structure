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

import type { Block, ChapterDoc, Genre, Token, UsjElement, UsjNode, VerseText } from '../model/corpus';
import { tokenize } from './tokenize';

export type { UsjElement, UsjNode } from '../model/corpus';

export interface UsjDoc {
  readonly type: 'USJ';
  readonly version: string;
  readonly content: UsjNode[];
}

//---- stats: what the documents hold beyond the tokens, counted ----

export interface IngestStats {
  footnotes: number; // \f notes (in the document, never tokens)
  xrefs: number; // \x notes (in the document, never tokens)
  wordsOfJesus: number; // \wj spans (text is tokens)
  selah: number; // \qs spans (text is tokens)
  strongAttrs: number; // strong="..." attributes
  wWrapped: number; // \w-wrapped words
  preVerseWordTokens: number; // word tokens with verse=NULL (headings/titles)
  sectionRefs: number; // \r and \mr reference lines (no block)
  altVerseNumbers: number; // \va and \vp numbers on a verse
  verseBridges: number; // \v 17-18 bridged verses (one unit with a range)
  metadataParas: Record<string, number>; // \h, \toc1 … paragraphs (no block)
}

export interface NormalizeResult {
  blocks: Block[];
  tokens: Token[];
  verses: VerseText[];
  stats: IngestStats;
}

//---- the supported markers (ADR-0001 amendment, plan step 7) ----

/** Paragraphs whose text is metadata, not scripture: kept in the document, no block. */
const METADATA_PARAS = new Set(['h', 'toc1', 'toc2', 'toc3', 'ide', 'cl']);
/** Reference lines under a heading (`\r`, `\mr`): kept in the document, no block. */
const REFERENCE_PARAS = new Set(['r', 'mr']);
/** Character styles whose text is scripture surface text. usfm-grammar writes `\+w` as `w`. */
const CHAR_STYLES = new Set(['w', 'add', 'nd', 'sc', 'wj', 'qs', 'tl', 'it', 'bk']);
const NOTES = new Set(['f', 'x']);
/** Markers inside a note, besides the character styles. */
const NOTE_PARTS = new Set(['fr', 'ft', 'fq', 'fqa', 'fl', 'xo', 'xt', 'wh']);

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
 * before the first `\c`. The nodes are not copied or changed.
 */
export function splitChapters(usj: UsjDoc): ChapterDoc[] {
  const docs: ChapterDoc[] = [{ chapter: 0, content: [] }];
  for (const node of usj.content) {
    if (typeof node !== 'string' && node.type === 'chapter') {
      const n = Number(node.number);
      if (!Number.isInteger(n)) throw new Error(`unparseable chapter number "${node.number}"`);
      docs.push({ chapter: n, content: [] });
    }
    docs[docs.length - 1].content.push(node);
  }
  return docs[0].content.length === 0 ? docs.slice(1) : docs;
}

const newStats = (): IngestStats => ({
  footnotes: 0,
  xrefs: 0,
  wordsOfJesus: 0,
  selah: 0,
  strongAttrs: 0,
  wWrapped: 0,
  preVerseWordTokens: 0,
  sectionRefs: 0,
  altVerseNumbers: 0,
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
}

/** Normalize one book's USJ: split it into chapter documents and derive from those. */
export function normalizeUsj(usj: UsjDoc, opts: NormalizeOptions = {}): NormalizeResult {
  return normalizeChapters(splitChapters(usj), opts);
}

/** Derive one book's blocks, tokens, verse text and stats from its chapter documents, in order. */
export function normalizeChapters(docs: readonly ChapterDoc[], opts: NormalizeOptions = {}): NormalizeResult {
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
  let verseText: { chapter: number; verse: number; lastVerse: number; segment: string; text: string } | null = null;

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
    // Unicode NFC before tokenizing (#25): sources arrive decomposed (esp.
    // Greek polytonic & Hebrew); canonical composition makes stored token
    // text — and the draw layer's cmap-advance measure — match the shaped
    // glyph run. Also keeps decomposed base+mark from splitting a word apart
    // (a combining mark is category M, which the tokenizer's punct branch
    // would otherwise capture). Idempotent on already-NFC (ASCII) text.
    const run = buf.normalize('NFC');
    const raw = tokenize(run, { paragraphMarks: !inHeading });
    buf = '';
    // #1/#3: heading tokens carry only a verse EXPLICITLY set inside the
    // heading (never the inherited one); other tokens need a \v seen.
    const effectiveVerse = inHeading ? headingVerse : verse;
    const inVerse = effectiveVerse != null;
    if (inVerse && verseText) verseText.text += ` ${run}`;
    if (raw.length === 0) return;
    const blk = ensureBlock();
    for (const t of raw) {
      const isWord = t.kind === 'word';
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
  };

  const consumeVerseStart = () => {
    const v = pendingVerseStart;
    pendingVerseStart = false;
    return v;
  };

  /** Check a note's parts against the supported list. Note text is never surface text. */
  const checkNote = (nodes: readonly UsjNode[]) => {
    for (const node of nodes) {
      if (typeof node === 'string') continue;
      if (node.type !== 'char' || !(NOTE_PARTS.has(node.marker ?? '') || CHAR_STYLES.has(node.marker ?? ''))) {
        throw unsupported(`marker inside a note (${node.type})`, node.marker);
      }
      checkNote(node.content ?? []);
    }
  };

  /** Walk inline content, appending scripture surface text to the buffer. */
  const walkInline = (nodes: readonly UsjNode[]) => {
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
          if (!CHAR_STYLES.has(marker)) throw unsupported('character style', node.marker);
          if (marker === 'w') stats.wWrapped++;
          if (marker === 'wj') stats.wordsOfJesus++;
          if (marker === 'qs') stats.selah++;
          if (node.strong) stats.strongAttrs++;
          walkInline(node.content ?? []);
          break;
        }
        case 'note': {
          if (!NOTES.has(node.marker ?? '')) throw unsupported('note', node.marker);
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
          break; // \id line — metadata
        case 'chapter': {
          if (node !== first) throw new Error(`chapter ${doc.chapter} document holds a second \\c`);
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
          buf = '';
          if (marker === 'b') break; // stanza break — never a block
          if (REFERENCE_PARAS.has(marker)) {
            stats.sectionRefs++;
            break;
          }
          if (METADATA_PARAS.has(marker)) {
            stats.metadataParas[marker] = (stats.metadataParas[marker] ?? 0) + 1;
            break;
          }
          const genre = blockGenre(marker);
          if (!genre) throw unsupported('paragraph', node.marker);
          pendingMarker = { marker, genre };
          inHeading = genre === 'heading';
          headingVerse = null; // a heading starts unversed — no inheritance
          if (marker === 'd' && verse === null && opts.titleChapters?.has(chapter)) {
            headingVerse = 0; // the scheme numbers this title as verse 0
            wordIndexInVerse = 0;
            startVerseText(0);
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

  return {
    blocks,
    tokens,
    verses: verses.map((v) => ({ ...v, text: v.text.replace(/\s+/g, ' ').trim() })),
    stats,
  };
}

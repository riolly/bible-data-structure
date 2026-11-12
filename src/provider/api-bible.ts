/**
 * The API.Bible adapter (plan step 10): one fetched chapter, as API.Bible's
 * JSON content, to the step 7 chapter document. The format and the request
 * are in research/api-bible.md.
 *
 * The output is the same USJ that `splitChapters` gives for a local edition,
 * so `normalizeChapters` derives its blocks, tokens and verse text with the
 * same tokenizer. A fetch on a reader's device can't stop the way the ingest
 * does, so a marker outside the supported list (ADR-0001, step 7 amendment)
 * keeps its text and is counted in `unsupported`:
 *
 * - a character style becomes a plain run inside its parent,
 * - a paragraph becomes a `\p` paragraph,
 * - a note becomes a `\f` footnote, so its text never joins the verse,
 * - any other element becomes a plain run inside its parent, or a `\p`
 *   paragraph at the top level.
 *
 * No Node-only import here.
 */

import { CHAR_STYLES, METADATA_PARAS, NOTE_PARTS, NOTES, REFERENCE_PARAS } from '../model/corpus';
import { blockGenre, type RawChapterDoc, type RawUsjElement, type RawUsjNode } from '../ingest/normalize';

/** One node of API.Bible's `content-type=json` chapter content. */
export interface ApiBibleNode {
  readonly type: 'tag' | 'text';
  /** A tag's kind: `chapter`, `verse`, `para`, `char`, `note`, `verse-span`. */
  readonly name?: string;
  readonly text?: string;
  /** `style` holds the USFM marker. `number` and `sid` are on chapters and verses, `caller` on notes. */
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly items?: readonly ApiBibleNode[];
}

/** The `data` of `GET /v1/bibles/{bibleId}/chapters/{chapterId}`. */
export interface ApiBibleChapter {
  /** `JHN.3`. */
  readonly id: string;
  readonly bibleId: string;
  /** The book's USFM code, `JHN`. */
  readonly bookId: string;
  /** The chapter number as text, `3`. API.Bible names a book's introduction `intro`. */
  readonly number: string;
  readonly reference: string;
  readonly copyright: string;
  readonly content: readonly ApiBibleNode[];
}

export interface AdaptedChapter {
  /** The chapter document, ready for `normalizeChapters`. */
  readonly doc: RawChapterDoc;
  /**
   * Markers outside the supported list, kept as described above, with how
   * many times each occurred: `char:bdit`, `para:qm1`, `note:fe`, `tag:table`,
   * and `top:<name>` for text or an inline element outside a paragraph.
   */
  readonly unsupported: Readonly<Record<string, number>>;
}

const STYLES = new Set<string>(CHAR_STYLES);
const NOTE_CHARS = new Set<string>([...NOTE_PARTS, ...CHAR_STYLES]);
const NOTE_MARKERS = new Set<string>(NOTES);
const OTHER_PARAS = new Set<string>(['b', ...METADATA_PARAS, ...REFERENCE_PARAS]);

const supportedPara = (marker: string) => blockGenre(marker) !== null || OTHER_PARAS.has(marker);

/** Convert one fetched chapter. Throws only when the response isn't a chapter. */
export function adaptApiBibleChapter(data: ApiBibleChapter): AdaptedChapter {
  const chapter = Number(data.number);
  if (!/^\d+$/.test(data.number) || chapter < 1) throw new Error(`${data.id}: not a numbered chapter`);
  const unsupported: Record<string, number> = {};
  const count = (key: string) => (unsupported[key] = (unsupported[key] ?? 0) + 1);

  const attr = (n: ApiBibleNode, key: string): string | undefined => {
    const v = n.attrs?.[key];
    return typeof v === 'string' ? v : undefined;
  };
  const style = (n: ApiBibleNode) => attr(n, 'style') ?? '';

  const numbered = (n: ApiBibleNode, type: 'chapter' | 'verse'): RawUsjElement => {
    const number = attr(n, 'number');
    if (number === undefined) throw new Error(`${data.id}: a ${type} with no number`);
    const sid = attr(n, 'sid');
    // the tag's items repeat the number as text, which USJ leaves out
    return { type, marker: type === 'chapter' ? 'c' : 'v', number, ...(sid === undefined ? {} : { sid }) };
  };

  const element = (type: string, marker: string, content: RawUsjNode[]): RawUsjElement =>
    content.length > 0 ? { type, marker, content } : { type, marker };

  /** Content inside a note: only note parts and character styles. */
  const inNote = (nodes: readonly ApiBibleNode[]): RawUsjNode[] =>
    nodes.flatMap((n): RawUsjNode[] => {
      if (n.type === 'text') return [n.text ?? ''];
      if (n.name === 'char' && NOTE_CHARS.has(style(n))) return [element('char', style(n), inNote(n.items ?? []))];
      count(n.name === 'char' ? `char:${style(n)}` : `tag:${n.name}`);
      return inNote(n.items ?? []);
    });

  /** Content inside a paragraph: text, verses, character styles and notes. */
  const inline = (nodes: readonly ApiBibleNode[]): RawUsjNode[] =>
    nodes.flatMap((n): RawUsjNode[] => {
      if (n.type === 'text') return [n.text ?? ''];
      switch (n.name) {
        case 'verse':
          return [numbered(n, 'verse')];
        case 'verse-span':
          // only with `include-verse-spans=true`: a wrapper that names the verse
          return inline(n.items ?? []);
        case 'char':
          if (STYLES.has(style(n))) return [element('char', style(n), inline(n.items ?? []))];
          count(`char:${style(n)}`);
          return inline(n.items ?? []);
        case 'note': {
          const marker = NOTE_MARKERS.has(style(n)) ? style(n) : 'f';
          if (marker !== style(n)) count(`note:${style(n)}`);
          const caller = attr(n, 'caller');
          const content = inNote(n.items ?? []);
          return [{ type: 'note', marker, ...(caller === undefined ? {} : { caller }), ...(content.length > 0 ? { content } : {}) }];
        }
        default:
          count(`tag:${n.name}`);
          return inline(n.items ?? []);
      }
    });

  const content: RawUsjNode[] = [];
  for (const n of data.content) {
    if (n.type === 'tag' && n.name === 'chapter') {
      content.push(numbered(n, 'chapter'));
    } else if (n.type === 'tag' && n.name === 'para') {
      const marker = supportedPara(style(n)) ? style(n) : 'p';
      if (marker !== style(n)) count(`para:${style(n)}`);
      content.push(element('para', marker, inline(n.items ?? [])));
    } else if (n.type === 'text' && !(n.text ?? '').trim()) {
      content.push(n.text ?? '');
    } else {
      // text or an inline element outside a paragraph: wrapped in a `\p`
      count(`top:${n.type === 'text' ? 'text' : n.name}`);
      content.push(element('para', 'p', inline([n])));
    }
  }
  return { doc: { chapter, content }, unsupported };
}

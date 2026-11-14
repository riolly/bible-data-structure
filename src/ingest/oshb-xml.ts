/**
 * Upstream OSHB (github.com/openscriptures/morphhb, `wlc/*.xml`, OSIS) to
 * USFM plus the qere readings (ADR-0007). ebible's `hboWLC` kept only the
 * ketiv and dropped every qere (research/hebrew-ketiv-qere.md).
 *
 * The verse text is the written text, as in ebible's copy:
 *
 *   <w>                        → its text, without OSHB's `/` morpheme breaks
 *   <w type="x-ketiv">         → its text: the ketiv stays in the verse
 *   <seg> inside a <w>         → its text (large, small and suspended letters)
 *   maqqef, sof pasuq, paseq,
 *   reversed nun <seg>         → its character, spaced as in the XML
 *   pe and samekh <seg>        → ` פ ` and ` ס `, punctuation under ADR-0004 rule 6
 *   <note type="variant">      → a Reading on the ketiv words before it, not text
 *   other <note>               → dropped (OSHB's textual and accent notes)
 *   <chapter>                  → \c, then one \p, as in ebible's copy
 *
 * Each word's `id`, lemma and morphology (OSHB data, CC BY 4.0) are returned
 * beside the text as `OshbWord`s, written words and qere words alike. They are
 * the Hebrew original words (ADR-0003, plan step 11), and the ids are what an
 * alignment points at.
 */

import type { Reading, Token } from '../model/corpus';
import { OSIS_BOOKS } from '../model/osis';
import { storedText } from './text-form';
import { tokenize } from './tokenize';

/** Upstream file name (without `.xml`, an OSIS name) → USFM book code: the 39 books up to Malachi. */
export const OSHB_BOOKS: Readonly<Record<string, string>> = Object.fromEntries(
  OSIS_BOOKS.slice(0, OSIS_BOOKS.findIndex(([, usfm]) => usfm === 'MAL') + 1),
);

/** One OSHB `<w>`: a written word of a verse, or a word of a qere. */
export interface OshbWord {
  /** OSHB's word id (`09wci`): the Original Word's `ow_id` (ADR-0003). */
  readonly id: string;
  /** OSHB's lemma: Strong's numbers and prefix letters, `/` between morphemes (`c/1961`, `834 a`). */
  readonly lemma: string;
  /** OSHB's morphology code, `/` between morphemes (`HC/Vqw3ms`). */
  readonly morph: string;
  /** The word as tokenized: as OSHB wrote it (ADR-0004 v1.6), without morpheme breaks. */
  readonly text: string;
}

/** A written OSHB word and the word token it is in. */
export interface OshbWrittenWord extends OshbWord {
  /**
   * The index of the word token it is in. Two `<w>` with nothing between them
   * are one written word that OSHB divides for exegesis (`לְ/מַ` + `בָּ/רִ֥אשׁוֹנָ֖ה`
   * in 1CH 15:13), so they share an index.
   */
  readonly wordIndex: number;
}

/** A verse's written OSHB words, in order: each word token holds one or, rarely, two. */
export interface OshbVerse {
  readonly book: string;
  readonly chapter: number;
  readonly verse: number;
  readonly words: readonly OshbWrittenWord[];
}

/** A qere reading as the converter finds it, before it is checked against the stored tokens. */
export interface OshbReading extends Reading {
  /** The reading's words with their lemma and morphology, in order. Their ids are `owIds`. */
  readonly qere: readonly OshbWord[];
  /** The ketiv words the reading covers, tokenized as the verse is. Checked against the tokens, not stored. */
  readonly ketiv: readonly string[];
  /** Every written word of the reading's verse, as the converter tokenized it. Checked against the tokens, not stored. */
  readonly verseWords: readonly string[];
}

/** Characters a `<seg>` outside a word stands for, by type. */
const SEG_TEXT: Readonly<Record<string, string>> = {
  'x-maqqef': '־',
  'x-sof-pasuq': '׃',
  'x-paseq': '׀',
  'x-reversednun': '׆',
};
const PARAGRAPH_SEGS: Readonly<Record<string, string>> = { 'x-pe': 'פ', 'x-samekh': 'ס' };

const BOOK_ITEM =
  /<chapter osisID="[^"]*\.(\d+)">|<verse osisID="[^"]*\.(\d+)\.(\d+)">([\s\S]*?)<\/verse>|<\/chapter>|<div type="book"[^>]*>|<\/div>|(\S)/g;
const VERSE_ITEM =
  /<note\b([^>]*)>([\s\S]*?)<\/note>|<w\b([^>]*)>([\s\S]*?)<\/w>|<seg type="([^"]+)"(?: subType="x-ketiv")?>([^<]*)<\/seg>|(\s+)|(\S)/g;
const RDG_ITEM = /<w\b([^>]*)>([\s\S]*?)<\/w>|<seg type="([^"]+)">([^<]*)<\/seg>|(\s+)|(\S)/g;

/** A `<w>`'s text: inner `<seg>` letters kept, morpheme breaks dropped. */
const wordText = (inner: string, where: string) => {
  const text = inner.replace(/<seg type="x-(?:large|small|suspended)">([^<]*)<\/seg>/g, '$1');
  if (/[<>&]/.test(text)) throw new Error(`${where}: unexpected markup in a word: ${inner}`);
  return text.replaceAll('/', '');
};

const words = (text: string) =>
  tokenize(storedText(text), { paragraphMarks: true })
    .filter((t) => t.kind === 'word')
    .map((t) => t.text);

const ATTR = {
  type: /\btype="([^"]*)"/,
  id: /\bid="([^"]*)"/,
  lemma: /\blemma="([^"]*)"/,
  morph: /\bmorph="([^"]*)"/,
} as const;
const attr = (attrs: string, name: keyof typeof ATTR) => ATTR[name].exec(attrs)?.[1];

/** Letters and their marks only: one word token under ADR-0004 rule 1, without running the tokenizer. */
const ONE_WORD = /^\p{L}[\p{L}\p{M}]*$/u;

/** A `<w>` as an OshbWord. Its text must be one word token, or word indexes would drift from the tokens. */
function oshbWord(attrs: string, text: string, where: string): OshbWord {
  const [id, lemma, morph] = [attr(attrs, 'id'), attr(attrs, 'lemma'), attr(attrs, 'morph')];
  if (!id || !lemma || !morph) throw new Error(`${where}: a word without an id, lemma or morph: ${text}`);
  const stored = storedText(text);
  if (!ONE_WORD.test(stored)) throw new Error(`${where}: word ${id} "${text}" is not one word token`);
  return { id, lemma, morph, text: stored };
}

/**
 * Written words grouped by token, each group given its token's index. Checked
 * against the verse's own tokenization when there is one (a verse with a
 * qere); the ingest checks every verse against the stored tokens
 * (original-words.ts).
 */
function placeWritten(groups: readonly OshbWord[][], verseWords: readonly string[] | null, where: string): OshbWrittenWord[] {
  if (verseWords) {
    const joined = groups.map((g) => (g.length === 1 ? g[0].text : storedText(g.map((w) => w.text).join(''))));
    if (joined.length !== verseWords.length || joined.some((w, i) => w !== verseWords[i])) {
      throw new Error(`${where}: the verse's words are not its <w> elements`);
    }
  }
  return groups.flatMap((g, wordIndex) => g.map((w) => ({ ...w, wordIndex })));
}

/** One book's OSIS XML → `\c`/`\p`/`\v` USFM and the readings of its ketiv/qere notes. */
export function oshbXmlToUsfm(
  xml: string,
  code: string,
): { usfm: string; readings: OshbReading[]; verses: OshbVerse[] } {
  const start = xml.indexOf('<div type="book"');
  const end = xml.lastIndexOf('</osisText>');
  if (start < 0 || end < 0) throw new Error(`${code}: no <div type="book"> in the OSIS file`);
  const out: string[] = [`\\id ${code} Westminster Leningrad Codex, from the upstream OSHB XML`];
  const readings: OshbReading[] = [];
  const verses: OshbVerse[] = [];
  for (const m of xml.slice(start, end).matchAll(BOOK_ITEM)) {
    const [, chapter, c, v, body, stray] = m;
    if (stray) throw new Error(`${code}: text outside a verse near "${xml.slice(start + m.index, start + m.index + 40)}"`);
    if (chapter) out.push(`\\c ${Number(chapter)}`, '\\p');
    else if (body !== undefined) {
      const verse = convertVerse(body, `${code} ${c}:${v}`);
      out.push(`\\v ${Number(v)} ${verse.text}`);
      for (const r of verse.readings) readings.push({ book: code, chapter: Number(c), verse: Number(v), ...r });
      verses.push({ book: code, chapter: Number(c), verse: Number(v), words: verse.words });
    }
  }
  return { usfm: out.join('\n') + '\n', readings, verses };
}

type VerseReading = Omit<OshbReading, 'book' | 'chapter' | 'verse'>;

function convertVerse(body: string, where: string): { text: string; readings: VerseReading[]; words: OshbWrittenWord[] } {
  let text = '';
  const readings: VerseReading[] = [];
  /** Written words, one group per word token. */
  const written: OshbWord[][] = [];
  /** Where the last `<w>` ended: a `<w>` that starts there joins its word. */
  let wordEnd = -1;
  /** Word index where the open run of ketiv words starts. */
  let ketivStart: number | null = null;
  /** The words before each reading, to check against the whole verse's words at the end. */
  const before: string[][] = [];
  let ketivText = '';
  for (const m of body.matchAll(VERSE_ITEM)) {
    const [, noteAttrs, note, wAttrs, w, segType, seg, space, stray] = m;
    if (stray) throw new Error(`${where}: text outside an element near "${body.slice(m.index, m.index + 40)}"`);
    if (space) {
      text += ' ';
      if (ketivStart !== null) ketivText += ' ';
    } else if (w !== undefined) {
      const t = wordText(w, where);
      const word = oshbWord(wAttrs, t, where);
      if (m.index === wordEnd) written[written.length - 1].push(word);
      else written.push([word]);
      wordEnd = m.index + m[0].length;
      if (attr(wAttrs, 'type') === 'x-ketiv') {
        if (ketivStart === null) {
          before.push(words(text));
          ketivStart = before[before.length - 1].length;
        }
        ketivText += t;
      } else if (ketivStart !== null) {
        throw new Error(`${where}: a ketiv with no qere note before "${t}"`);
      }
      text += t;
    } else if (segType !== undefined) {
      if (PARAGRAPH_SEGS[segType] !== undefined) {
        if (ketivStart !== null) throw new Error(`${where}: a paragraph mark inside a ketiv`);
        text += ` ${PARAGRAPH_SEGS[segType]} `;
      } else if (SEG_TEXT[segType] !== undefined && seg === SEG_TEXT[segType]) {
        text += seg;
        if (ketivStart !== null) {
          if (segType !== 'x-maqqef') throw new Error(`${where}: ${segType} inside a ketiv`);
          ketivText += seg;
        }
      } else {
        throw new Error(`${where}: unknown <seg type="${segType}">${seg}</seg>`);
      }
    } else if (attr(noteAttrs, 'type') === 'variant') {
      const ketiv = words(ketivText);
      if (ketivStart === null) before.push(words(text));
      readings.push({
        wordIndex: ketivStart ?? before[before.length - 1].length,
        wordCount: ketiv.length,
        kind: 'qere',
        ...qere(note, where),
        ketiv,
        verseWords: [],
      });
      ketivStart = null;
      ketivText = '';
    } // other notes are dropped, also between a ketiv and its qere (JER 48:44)
  }
  if (ketivStart !== null) throw new Error(`${where}: a ketiv with no qere note`);
  if (readings.length === 0) {
    return { text: text.replace(/\s+/g, ' ').trim(), readings, words: placeWritten(written, null, where) };
  }
  // A word count taken mid-verse must agree with the whole verse's tokenization.
  const verseWords = words(text);
  const placed = placeWritten(written, verseWords, where);
  for (const [i, r] of readings.entries()) {
    const covered = verseWords.slice(r.wordIndex, r.wordIndex + r.wordCount);
    if (before[i].join(' ') !== verseWords.slice(0, r.wordIndex).join(' ') || covered.join(' ') !== r.ketiv.join(' ')) {
      throw new Error(`${where}: reading ${i + 1} does not fall on word boundaries of the verse`);
    }
  }
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    readings: readings.map((r) => ({ ...r, verseWords })),
    words: placed,
  };
}

/**
 * Every reading must sit where its converter put it (ADR-0007): the stored
 * words of its verse are the words the converter counted, so its range covers
 * its ketiv and a reading with no written word sits before the same word.
 * Stops the ingest otherwise.
 */
export function checkReadings(code: string, readings: readonly OshbReading[], tokens: readonly Token[]): void {
  if (readings.length === 0) return;
  const verses = new Map<string, string[]>();
  for (const t of tokens) {
    if (t.wordIndex === null) continue;
    const key = `${t.chapter}:${t.verse}${t.segment}`;
    const stored = verses.get(key) ?? verses.set(key, []).get(key)!;
    if (stored.length !== t.wordIndex) throw new Error(`${code} ${key}: word indexes are not dense`);
    stored.push(t.text);
  }
  for (const r of readings) {
    const key = `${r.chapter}:${r.verse}${r.segment ?? ''}`;
    const stored = verses.get(key) ?? [];
    const covered = stored.slice(r.wordIndex, r.wordIndex + r.wordCount);
    if (
      stored.join(' ') !== r.verseWords.join(' ') ||
      r.wordIndex > stored.length ||
      covered.length !== r.wordCount ||
      covered.join(' ') !== r.ketiv.join(' ')
    ) {
      throw new Error(
        `${code} ${key}!${r.wordIndex + 1}: reading "${r.text}" was placed among the words "${r.verseWords.join(' ')}", ` +
          `the tokens have "${stored.join(' ')}"`,
      );
    }
  }
}

/** The qere of a `<note type="variant">`: its pointed text, its words and their ids. */
function qere(note: string, where: string): { text: string; owIds: readonly string[]; qere: readonly OshbWord[] } {
  const rdg = /<rdg type="x-qere"(?:\/>|>([\s\S]*?)<\/rdg>)/.exec(note);
  if (!rdg) throw new Error(`${where}: a variant note without a qere`);
  if (note.replace(/<catchWord>[^<]*<\/catchWord>/, '').replace(rdg[0], '').trim()) {
    throw new Error(`${where}: unexpected content in a variant note: ${note}`);
  }
  let text = '';
  const owIds: string[] = [];
  const qereWords: OshbWord[] = [];
  for (const m of (rdg[1] ?? '').matchAll(RDG_ITEM)) {
    const [, wAttrs, w, segType, seg, space, stray] = m;
    if (stray) throw new Error(`${where}: text outside an element in a qere near "${(rdg[1] ?? '').slice(m.index, m.index + 40)}"`);
    if (space) text += ' ';
    else if (w !== undefined) {
      const id = attr(wAttrs, 'id');
      if (!id) throw new Error(`${where}: a qere word without an id`);
      owIds.push(id);
      const t = wordText(w, where);
      qereWords.push(oshbWord(wAttrs, t, where));
      text += t;
    } else if (SEG_TEXT[segType] !== undefined && seg === SEG_TEXT[segType]) text += seg;
    else throw new Error(`${where}: unknown <seg type="${segType}"> in a qere`);
  }
  return { text: storedText(text.replace(/\s+/g, ' ').trim()), owIds, qere: qereWords };
}

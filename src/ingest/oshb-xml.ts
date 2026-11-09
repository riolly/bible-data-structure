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
 * Lemma and morphology attributes are dropped (OSHB data, CC BY 4.0). Only the
 * qere words' `id`s are kept, as the ids an alignment points at (ADR-0003).
 */

import type { Reading } from '../model/corpus';
import { tokenize } from './tokenize';

/** Upstream file name (without `.xml`) → USFM book code. */
export const OSHB_BOOKS: Readonly<Record<string, string>> = {
  Gen: 'GEN', Exod: 'EXO', Lev: 'LEV', Num: 'NUM', Deut: 'DEU', Josh: 'JOS', Judg: 'JDG', Ruth: 'RUT',
  '1Sam': '1SA', '2Sam': '2SA', '1Kgs': '1KI', '2Kgs': '2KI', '1Chr': '1CH', '2Chr': '2CH', Ezra: 'EZR',
  Neh: 'NEH', Esth: 'EST', Job: 'JOB', Ps: 'PSA', Prov: 'PRO', Eccl: 'ECC', Song: 'SNG', Isa: 'ISA',
  Jer: 'JER', Lam: 'LAM', Ezek: 'EZK', Dan: 'DAN', Hos: 'HOS', Joel: 'JOL', Amos: 'AMO', Obad: 'OBA',
  Jonah: 'JON', Mic: 'MIC', Nah: 'NAM', Hab: 'HAB', Zeph: 'ZEP', Hag: 'HAG', Zech: 'ZEC', Mal: 'MAL',
};

/** A qere reading as the converter finds it, before it is checked against the stored tokens. */
export interface OshbReading extends Reading {
  /** The ketiv words the reading covers, tokenized as the verse is. Checked against the tokens, not stored. */
  readonly ketiv: readonly string[];
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
  tokenize(text.normalize('NFC'), { paragraphMarks: true })
    .filter((t) => t.kind === 'word')
    .map((t) => t.text);

const ATTR = { type: /\btype="([^"]*)"/, id: /\bid="([^"]*)"/ } as const;
const attr = (attrs: string, name: keyof typeof ATTR) => ATTR[name].exec(attrs)?.[1];

/** One book's OSIS XML → `\c`/`\p`/`\v` USFM and the readings of its ketiv/qere notes. */
export function oshbXmlToUsfm(xml: string, code: string): { usfm: string; readings: OshbReading[] } {
  const start = xml.indexOf('<div type="book"');
  const end = xml.lastIndexOf('</osisText>');
  if (start < 0 || end < 0) throw new Error(`${code}: no <div type="book"> in the OSIS file`);
  const out: string[] = [`\\id ${code} Westminster Leningrad Codex, from the upstream OSHB XML`];
  const readings: OshbReading[] = [];
  for (const m of xml.slice(start, end).matchAll(BOOK_ITEM)) {
    const [, chapter, c, v, body, stray] = m;
    if (stray) throw new Error(`${code}: text outside a verse near "${xml.slice(start + m.index, start + m.index + 40)}"`);
    if (chapter) out.push(`\\c ${Number(chapter)}`, '\\p');
    else if (body !== undefined) {
      const verse = convertVerse(body, `${code} ${c}:${v}`);
      out.push(`\\v ${Number(v)} ${verse.text}`);
      for (const r of verse.readings) readings.push({ book: code, chapter: Number(c), verse: Number(v), ...r });
    }
  }
  return { usfm: out.join('\n') + '\n', readings };
}

type VerseReading = Omit<OshbReading, 'book' | 'chapter' | 'verse'>;

function convertVerse(body: string, where: string): { text: string; readings: VerseReading[] } {
  let text = '';
  const readings: VerseReading[] = [];
  /** Word index where the open run of ketiv words starts. */
  let ketivStart: number | null = null;
  let ketivText = '';
  for (const m of body.matchAll(VERSE_ITEM)) {
    const [, noteAttrs, note, wAttrs, w, segType, seg, space, stray] = m;
    if (stray) throw new Error(`${where}: text outside an element near "${body.slice(m.index, m.index + 40)}"`);
    if (space) {
      text += ' ';
      if (ketivStart !== null) ketivText += ' ';
    } else if (w !== undefined) {
      const t = wordText(w, where);
      if (attr(wAttrs, 'type') === 'x-ketiv') {
        ketivStart ??= words(text).length;
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
      readings.push({
        wordIndex: ketivStart ?? words(text).length,
        wordCount: ketiv.length,
        kind: 'qere',
        ...qere(note, where),
        ketiv,
      });
      ketivStart = null;
      ketivText = '';
    } // other notes are dropped, also between a ketiv and its qere (JER 48:44)
  }
  if (ketivStart !== null) throw new Error(`${where}: a ketiv with no qere note`);
  return { text: text.replace(/\s+/g, ' ').trim(), readings };
}

/** The qere of a `<note type="variant">`: its pointed text and the ids of its words. */
function qere(note: string, where: string): { text: string; owIds: readonly string[] } {
  const rdg = /<rdg type="x-qere"(?:\/>|>([\s\S]*?)<\/rdg>)/.exec(note);
  if (!rdg) throw new Error(`${where}: a variant note without a qere`);
  if (note.replace(/<catchWord>[^<]*<\/catchWord>/, '').replace(rdg[0], '').trim()) {
    throw new Error(`${where}: unexpected content in a variant note: ${note}`);
  }
  let text = '';
  const owIds: string[] = [];
  for (const m of (rdg[1] ?? '').matchAll(RDG_ITEM)) {
    const [, wAttrs, w, segType, seg, space, stray] = m;
    if (stray) throw new Error(`${where}: text outside an element in a qere near "${(rdg[1] ?? '').slice(m.index, m.index + 40)}"`);
    if (space) text += ' ';
    else if (w !== undefined) {
      const id = attr(wAttrs, 'id');
      if (!id) throw new Error(`${where}: a qere word without an id`);
      owIds.push(id);
      text += wordText(w, where);
    } else if (SEG_TEXT[segType] !== undefined && seg === SEG_TEXT[segType]) text += seg;
    else throw new Error(`${where}: unknown <seg type="${segType}"> in a qere`);
  }
  return { text: text.replace(/\s+/g, ' ').trim().normalize('NFC'), owIds };
}

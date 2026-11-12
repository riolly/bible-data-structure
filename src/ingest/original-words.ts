/**
 * The original words of SBLGNT (ADR-0003 and its step 11 amendment): each
 * word with its source id, lemma, Strong's numbers, morphology and gloss,
 * from MACULA Greek's SBLGNT edition, joined word by word.
 *
 * A join holds only where the words are the same words: the ingest stops on
 * any verse whose word count differs, or any word whose letters differ,
 * outside the counted exceptions below.
 */

import { readFileSync } from 'node:fs';

import type { OriginalWord, Token } from '../model/corpus';

/** A word MACULA's text has where ours differs, accepted as the same word. Each must occur once. */
export interface MaculaException {
  /** Our word address without the scheme: `JHN 8:5!5`. */
  readonly at: string;
  readonly ours: string;
  readonly macula: string;
  readonly why: string;
}

export const GREEK_EXCEPTIONS: readonly MaculaException[] = [
  {
    at: 'JHN 8:5!5',
    ours: 'Μωσῆς',
    macula: 'Μωϋσῆς',
    why: 'MACULA built its SBLGNT from LogosBible/SBLGNT at 736fdc7 (2023-07-10); our pin d7f35ad spells the name without the diaeresis',
  },
];

/** One MACULA word: its morphemes' columns, in order (Greek words have one). */
export interface MaculaWord {
  readonly id: string;
  /** The morphemes' text joined, NFC. */
  readonly text: string;
  readonly rows: readonly Readonly<Record<string, string>>[];
}

/** The columns the joins read. Every one must be in the header. */
const MACULA_COLUMNS = ['text', 'gloss', 'english'] as const;
const GREEK_COLUMNS = ['lemma', 'strong', 'morph'] as const;

/**
 * A MACULA TSV as words by verse (`GEN 1:1`), in order. Rows of one word share
 * its `ref`. Only the columns the joins read are kept: the Hebrew file is 84 MB.
 */
export function readMacula(path: string): Map<string, MaculaWord[]> {
  const lines = readFileSync(path, 'utf8').split('\n');
  const header = lines[0].replace(/\r$/, '').split('\t');
  const refAt = header.indexOf('ref');
  const idAt = header.indexOf('xml:id');
  const wanted = [...MACULA_COLUMNS, ...(header.includes('strongnumberx') ? [] : GREEK_COLUMNS)];
  const missing = ['xml:id', 'ref', ...wanted].filter((c) => !header.includes(c));
  if (missing.length > 0) throw new Error(`${path}: no ${missing.join(', ')} column`);
  const keep = wanted.map((c) => [c, header.indexOf(c)] as const);
  const verses = new Map<string, MaculaWord[]>();
  const wordNumbers = new Map<MaculaWord, number>();
  let last: { ref: string; word: MaculaWord & { rows: Record<string, string>[] } } | null = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (line === '') continue;
    const cells = line.split('\t');
    const row: Record<string, string> = {};
    for (const [c, j] of keep) row[c] = cells[j] ?? '';
    const ref = cells[refAt];
    if (last && last.ref === ref) {
      last.word.rows.push(row);
      (last.word as { text: string }).text = (last.word.text + row.text).normalize('NFC');
      continue;
    }
    const bang = ref.indexOf('!');
    if (bang < 0) throw new Error(`${path}:${i + 1}: ref "${ref}" has no word number`);
    const verse = ref.slice(0, bang);
    const word = { id: cells[idAt], text: row.text.normalize('NFC'), rows: [row] };
    const list = verses.get(verse) ?? verses.set(verse, []).get(verse)!;
    // Word numbers rise, with gaps: MACULA Hebrew skips the number of a ketiv it doesn't read (GEN 8:17!14).
    const n = Number(ref.slice(bang + 1));
    if (!(n > (list.length > 0 ? wordNumbers.get(list[list.length - 1])! : 0))) {
      throw new Error(`${path}:${i + 1}: ${ref} is out of order`);
    }
    wordNumbers.set(word, n);
    list.push(word);
    last = { ref, word };
  }
  return verses;
}

/** A word's letters without accents, points, case or punctuation, for comparing two copies of one text. */
export const letters = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[^\p{Ll}\p{Lu}\p{Lo}]/gu, '')
    .toLowerCase();

/** A Strong's number as a join key: `H` or `G`, then the number without zeros in front or letters after. 0 is none. */
export function strongKey(lang: 'H' | 'G', raw: string): string | null {
  const m = /^(\d+)/.exec(raw.trim());
  return m && Number(m[1]) > 0 ? `${lang}${Number(m[1])}` : null;
}

/** A MACULA word's gloss: each morpheme's `gloss`, else its `english`, joined. MACULA Hebrew writes `he.created`. */
export function maculaGloss(w: MaculaWord, lang: 'H' | 'G'): string | null {
  const parts = w.rows
    .map((r) => r.gloss?.trim() || r.english?.trim() || '')
    .map((g) => (lang === 'H' ? g.replaceAll('.', ' ') : g))
    .filter((g) => g !== '');
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Word tokens of one book by verse key, `GEN 1:1` (with the segment letter), in word order. */
function wordsByVerse(code: string, tokens: readonly Token[]): Map<string, string[]> {
  const byVerse = new Map<string, string[]>();
  for (const t of tokens) {
    if (t.wordIndex === null || t.verse === null) continue;
    const key = `${code} ${t.chapter}:${t.verse}${t.segment}`;
    const list = byVerse.get(key) ?? byVerse.set(key, []).get(key)!;
    if (list.length !== t.wordIndex) throw new Error(`${key}: word indexes are not dense`);
    list.push(t.text);
  }
  return byVerse;
}

export interface JoinStats {
  /** Words with no gloss. */
  readonly noGloss: number;
}

/** SBLGNT's original words for one book, from MACULA Greek. Stops on any word that isn't ours. */
export function greekWords(
  code: string,
  tokens: readonly Token[],
  macula: ReadonlyMap<string, MaculaWord[]>,
  exceptions: readonly MaculaException[] = GREEK_EXCEPTIONS,
  used = new Set<string>(),
): { words: OriginalWord[]; stats: JoinStats } {
  const words: OriginalWord[] = [];
  let noGloss = 0;
  for (const [key, ours] of wordsByVerse(code, tokens)) {
    const theirs = macula.get(key);
    if (!theirs || theirs.length !== ours.length) {
      throw new Error(`${key}: MACULA Greek has ${theirs?.length ?? 0} words, the SBLGNT ${ours.length}`);
    }
    const { chapter, verse, segment } = parseKey(key);
    ours.forEach((text, i) => {
      const w = theirs[i];
      const at = `${key}!${i + 1}`;
      if (letters(text) !== letters(w.text)) {
        const ex = exceptions.find((e) => e.at === at && e.ours === text && e.macula === w.text);
        if (!ex) throw new Error(`${at}: the SBLGNT has "${text}", MACULA Greek "${w.text}"`);
        used.add(at);
      }
      const row = w.rows[0];
      if (!row.lemma || !row.morph) throw new Error(`${at}: MACULA Greek has no lemma or morph for "${w.text}"`);
      // a compound is `5228+1537+4053`; `0` marks a word Strong's dictionary lacks
      const strongs = (row.strong ?? '').split('+').map((n) => strongKey('G', n));
      if (strongs.some((n) => n === null) && row.strong !== '0') {
        throw new Error(`${at}: MACULA Greek's Strong's number "${row.strong}" for "${w.text}" is not a number`);
      }
      const gloss = maculaGloss(w, 'G');
      if (gloss === null) noGloss++;
      words.push({
        owId: w.id,
        book: code,
        chapter,
        verse,
        segment,
        wordIndex: i,
        seq: i,
        kind: 'word',
        text,
        lemma: row.lemma,
        strongs: strongs.filter((n) => n !== null),
        morph: row.morph,
        gloss,
      });
    });
  }
  return { words, stats: { noGloss } };
}

/** Every counted exception must have been used, or it is stale. */
export function checkExceptionsUsed(exceptions: readonly MaculaException[], used: ReadonlySet<string>): void {
  const stale = exceptions.filter((e) => !used.has(e.at));
  if (stale.length > 0) throw new Error(`MACULA exceptions that matched no word: ${stale.map((e) => e.at).join(', ')}`);
}

function parseKey(key: string): { chapter: number; verse: number; segment: string } {
  const m = /^\S+ (\d+):(\d+)([a-z]?)$/.exec(key);
  if (!m) throw new Error(`bad verse key "${key}"`);
  return { chapter: Number(m[1]), verse: Number(m[2]), segment: m[3] };
}

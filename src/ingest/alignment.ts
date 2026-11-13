/**
 * Strong's numbers on the BSB's English words (plan step 12, ADR-0003 step 12
 * amendment), from Clear Bible's manual alignments of the BSB to MACULA's
 * SBLGNT words and WLC morphemes (research/word-tags.md).
 *
 * Clear aligned the BSB of 2024-09-04, and ours is newer, so Clear's words
 * join to ours verse by verse on their longest common sequence of words. Each
 * id Clear aligns to must be a step 11 word or morpheme (`HubPart`): the
 * ingest stops on any other, and on a verse Clear has and our BSB lacks.
 */

import { readFileSync } from 'node:fs';

import { PROTESTANT, canonBookCodes } from '../model/canon';
import type { HubPart } from './original-words';

/** Clear's book numbers are the 66 books in Protestant order: `40` is MAT. */
const BOOK_CODES = canonBookCodes(PROTESTANT);

/** A verse key, `GEN 1:1`, from a Clear id `BBCCCVVV…`. */
function verseKey(id: string): string {
  const code = BOOK_CODES[Number(id.slice(0, 2)) - 1];
  if (!code || !/^\d{11}$/.test(id)) throw new Error(`Clear id "${id}" is not BBCCCVVVWWW`);
  return `${code} ${Number(id.slice(2, 5))}:${Number(id.slice(5, 8))}`;
}

/**
 * Clear's BSB words (`nt_BSB.tsv`, `ot_BSB.tsv`) by verse, in order, without
 * the punctuation it marks `exclude`. Psalm titles are verse 0.
 */
export function readClearWords(paths: readonly string[]): Map<string, { id: string; text: string }[]> {
  const verses = new Map<string, { id: string; text: string }[]>();
  for (const path of paths) {
    const lines = readFileSync(path, 'utf8').split('\n');
    const header = lines[0].replace(/\r$/, '').split('\t');
    const [idAt, textAt, excludeAt] = ['id', 'text', 'exclude'].map((c) => header.indexOf(c));
    if (Math.min(idAt, textAt, excludeAt) < 0) throw new Error(`${path}: no id, text or exclude column`);
    for (const line of lines.slice(1)) {
      if (line.trim() === '') continue;
      const cells = line.replace(/\r$/, '').split('\t');
      if (cells[excludeAt]) continue;
      const key = verseKey(cells[idAt]);
      (verses.get(key) ?? verses.set(key, []).get(key)!).push({ id: cells[idAt], text: cells[textAt] });
    }
  }
  return verses;
}

/** What Clear aligns one target word to: the source ids, and every target word in the same records. */
export interface ClearLink {
  readonly sources: readonly string[];
  readonly group: readonly string[];
}

/** Clear's alignment records (Scripture Burrito JSON) by target id, in record order. */
export function readClearAlignment(paths: readonly string[]): Map<string, ClearLink> {
  const links = new Map<string, { sources: string[]; group: string[] }>();
  for (const path of paths) {
    const { records } = JSON.parse(readFileSync(path, 'utf8')) as { records: { source: string[]; target: string[] }[] };
    for (const r of records) {
      for (const t of r.target) {
        const link = links.get(t) ?? links.set(t, { sources: [], group: [] }).get(t)!;
        link.sources.push(...r.source);
        link.group.push(...r.target);
      }
    }
  }
  return links;
}

/** A word's letters and digits without accents or case, for comparing two revisions of one text. */
const wordKey = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();

/**
 * For each of our words, the index of the same word in theirs, or null: the
 * longest common sequence of the two verses' words. Where the verses differ,
 * a word joins only inside a run of two or more joined words, or where both
 * verses start or end on it. A lone common word (`the`, `one`) in a reworded
 * phrase can belong to another phrase in theirs, and would take its numbers
 * (2SA 18:32, ACT 19:15).
 */
export function joinWords(ours: readonly string[], theirs: readonly string[]): (number | null)[] {
  const a = ours.map(wordKey);
  const b = theirs.map(wordKey);
  if (a.length === b.length && a.every((w, i) => w === b[i])) return a.map((_, i) => i);
  // lcs[i][j]: the longest common sequence of a[i..] and b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: (number | null)[] = a.map(() => null);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) out[i++] = j++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  const last = { a: a.length - 1, b: b.length - 1 };
  return out.map((j, i) => {
    if (j === null) return null;
    const inRun = (i > 0 && out[i - 1] === j - 1) || (i < last.a && out[i + 1] === j + 1);
    const anchored = (i === 0 && j === 0) || (i === last.a && j === last.b);
    return inRun || anchored ? j : null;
  });
}

/**
 * The most of our BSB words that may find no word in Clear's revision. 1,824
 * did on 2026-11-13. A re-pin of either side that rewords more stops the
 * ingest, so the revision gap is looked at, not only logged.
 */
const MAX_CHANGED = 4000;

/** One original word an English word translates. `seq` orders a word's rows. */
export interface WordAlignment {
  readonly book: string;
  readonly chapter: number;
  readonly verse: number;
  readonly segment: string;
  readonly wordIndex: number;
  readonly seq: number;
  readonly source: HubPart['source'];
  readonly owId: string;
  /** The Strong's numbers of the parts the word aligns to within this original word. */
  readonly strongs: readonly string[];
}

export interface AlignStats {
  /** Our words. */
  readonly words: number;
  /** Words with at least one row. */
  readonly aligned: number;
  /** Words Clear has but aligns to nothing. */
  readonly unaligned: number;
  /** Words with no counterpart in Clear's revision of the BSB. */
  readonly changed: number;
  /** Words that joined Clear's, but another word in Clear's group didn't. */
  readonly split: number;
}

/**
 * The alignment rows of an edition's words. `ours` is its word tokens' text by
 * verse key (`GEN 1:1`), in word order.
 *
 * A joined word takes its Clear group's alignment only when every word of the
 * group joined. Where two phrases trade places, the edge of a run can join a
 * word whose group's head moved: in 1CH 13:1 ours reads `of hundreds and of
 * thousands`, Clear's `of thousands and of hundreds`, and our `of` before
 * `thousands` would take `H3967`, hundreds, through the `and of` that joined.
 */
export function alignWords(
  ours: ReadonlyMap<string, readonly string[]>,
  clearWords: ReadonlyMap<string, readonly { id: string; text: string }[]>,
  alignment: ReadonlyMap<string, ClearLink>,
  hub: ReadonlyMap<string, HubPart>,
  maxChanged = MAX_CHANGED,
): { rows: WordAlignment[]; stats: AlignStats } {
  for (const key of clearWords.keys()) if (!ours.has(key)) throw new Error(`${key}: Clear's BSB has the verse, ours doesn't`);
  const rows: WordAlignment[] = [];
  let words = 0;
  let aligned = 0;
  let unaligned = 0;
  let changed = 0;
  let split = 0;
  // first every verse's join, so a group's words can be checked across verses
  const verses = [...ours].map(([key, texts]) => {
    const theirs = clearWords.get(key) ?? [];
    return { key, texts, ids: joinWords(texts, theirs.map((w) => w.text)).map((j) => (j === null ? null : theirs[j].id)) };
  });
  const joinedIds = new Set(verses.flatMap((v) => v.ids.filter((id) => id !== null)));
  for (const { key, texts, ids: joinedTo } of verses) {
    const m = /^(\S+) (\d+):(\d+)$/.exec(key);
    if (!m) throw new Error(`"${key}" is not a verse key without a segment`);
    words += texts.length;
    joinedTo.forEach((target, wordIndex) => {
      if (target === null) return void changed++;
      const link = alignment.get(target);
      if (!link) return void unaligned++;
      const mates = link.group.filter((t) => t !== target);
      if (!mates.every((t) => joinedIds.has(t))) return void split++;
      const ids = link.sources;
      // one row per original word, in the order Clear names its parts
      const byWord = new Map<string, { source: HubPart['source']; strongs: string[] }>();
      for (const id of ids) {
        const part = hub.get(id);
        if (!part) throw new Error(`${key}!${wordIndex + 1}: Clear aligns "${texts[wordIndex]}" to ${id}, which is no step 11 word or morpheme`);
        const row = byWord.get(part.owId) ?? byWord.set(part.owId, { source: part.source, strongs: [] }).get(part.owId)!;
        for (const s of part.strongs) if (!row.strongs.includes(s)) row.strongs.push(s);
      }
      let seq = 0;
      for (const [owId, { source, strongs }] of byWord) {
        rows.push({ book: m[1], chapter: Number(m[2]), verse: Number(m[3]), segment: '', wordIndex, seq: seq++, source, owId, strongs });
      }
      aligned++;
    });
  }
  if (changed > maxChanged) {
    throw new Error(`${changed} words find no word in Clear's revision, more than ${maxChanged}: check the BSB or Clear pin (research/word-tags.md)`);
  }
  return { rows, stats: { words, aligned, unaligned, changed, split } };
}

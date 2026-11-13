/**
 * The facts we keep about a licensed edition (plan step 10): which verse
 * numbers each chapter prints, its bridges, which Psalms have a title, and
 * the word counts TVTMS's text tests read. Counts, never text, so the facts
 * are committed (`src/provider/facts/<edition>.json`) and the edition's
 * scheme and mapping rows build without a key, as a local edition's do from
 * its files. research/api-bible.md has how they are collected.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LICENSED_EDITIONS } from '../contract/rights';
import { normalizeChapters, splitChapters, type NormalizeOptions } from '../ingest/normalize';
import { addBookText, editionText, editionTextSnapshot, type EditionText, type TvtmsRow } from '../ingest/tvtms';
import { TVTMS } from '../ingest/sources';
import { adaptApiBibleContent, type ApiBibleNode } from './api-bible';

export interface EditionFacts {
  readonly edition: string;
  readonly bibleId: string;
  /** The day the oldest passage was fetched. */
  readonly fetched: string;
  /** The sha256 of the TVTMS file whose tests named the verses in `words` (`TVTMS.sha256`). */
  readonly tvtms: string;
  /** Per book, the last verse number each chapter prints, chapter 1 first. */
  readonly lastVerses: Readonly<Record<string, readonly number[]>>;
  /** Verse units that hold several numbers: `NUM 1:20-21`. */
  readonly bridges: readonly string[];
  /** Lettered verse parts: `1KI 2:35a`. */
  readonly parts: readonly string[];
  /** Numbers below a chapter's last verse that no unit holds: `MAT 17:21`. */
  readonly missing: readonly string[];
  /** Chapters with a title before verse 1: `PSA 3`. */
  readonly titled: readonly string[];
  /** Word tokens of each verse TVTMS's text tests name, keyed `BOOK c:v`. A bridge's count is under every number it holds. */
  readonly words: Readonly<Record<string, number>>;
  /** Markers outside the supported list, counted (`adaptApiBibleContent`). */
  readonly unsupported: Readonly<Record<string, number>>;
}

/** One book's content, its passages joined in order. */
export interface BookContent {
  readonly book: string;
  readonly content: readonly ApiBibleNode[];
}

/** The facts of an edition from every book's content. `tvtms` names the verses whose words are kept. */
export function editionFacts(
  meta: { edition: string; bibleId: string; fetched: string; tvtms: string },
  isTitle: NormalizeOptions['isTitle'],
  books: readonly BookContent[],
  tvtms: readonly TvtmsRow[],
): EditionFacts {
  const text = editionText(meta.edition);
  const lastVerses: Record<string, number[]> = {};
  const bridges: string[] = [];
  const parts: string[] = [];
  const missing: string[] = [];
  const unsupported: Record<string, number> = {};
  for (const { book, content: nodes } of books) {
    const adapted = adaptApiBibleContent(book, nodes);
    for (const [k, n] of Object.entries(adapted.unsupported)) unsupported[k] = (unsupported[k] ?? 0) + n;
    let result;
    try {
      const docs = splitChapters({ type: 'USJ', version: '3.1', content: adapted.content });
      // a title before verse 1 in any chapter becomes verse 0, so its chapter counts as titled
      result = normalizeChapters(docs, { titleChapters: new Set(docs.map((d) => d.chapter)), isTitle });
    } catch (e) {
      throw new Error(`${meta.edition} ${book}: ${(e as Error).message}`, { cause: e });
    }
    const { blocks, tokens, verses } = result;
    addBookText(text, book, blocks, tokens, verses);
    const chapters = [...new Set(verses.map((v) => v.chapter))].sort((a, b) => a - b);
    if (chapters.some((c, i) => c !== i + 1)) throw new Error(`${meta.edition} ${book}: chapters ${chapters.join(' ')} are not 1 to n`);
    lastVerses[book] = chapters.map((c) => {
      const units = verses.filter((v) => v.chapter === c);
      const held = new Set<number>();
      for (const u of units) {
        if (u.lastVerse > u.verse) bridges.push(`${book} ${c}:${u.verse}-${u.lastVerse}`);
        if (u.segment) parts.push(`${book} ${c}:${u.verse}${u.segment}`);
        for (let n = u.verse; n <= u.lastVerse; n++) if (n > 0) held.add(n);
      }
      const last = Math.max(...held);
      for (let n = 1; n < last; n++) if (!held.has(n)) missing.push(`${book} ${c}:${n}`);
      return last;
    });
  }
  const snapshot = editionTextSnapshot([{ scheme: '', text }], tvtms)[meta.edition];
  return { ...meta, lastVerses, bridges, parts, missing, titled: [...text.titled].sort(), words: snapshot.words, unsupported };
}

/** The facts as TVTMS's text tests read an edition. */
export function factsText(facts: EditionFacts): EditionText {
  const unitOf = new Map<string, string>();
  for (const b of facts.bridges) {
    const [, book, c, first, last] = /^(\S+) (\d+):(\d+)-(\d+)$/.exec(b)!;
    for (let v = Number(first) + 1; v <= Number(last); v++) unitOf.set(`${book} ${c}:${v}`, `${book} ${c}:${first}`);
  }
  return {
    edition: facts.edition,
    books: new Set(Object.keys(facts.lastVerses)),
    words: new Map(Object.entries(facts.words)),
    titled: new Set(facts.titled),
    unitOf,
  };
}

export const FACTS_DIR = join(import.meta.dirname, 'facts');

/**
 * The committed facts of every API.Bible edition, with its scheme. Stops when
 * the facts name verses for another TVTMS than the pinned one: rerun
 * `bun run api-bible:facts` after a TVTMS update.
 */
export function loadEditionFacts(): { scheme: string; facts: EditionFacts }[] {
  return [...LICENSED_EDITIONS].map(([edition, e]) => {
    const facts = JSON.parse(readFileSync(join(FACTS_DIR, `${edition}.json`), 'utf8')) as EditionFacts;
    if (facts.tvtms !== TVTMS.sha256) {
      throw new Error(`${edition}: facts were collected for TVTMS ${facts.tvtms}, not the pinned ${TVTMS.sha256}: run \`bun run api-bible:facts ${edition}\``);
    }
    return { scheme: e.scheme, facts };
  });
}

/**
 * The alignment pass (ADR-0003, step 12 and KJV amendments): which original
 * words of the hub texts an edition's words translate. The pass reads the
 * edition's words and the hub texts' words from the corpus being built, an
 * aligner turns them into rows, and the pass writes the rows.
 *
 *   clearBsbAligner  Clear Bible's manual BSB alignments (alignment.ts)
 *   kjvTagAligner    the KJV's own `\w strong=` tags (kjv-tags.ts)
 */

import { loadMappings } from '../db/corpus-read';
import type { Mappings } from '../model/mapping';
import { alignWords, readClearAlignment, readClearWords, type WordAlignment } from './alignment';
import { linkVerseTags, type HubWord, type TagStats } from './kjv-tags';
import type { WordTag } from './normalize';
import type { HubIndex, OpenPinned } from './source-formats';
import { CLEAR_BSB, KJV_TAGS } from './sources';
import { insertWordAlignments, type CorpusDb } from './write-db';

/** A verse unit, `GEN 1:1` or `1KI 2:35a`: the one key the pass and its aligners group words by. */
export const unitKey = (u: { book: string; chapter: number; verse: number; segment: string }): string =>
  `${u.book} ${u.chapter}:${u.verse}${u.segment}`;

/** What an aligner reads from the corpus. Each read runs on first use. */
export interface AlignInput {
  /** The edition's scheme. */
  readonly scheme: string;
  /** The edition's word tokens' text by verse unit (`unitKey`), in book, chapter, verse, segment and word order. */
  words(): ReadonlyMap<string, readonly string[]>;
  /** How many words each verse unit of the edition has (`unitKey`). Cheaper than `words` when the text isn't needed. */
  wordCounts(): ReadonlyMap<string, number>;
  /** The hub texts' original words by whole verse (`unitKey` with no segment), in order. */
  hubWords(): ReadonlyMap<string, readonly HubWord[]>;
  /** The hub verses (`unitKey` with no segment) a verse unit of the edition maps to, each once. */
  hubVerses(unit: { book: string; chapter: number; verse: number; segment: string }): string[];
}

export interface Aligner {
  /** The aligned edition's abbreviation. */
  readonly edition: string;
  /** The data_source id the rows name as their `aligned_by`. */
  readonly alignedBy: string;
  /** The rows and a summary line. Throws when more words fail than the aligner accepts. */
  align(input: AlignInput): { rows: WordAlignment[]; summary: string };
}

/**
 * Align one edition and write its rows in one transaction. Reads the
 * mappings when the aligner asks for hub verses, so it runs after they are
 * written; it stops when there are none. Returns the aligner's summary.
 */
export function runAlignment(db: CorpusDb, aligner: Aligner): string {
  const sqlite = db.$client;
  const edition = sqlite.prepare(`SELECT id, scheme FROM translation WHERE abbrev = ?`).get(aligner.edition) as
    | { id: number; scheme: string }
    | undefined;
  if (!edition) throw new Error(`${aligner.alignedBy}: no edition ${aligner.edition} in the corpus`);
  type Unit = { book: string; chapter: number; verse: number; segment: string };
  const words = () => {
    const byUnit = new Map<string, string[]>();
    const tokens = sqlite
      .prepare(
        `SELECT book, chapter, verse, segment, text FROM token WHERE translation_id = ? AND word_index IS NOT NULL
         ORDER BY book, chapter, verse, segment, word_index`,
      )
      .all(edition.id) as (Unit & { text: string })[];
    for (const t of tokens) {
      const key = unitKey(t);
      (byUnit.get(key) ?? byUnit.set(key, []).get(key)!).push(t.text);
    }
    return byUnit;
  };
  const wordCounts = () => {
    const units = sqlite
      .prepare(
        `SELECT book, chapter, verse, segment, count(*) AS n FROM token WHERE translation_id = ? AND word_index IS NOT NULL
         GROUP BY book, chapter, verse, segment`,
      )
      .all(edition.id) as (Unit & { n: number })[];
    return new Map(units.map((u) => [unitKey(u), u.n]));
  };
  let hub: { scheme: string; words: Map<string, HubWord[]> } | undefined;
  const readHub = () => (hub ??= readHubWords(db));
  let mappings: Mappings | undefined;
  const { rows, summary } = aligner.align({
    scheme: edition.scheme,
    words,
    wordCounts,
    hubWords: () => readHub().words,
    hubVerses(unit) {
      if (!mappings) {
        const { n } = sqlite.prepare('SELECT count(*) AS n FROM scheme_mapping').get() as { n: number };
        if (n === 0) throw new Error(`${aligner.alignedBy}: the mappings are not written yet`);
        mappings = loadMappings(db);
      }
      return [...new Set(mappings.map(edition.scheme, readHub().scheme, unit).map((r) => unitKey({ ...r, segment: '' })))];
    },
  });
  sqlite.exec('BEGIN');
  insertWordAlignments(db, edition.id, aligner.alignedBy, rows);
  sqlite.exec('COMMIT');
  return summary;
}

/** The hub texts (plan step 11). Original words of any other edition are not a hub for the aligners. */
const HUB_TEXTS = ['WLC', 'SBLGNT'];

/** The hub texts' original words by whole verse. The hub texts must share one scheme. */
function readHubWords(db: CorpusDb): { scheme: string; words: Map<string, HubWord[]> } {
  const sqlite = db.$client;
  const named = HUB_TEXTS.map(() => '?').join(', ');
  const hubs = sqlite.prepare(`SELECT abbrev, scheme FROM translation WHERE abbrev IN (${named}) ORDER BY id`).all(...HUB_TEXTS) as {
    abbrev: string;
    scheme: string;
  }[];
  const schemes = [...new Set(hubs.map((h) => h.scheme))];
  if (schemes.length !== 1) {
    const found = hubs.length > 0 ? hubs.map((h) => `${h.abbrev} under ${h.scheme}`).join(', ') : 'neither';
    throw new Error(`the hub texts ${HUB_TEXTS.join(' and ')} must share one scheme in the corpus; found ${found}`);
  }
  const words = new Map<string, HubWord[]>();
  const rows = sqlite
    .prepare(
      `SELECT o.book, o.chapter, o.verse, o.source, o.ow_id AS owId, o.kind, o.strongs FROM original_word o
       JOIN translation t ON t.id = o.translation_id WHERE t.abbrev IN (${named})
       ORDER BY o.book, o.chapter, o.verse, o.segment, o.seq`,
    )
    .all(...HUB_TEXTS) as { book: string; chapter: number; verse: number; source: HubWord['source']; owId: string; kind: HubWord['kind']; strongs: string }[];
  for (const w of rows) {
    // whole verses: a mapped verse unit meets every word of its hub verses
    const key = unitKey({ ...w, segment: '' });
    const word: HubWord = { source: w.source, owId: w.owId, kind: w.kind, strongs: w.strongs ? w.strongs.split(' ') : [] };
    (words.get(key) ?? words.set(key, []).get(key)!).push(word);
  }
  return { scheme: schemes[0], words };
}

/**
 * The BSB's alignment to the hub texts' words and morphemes, from Clear Bible
 * (plan step 12). `hub` is filled as the hub texts are ingested.
 */
export function clearBsbAligner(hub: HubIndex, openPinned: OpenPinned): Aligner {
  return {
    edition: 'BSB',
    alignedBy: CLEAR_BSB.id,
    align({ words }) {
      // each file is checked against its pin before it is read
      const files = [CLEAR_BSB.greek, CLEAR_BSB.hebrew, CLEAR_BSB.ntWords, CLEAR_BSB.otWords].map((f) => openPinned(f));
      const { rows, stats } = alignWords(words(), readClearWords(files.slice(2)), readClearAlignment(files.slice(0, 2)), hub);
      return {
        rows,
        summary:
          `BSB alignment (${CLEAR_BSB.id}): ${stats.aligned} of ${stats.words} words aligned, ${rows.length} rows; ` +
          `${stats.unaligned} Clear leaves unaligned, ${stats.changed} not in Clear's revision, ` +
          `${stats.split} whose Clear group didn't join`,
      };
    },
  };
}

/** The ingest stops when more KJV tags than this fail the check: 6,039 failed on 2026-11-13. */
const MAX_TAG_FAILURES = 6500;

/**
 * The KJV's checked word tags (ADR-0003, KJV amendment): each tag links to an
 * original word of the hub verse its KJV verse maps to. `tagsByBook` holds
 * the tags in book order.
 */
export function kjvTagAligner(tagsByBook: ReadonlyMap<string, readonly WordTag[]>, maxFailures = MAX_TAG_FAILURES): Aligner {
  return {
    edition: KJV_TAGS.edition,
    alignedBy: KJV_TAGS.id,
    align({ wordCounts, hubWords, hubVerses }) {
      const counts = wordCounts();
      const stats: TagStats = { tags: 0, passed: 0, unmapped: 0 };
      const rows: WordAlignment[] = [];
      for (const [book, tags] of tagsByBook) {
        const units = new Map<string, WordTag[]>();
        for (const t of tags) {
          const key = unitKey({ book, ...t });
          (units.get(key) ?? units.set(key, []).get(key)!).push(t);
        }
        for (const [key, unitTags] of units) {
          const { chapter, verse, segment } = unitTags[0];
          const unit = { book, chapter, verse, segment };
          const hub = hubVerses(unit).flatMap((k) => hubWords().get(k) ?? []);
          rows.push(...linkVerseTags(unit, counts.get(key) ?? 0, unitTags, hub, stats));
        }
      }
      const failed = stats.tags - stats.passed - stats.unmapped;
      if (failed > maxFailures) {
        throw new Error(`KJV tags: ${failed} tags name no word of their mapped verse, more than ${maxFailures}. Check the KJV source and the mappings`);
      }
      const tagged = new Set(rows.map((r) => `${unitKey(r)}!${r.wordIndex}`)).size;
      return {
        rows,
        summary:
          `KJV tags (${KJV_TAGS.id}): ${stats.passed} of ${stats.tags} pass, ${failed} name no word of their mapped verse, ` +
          `${stats.unmapped} are in verses that map to none; ${rows.length} rows on ${tagged} words`,
      };
    },
  };
}

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { OriginalWord, Token } from '../model/corpus';
import { PIVOT } from '../model/mapping';
import type { Scheme } from '../model/scheme';
import type { HubIndex } from './source-formats';
import { sqliteLoads } from './native-probe';
import { CLEAR_BSB } from './sources';

/**
 * The whole alignment pass on an in-memory corpus: one BSB verse aligned by
 * Clear's files, and one KJV verse whose tags meet the hub verse it maps to.
 * Skipped where better-sqlite3 is unbuilt, as roundtrip.test.ts.
 */
const native = sqliteLoads();

const WORDS = ['In', 'the', 'beginning', 'God', 'created'];

const scheme = (id: string): Scheme => ({
  id, name: id, sourceUrl: '', note: '', verseCounts: new Map([['GEN', [2]]]), excluded: new Set(), segments: new Map(), titles: new Set(),
});

const rows = (verse: number) => ({
  docs: [],
  verses: [],
  blocks: [{ id: 0, chapter: 1, genre: 'prose' as const, marker: 'p', seq: 0 }],
  tokens: WORDS.map(
    (text, i): Token => ({ id: i, blockId: 0, chapter: 1, verse, segment: '', wordIndex: i, seq: i, kind: 'word', text, verseStart: i === 0, owId: null }),
  ),
});

const hubWord = (owId: string, wordIndex: number, strong: string): OriginalWord => ({
  owId, book: 'GEN', chapter: 1, verse: 1, segment: '', wordIndex, seq: wordIndex, kind: 'word', text: owId, lemma: '', strongs: [strong], morph: '', gloss: null,
});

/**
 * WLC with four words in GEN 1:1, two of them H430, the BSB's GEN 1:1, and
 * the KJV's GEN 1:2, which its scheme maps to GEN 1:1.
 */
async function corpus() {
  const { createCorpusDb, insertMappings, seedBooksAndCanons, seedSchemes } = await import('./write-db');
  const { writeEdition } = await import('./edition-writer');
  const { db } = createCorpusDb(':memory:');
  seedBooksAndCanons(db);
  seedSchemes(db, new Map(['org', 'kj', PIVOT].map((id) => [id, scheme(id)])));
  const edition = (abbrev: string, schemeId: string, write: Parameters<typeof writeEdition>[3]) =>
    writeEdition(db, { name: abbrev, abbrev, language: '', year: null, license: null, scheme: schemeId, edition: 'sha256:0' }, ['GEN'], write);
  await edition('WLC', 'org', async (w) => {
    w.addBook('GEN', rows(1));
    w.addOriginalWords('GEN', 'oshb', [hubWord('a1', 0, 'H7225'), hubWord('a2', 1, 'H430'), hubWord('a3', 2, 'H1254'), hubWord('a4', 3, 'H430')]);
  });
  await edition('BSB', 'org', async (w) => w.addBook('GEN', rows(1)));
  await edition('KJV', 'kj', async (w) => w.addBook('GEN', rows(2)));
  const writeMappings = () =>
    insertMappings(db, [{ scheme: 'kj', from: { book: 'GEN', chapter: 1, verse: 2, segment: '' }, to: { book: 'GEN', chapter: 1, verse: 1, segment: '' }, kind: 'Renumber' }]);
  const stored = (abbrev: string) =>
    db.$client
      .prepare(
        `SELECT a.book || ' ' || a.chapter || ':' || a.verse || '!' || a.word_index || ' ' || a.ow_id || ' ' || a.strongs AS row
         FROM word_alignment a JOIN translation t ON t.id = a.translation_id WHERE t.abbrev = ? ORDER BY a.chapter, a.verse, a.word_index, a.seq`,
      )
      .all(abbrev)
      .map((r) => (r as { row: string }).row);
  return { db, writeMappings, stored };
}

/** Clear's BSB files under a sources root: GEN 1:1's words, and `In … beginning`, `God` and `created` aligned to morphemes. */
function clearRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'clear-'));
  mkdirSync(join(root, 'clear'));
  const file = (pin: { file: string }, text: string) => writeFileSync(join(root, pin.file), text);
  const id = (i: number) => `01001001${String(i + 1).padStart(3, '0')}`;
  file(CLEAR_BSB.otWords, ['id\ttext\texclude', ...WORDS.map((w, i) => `${id(i)}\t${w}\t`), `01001001006\t.\ty`].join('\n') + '\n');
  file(CLEAR_BSB.ntWords, 'id\ttext\texclude\n');
  file(CLEAR_BSB.hebrew, JSON.stringify({ records: [
    { source: ['m1', 'm2'], target: [id(0), id(2)] },
    { source: ['m3'], target: [id(3)] },
    { source: ['m4'], target: [id(4)] },
  ] }));
  file(CLEAR_BSB.greek, JSON.stringify({ records: [] }));
  return root;
}

describe.skipIf(!native)('the alignment pass', () => {
  it("aligns the BSB's words through Clear's files and the hub index", async () => {
    const { clearBsbAligner, runAlignment } = await import('./alignment-pass');
    const { db, stored } = await corpus();
    // בְּרֵאשִׁית is two morphemes, בְּ and רֵאשִׁית, of one word
    const hub: HubIndex = new Map([
      ['m1', { source: 'oshb', owId: 'a1', strongs: ['H871'] }],
      ['m2', { source: 'oshb', owId: 'a1', strongs: ['H7225'] }],
      ['m3', { source: 'oshb', owId: 'a2', strongs: ['H430'] }],
      ['m4', { source: 'oshb', owId: 'a3', strongs: ['H1254'] }],
    ]);
    // the files are cut down, so the test opens them without the pin check
    const root = clearRoot();
    const summary = runAlignment(db, clearBsbAligner(hub, (pin) => join(root, pin.file)));
    expect(stored('BSB')).toEqual(['GEN 1:1!0 a1 H871 H7225', 'GEN 1:1!2 a1 H871 H7225', 'GEN 1:1!3 a2 H430', 'GEN 1:1!4 a3 H1254']);
    expect(summary).toBe("BSB alignment (clear-bsb): 4 of 5 words aligned, 4 rows; 1 Clear leaves unaligned, 0 not in Clear's revision, 0 whose Clear group didn't join");
  });

  it("links the KJV's tags to the words of the hub verse its verse maps to, after the mappings are written", async () => {
    const { kjvTagAligner, runAlignment } = await import('./alignment-pass');
    const { db, writeMappings, stored } = await corpus();
    const tags = new Map([['GEN', [
      { chapter: 1, verse: 2, segment: '', wordIndexes: [2], strongs: ['H7225'] },
      { chapter: 1, verse: 2, segment: '', wordIndexes: [3], strongs: ['H0430'] },
      { chapter: 1, verse: 2, segment: '', wordIndexes: [4], strongs: ['H9999'] },
    ]]]);
    expect(() => runAlignment(db, kjvTagAligner(tags))).toThrow(/mappings are not written yet/);
    writeMappings();
    expect(() => runAlignment(db, kjvTagAligner(tags, 0))).toThrow(/1 tags name no word of their mapped verse, more than 0/);
    const summary = runAlignment(db, kjvTagAligner(tags));
    // one H430 tag, two H430 words: the tag at word 4 of 5 takes the last hub word, nearer its place than a2
    expect(stored('KJV')).toEqual(['GEN 1:2!2 a1 H7225', 'GEN 1:2!3 a4 H430']);
    expect(summary).toBe('KJV tags (kjv-strongs): 2 of 3 pass, 1 name no word of their mapped verse, 0 are in verses that map to none; 2 rows on 2 words');
  });
});

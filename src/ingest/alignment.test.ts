import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { alignWords, joinWords, readClearAlignment, readClearWords } from './alignment';
import type { HubPart } from './original-words';

function file(name: string, text: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'clear-')), name);
  writeFileSync(path, text);
  return path;
}

describe("reading Clear's files", () => {
  it('keys words by verse in Protestant book order, leaves out punctuation and keeps Psalm titles as verse 0', () => {
    const path = file(
      'w.tsv',
      [
        'id\tsource_verse\ttext\tskip_space_after\texclude\tid_range_end\tsource_verse_range_end',
        '40001001001\t40001001\tThis\t\t\t\t',
        '40001001002\t40001001\t,\ty\ty\t\t',
        '19003000001\t19003001\tA\t\t\t\t',
      ].join('\n') + '\n',
    );
    const words = readClearWords([path]);
    expect(words.get('MAT 1:1')).toEqual([{ id: '40001001001', text: 'This' }]);
    expect(words.get('PSA 3:0')).toEqual([{ id: '19003000001', text: 'A' }]);
  });

  it('reads each target id to the source ids of its records', () => {
    const path = file(
      'a.json',
      JSON.stringify({
        records: [
          { source: ['o010010010011', 'o010010010012'], target: ['01001001001', '01001001002', '01001001003'] },
          { source: ['o010010010021'], target: ['01001001005'] },
        ],
      }),
    );
    const a = readClearAlignment([path]);
    expect(a.get('01001001002')).toEqual({
      sources: ['o010010010011', 'o010010010012'],
      group: ['01001001001', '01001001002', '01001001003'],
    });
    expect(a.get('01001001005')).toEqual({ sources: ['o010010010021'], group: ['01001001005'] });
  });
});

describe('joinWords', () => {
  it('joins equal verses word for word, ignoring case and accents', () => {
    expect(joinWords(['In', 'the', 'beginning'], ['in', 'the', 'beginning'])).toEqual([0, 1, 2]);
  });

  it('joins two revisions on their common words (GEN 2:11, 2024 and 2026)', () => {
    const ours = 'The name of the first river is Pishon'.split(' ');
    const theirs = 'The name of the first river is the Pishon'.split(' ');
    expect(joinWords(ours, theirs)).toEqual([0, 1, 2, 3, 4, 5, 6, 8]);
  });

  it('leaves out a lone common word in a reworded phrase (ACT 19:15)', () => {
    const ours = 'Eventually one of the evil spirits'.split(' ');
    const theirs = 'But one day the evil spirit'.split(' ');
    expect(joinWords(ours, theirs)).toEqual([null, null, null, 3, 4, null]);
  });

  it('keeps a word both verses start or end on', () => {
    expect(joinWords(['Amen', 'truly', 'Amen'], ['Amen', 'so', 'Amen'])).toEqual([0, null, 2]);
  });

  it('leaves a changed word out (GEN 3:4 "the woman" became "her")', () => {
    const ours = 'the serpent told her'.split(' ');
    const theirs = 'the serpent told the woman'.split(' ');
    expect(joinWords(ours, theirs)).toEqual([0, 1, 2, null]);
  });
});

describe('alignWords', () => {
  // GEN 1:1 in OSHB: בְּרֵאשִׁית is one word of two MACULA morphemes
  const hub = new Map<string, HubPart>([
    ['o010010010011', { source: 'oshb', owId: '01xeN', strongs: ['H871'] }],
    ['o010010010012', { source: 'oshb', owId: '01xeN', strongs: ['H7225'] }],
    ['o010010010021', { source: 'oshb', owId: '01Nvk', strongs: ['H1254'] }],
    ['o010010010031', { source: 'oshb', owId: '01TyA', strongs: ['H430'] }],
  ]);
  const clearWords = new Map([
    ['GEN 1:1', ['In', 'the', 'beginning', 'God', 'created', 'it'].map((text, i) => ({ id: `0100100100${i + 1}`, text }))],
  ]);

  it('gives each word one row per original word, with the Strong\'s numbers of the parts it aligns to', () => {
    const alignment = new Map([
      ['01001001001', { sources: ['o010010010011'], group: ['01001001001'] }],
      ['01001001003', { sources: ['o010010010012'], group: ['01001001003'] }],
      ['01001001004', { sources: ['o010010010031'], group: ['01001001004'] }],
      ['01001001005', { sources: ['o010010010021', 'o010010010031'], group: ['01001001005'] }],
    ]);
    const ours = new Map([['GEN 1:1', ['In', 'the', 'beginning', 'God', 'created', 'all']]]);
    const { rows, stats } = alignWords(ours, clearWords, alignment, hub);
    const of = (i: number) => rows.filter((r) => r.wordIndex === i).map((r) => [r.seq, r.owId, r.strongs]);
    expect(of(0)).toEqual([[0, '01xeN', ['H871']]]);
    expect(of(2)).toEqual([[0, '01xeN', ['H7225']]]);
    expect(of(4)).toEqual([[0, '01Nvk', ['H1254']], [1, '01TyA', ['H430']]]);
    expect(rows[0]).toMatchObject({ book: 'GEN', chapter: 1, verse: 1, segment: '', source: 'oshb' });
    // "the" Clear leaves unaligned, "all" is not in Clear's revision
    expect(stats).toEqual({ words: 6, aligned: 4, unaligned: 1, changed: 1, split: 0 });
  });

  it("leaves out a word when another word of its Clear group didn't join (1CH 13:1, phrases swapped)", () => {
    // ours: "of hundreds and of thousands", Clear's: "of thousands and of hundreds"
    const words = new Map([['1CH 13:1', ['of', 'thousands', 'and', 'of', 'hundreds'].map((text, i) => ({ id: `1300101300${i + 1}`, text }))]]);
    const hub1 = new Map<string, HubPart>([
      ['o1', { source: 'oshb', owId: 'w1', strongs: ['H505'] }],
      ['o2', { source: 'oshb', owId: 'w2', strongs: ['H3967'] }],
    ]);
    const alignment = new Map([
      ['13001013001', { sources: ['o1'], group: ['13001013001', '13001013002'] }],
      ['13001013002', { sources: ['o1'], group: ['13001013001', '13001013002'] }],
      ['13001013003', { sources: ['o2'], group: ['13001013003', '13001013004', '13001013005'] }],
      ['13001013004', { sources: ['o2'], group: ['13001013003', '13001013004', '13001013005'] }],
      ['13001013005', { sources: ['o2'], group: ['13001013003', '13001013004', '13001013005'] }],
    ]);
    const ours = new Map([['1CH 13:1', ['of', 'hundreds', 'and', 'of', 'thousands']]]);
    const { rows, stats } = alignWords(ours, words, alignment, hub1);
    // each "of" joins the "of" of the other phrase, whose head word didn't join
    expect(joinWords(ours.get('1CH 13:1')!, words.get('1CH 13:1')!.map((w) => w.text))).toEqual([0, null, 2, 3, null]);
    expect(rows).toEqual([]);
    // "and" joined and is in the group "and of hundreds", whose "hundreds" didn't
    expect(stats).toEqual({ words: 5, aligned: 0, unaligned: 0, changed: 2, split: 3 });
  });

  it('stops on an id that is no step 11 word or morpheme', () => {
    const alignment = new Map([['01001001004', { sources: ['o999'], group: ['01001001004'] }]]);
    const ours = new Map([['GEN 1:1', ['In', 'the', 'beginning', 'God']]]);
    expect(() => alignWords(ours, clearWords, alignment, hub)).toThrow(/GEN 1:1!4.*o999/);
  });

  it("stops when more words than allowed find no word in Clear's revision", () => {
    const ours = new Map([['GEN 1:1', ['In', 'the', 'beginning', 'God', 'made', 'all']]]);
    expect(() => alignWords(ours, clearWords, new Map(), hub, 1)).toThrow(/2 words find no word/);
  });

  it('stops on a verse Clear has and ours lacks', () => {
    expect(() => alignWords(new Map(), clearWords, new Map(), hub)).toThrow(/GEN 1:1: Clear's BSB has the verse/);
  });
});

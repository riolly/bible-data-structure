import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Token } from '../model/corpus';
import { checkExceptionsUsed, greekWords, maculaGloss, readMacula, strongKey } from './original-words';

const nfc = (s: string) => s.normalize('NFC');
const tokens = (book: string, chapter: number, verse: number, texts: readonly string[]) =>
  texts.map((text, i) => ({ book, chapter, verse, segment: '', wordIndex: i, text: nfc(text), kind: 'word' }) as unknown as Token);

/** A MACULA TSV with the columns the join reads. */
function tsv(rows: readonly string[][]): string {
  const dir = mkdtempSync(join(tmpdir(), 'macula-'));
  const path = join(dir, 'm.tsv');
  writeFileSync(path, ['xml:id\tref\ttext\tstrong\tlemma\tmorph\tgloss\tenglish', ...rows.map((r) => r.join('\t'))].join('\n') + '\n');
  return path;
}

describe('Strong\'s numbers', () => {
  it('are H or G and the number, without zeros in front or letters after', () => {
    expect(strongKey('H', '0430')).toBe('H430');
    expect(strongKey('G', '976')).toBe('G976');
    expect(strongKey('H', '2416c')).toBe('H2416');
    expect(strongKey('H', '')).toBeNull();
    expect(strongKey('G', '0')).toBeNull();
  });
});

describe('readMacula', () => {
  it("groups a word's morphemes, and lets word numbers skip a ketiv MACULA doesn't read", () => {
    const path = tsv([
      ['o1', 'GEN 8:17!13', 'הָ', '', '', '', 'the', 'the'],
      ['o2', 'GEN 8:17!13', 'אָ֖רֶץ', '', '', '', 'earth', 'earth'],
      ['o3', 'GEN 8:17!15', 'הַיְצֵ֣א', '', '', '', 'bring.out', 'bring out'],
    ]);
    const words = readMacula(path).get('GEN 8:17')!;
    expect(words.map((w) => [w.id, w.text])).toEqual([['o1', nfc('הָאָ֖רֶץ')], ['o3', nfc('הַיְצֵ֣א')]]);
    expect(maculaGloss(words[1], 'H')).toBe('bring out');
    expect(maculaGloss(words[0], 'H')).toBe('the earth');
  });

  it('stops on a word number that goes back', () => {
    const path = tsv([
      ['o1', 'GEN 1:1!2', 'א', '', '', '', '', ''],
      ['o2', 'GEN 1:1!1', 'ב', '', '', '', '', ''],
    ]);
    expect(() => readMacula(path)).toThrow(/out of order/);
  });
});

describe('greekWords', () => {
  const path = tsv([
    ['n43003016001', 'JHN 3:16!1', 'Οὕτως', '3779', 'οὕτως', 'ADV', 'Thus', 'so'],
    ['n43003016002', 'JHN 3:16!2', 'γὰρ', '1063', 'γάρ', 'CONJ', '', 'for'],
    ['n43003016003', 'JHN 3:16!3', 'ἠγάπησεν', '25', 'ἀγαπάω', 'V-AAI-3S', 'loved', 'loved'],
    ['n43003017001', 'JHN 3:17!1', 'ὑπερεκπερισσοῦ', '5228+1537+4053', 'ὑπερεκπερισσοῦ', 'ADV', 'beyond all measure', ''],
    ['n43003017002', 'JHN 3:17!2', 'Ἀρνὶ', '0', 'Ἀρνί', 'N-GSM-P', 'of Arni', ''],
    ['n43003017003', 'JHN 3:17!3', 'Ἀρνὶ', 'x', 'Ἀρνί', 'N-GSM-P', 'of Arni', ''],
  ]);
  const macula = readMacula(path);

  it("joins MACULA's words to ours by position, its gloss else its english", () => {
    const { words, stats } = greekWords('JHN', tokens('JHN', 3, 16, ['Οὕτως', 'γάρ', 'ἠγάπησεν']), macula);
    expect(words.map((w) => [w.owId, w.wordIndex, w.text, w.strongs.join(), w.lemma, w.morph, w.gloss])).toEqual([
      ['n43003016001', 0, 'Οὕτως', 'G3779', 'οὕτως', 'ADV', 'Thus'],
      ['n43003016002', 1, nfc('γάρ'), 'G1063', 'γάρ', 'CONJ', 'for'], // accents may differ between the two SBLGNT copies
      ['n43003016003', 2, 'ἠγάπησεν', 'G25', 'ἀγαπάω', 'V-AAI-3S', 'loved'],
    ]);
    expect(stats.noGloss).toBe(0);
  });

  it("keeps a compound's numbers, gives a word MACULA numbers 0 none, and stops on any other", () => {
    const words = (texts: string[]) => greekWords('JHN', tokens('JHN', 3, 17, texts), new Map([['JHN 3:17', macula.get('JHN 3:17')!.slice(0, texts.length)]])).words;
    expect(words(['ὑπερεκπερισσοῦ', 'Ἀρνὶ']).map((w) => w.strongs)).toEqual([['G5228', 'G1537', 'G4053'], []]);
    expect(() => words(['ὑπερεκπερισσοῦ', 'Ἀρνὶ', 'Ἀρνὶ'])).toThrow(/"x" for "Ἀρνὶ" is not a number/);
  });

  it('stops on another word count, or other letters outside the counted exceptions', () => {
    expect(() => greekWords('JHN', tokens('JHN', 3, 16, ['Οὕτως', 'γάρ']), macula)).toThrow(/3 words, the SBLGNT 2/);
    expect(() => greekWords('JHN', tokens('JHN', 3, 16, ['Οὕτως', 'γάρ', 'ἠγάπησε']), macula, [])).toThrow(/JHN 3:16!3/);
    const used = new Set<string>();
    const ex = [{ at: 'JHN 3:16!3', ours: 'ἠγάπησε', macula: 'ἠγάπησεν', why: 'test' }];
    expect(() => greekWords('JHN', tokens('JHN', 3, 16, ['Οὕτως', 'γάρ', 'ἠγάπησε']), macula, ex, used)).not.toThrow();
    expect(() => checkExceptionsUsed(ex, used)).not.toThrow();
    expect(() => checkExceptionsUsed(ex, new Set())).toThrow(/matched no word/);
  });
});

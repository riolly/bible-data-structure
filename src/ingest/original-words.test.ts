import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Token } from '../model/corpus';
import { checkExceptionsUsed, greekWords, hebrewWords, maculaGloss, oshbStrong, readMacula, strongKey } from './original-words';
import type { OshbReading, OshbVerse } from './oshb-xml';

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

  it("are an OSHB lemma's last number, else its last prefix letter's", () => {
    expect(oshbStrong('c/d/1004 b')).toBe('H1004');
    expect(oshbStrong('834 a')).toBe('H834');
    expect(oshbStrong('1004+')).toBe('H1004');
    expect(oshbStrong('c/l')).toBe('H3807');
    expect(oshbStrong('m')).toBe('H4480');
    expect(oshbStrong('c')).toBeNull();
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

describe('hebrewWords', () => {
  // GEN 8:17 cut down: הוצא is written, read הַיְצֵא. MACULA skips the ketiv's number.
  const written = ['הָאָ֖רֶץ', 'הוצא', 'אִתָּ֑ךְ'];
  const verse: OshbVerse = {
    book: 'GEN',
    chapter: 8,
    verse: 17,
    words: [
      { id: '01a', lemma: 'd/776', morph: 'HTd/Ncbsa', text: nfc(written[0]), wordIndex: 0 },
      { id: '01b', lemma: '3318', morph: 'HVhv2ms', text: nfc(written[1]), wordIndex: 1 },
      { id: '01c', lemma: '854', morph: 'HR/Sp2ms', text: nfc(written[2]), wordIndex: 2 },
    ],
  };
  const qere: OshbReading = {
    book: 'GEN', chapter: 8, verse: 17, wordIndex: 1, wordCount: 1, kind: 'qere', text: nfc('הַיְצֵ֣א'), owIds: ['01q'],
    qere: [{ id: '01q', lemma: '3318', morph: 'HVhv2ms', text: nfc('הַיְצֵ֣א') }], ketiv: [nfc('הוצא')], verseWords: written.map(nfc),
  };
  const macula = readMacula(
    tsv([
      ['o1', 'GEN 8:17!13', 'הָ', '', '', '', 'the', ''],
      ['o2', 'GEN 8:17!13', 'אָ֖רֶץ', '', '', '', 'earth', ''],
      ['o3', 'GEN 8:17!15', 'הַיְצֵ֣א', '', '', '', 'bring.out', ''],
      ['o4', 'GEN 8:17!16', 'אִתָּ֑', '', '', '', 'with', ''],
      ['o5', 'GEN 8:17!16', 'ךְ', '', '', '', 'you', ''],
    ]),
  );

  it('gives the written words and each qere after its ketiv, glossed through the read text', () => {
    const { words, stats } = hebrewWords('GEN', tokens('GEN', 8, 17, written), [verse], [qere], macula);
    expect(words.map((w) => [w.seq, w.kind, w.owId, w.wordIndex, w.strongs.join(), w.gloss])).toEqual([
      [0, 'word', '01a', 0, 'H776', 'the earth'],
      [1, 'ketiv', '01b', 1, 'H3318', null],
      [2, 'qere', '01q', null, 'H3318', 'bring out'],
      [3, 'word', '01c', 2, 'H854', 'with you'],
    ]);
    expect(stats.noGloss).toBe(0);
  });

  it('puts a qere with no written word before the word it is read before', () => {
    const readOnly: OshbReading = { ...qere, wordIndex: 2, wordCount: 0, ketiv: [] };
    const m = readMacula(
      tsv([
        ['o1', 'GEN 8:17!1', 'הָאָ֖רֶץ', '', '', '', 'the.earth', ''],
        ['o2', 'GEN 8:17!2', 'הוצא', '', '', '', 'x', ''],
        ['o3', 'GEN 8:17!3', 'הַיְצֵ֣א', '', '', '', 'bring.out', ''],
        ['o4', 'GEN 8:17!4', 'אִתָּ֑ךְ', '', '', '', 'with.you', ''],
      ]),
    );
    const { words } = hebrewWords('GEN', tokens('GEN', 8, 17, written), [verse], [readOnly], m);
    expect(words.map((w) => `${w.kind}:${w.owId}`)).toEqual(['word:01a', 'word:01b', 'qere:01q', 'word:01c']);
  });

  it("stops when the tokens aren't OSHB's words, or MACULA's words aren't the read text", () => {
    expect(() => hebrewWords('GEN', tokens('GEN', 8, 17, ['הָאָ֖רֶץ', 'הוצא', 'אִתָּ']), [verse], [qere], macula)).toThrow(/not OSHB's words/);
    expect(() => hebrewWords('GEN', tokens('GEN', 8, 17, written), [verse], [], macula)).toThrow(/3 words, the read text 3|OSHB has "הוצא"/);
  });
});

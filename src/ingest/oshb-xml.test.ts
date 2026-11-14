import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Token } from '../model/corpus';
import { OSHB_BOOKS, checkReadings, oshbXmlToUsfm, type OshbReading } from './oshb-xml';
import { SOURCES_ROOT } from './source-files';
import { SOURCES } from './sources';
import { storedText } from './text-form';
import { tokenize } from './tokenize';

// Lines from the pinned OSHB (1SA 9:1, 2SA 8:3, 2KI 5:18, DEU 6:4, JER 48:44, GEN 1:5), cut down.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<osis><osisText osisIDWork="OSHB"><header><work osisWork="OSHB"><title>Open Scriptures Hebrew Bible</title></work></header>
    <div type="book" osisID="1Sam">
      <chapter osisID="1Sam.9">
        <verse osisID="1Sam.9.1">
          <w lemma="c/1961" morph="HC/Vqw3ms" id="09wci">וַֽ/יְהִי</w><seg type="x-maqqef">־</seg><w lemma="376" morph="HNcmsa" id="09MpA">אִ֣ישׁ</w>
          <w type="x-ketiv" lemma="m/1121 a" morph="HR/Np" id="09Una">מ/בן</w><seg type="x-maqqef" subType="x-ketiv">־</seg><w type="x-ketiv" lemma="3225" morph="HNp" id="09jgC">ימין</w><note type="variant"><catchWord>מ/בן־ימין</catchWord><rdg type="x-qere"><w lemma="m/1144" n="1.0.1" morph="HR/Np" id="09EC9">מִ/בִּנְיָמִ֗ין</w></rdg></note>
          <note n="a">Adaptations to a Qere which L and BHS, by their design, do not indicate. </note>
          <w lemma="c/8034" n="1.0.0.1" morph="HC/Ncmsc/Sp3ms" id="09Ati">וּ֠/שְׁמ/וֹ</w>
        </verse>
        <verse osisID="1Sam.9.2">
          <w lemma="b/5104" morph="HR/Ncmsc" id="10BJi">בִּֽ/נְהַר</w><seg type="x-maqqef">־</seg><note type="variant"><rdg type="x-qere"><w lemma="6578" n="0" morph="HNp" id="10dp9">פְּרָֽת</w></rdg></note><seg type="x-sof-pasuq">׃</seg>
          <seg type="x-pe">פ</seg>
        </verse>
      </chapter>
      <chapter osisID="1Sam.10">
        <verse osisID="1Sam.10.1">
          <w lemma="5545" morph="HVqj3ms" id="12gsX">יִסְלַח</w><seg type="x-maqqef">־</seg><w type="x-ketiv" lemma="4994" morph="HTe" id="12yBx">נא</w><note type="variant"><catchWord>נא</catchWord><rdg type="x-qere"/></note>
          <w lemma="8085" n="1.0" morph="HVqv2ms" id="05WH5">שְׁמַ֖<seg type="x-large">ע</seg></w>
          <w type="x-ketiv" lemma="d/5211" morph="HTd/Vqrmsa" id="24PtS">ה/ניס</w>
          <note type="exegesis">WLC has this word divided as <rdg>הניס</rdg>.</note>
          <note type="variant">
            <catchWord>הניס</catchWord>
            <rdg type="x-qere">
              <w lemma="d/5127" n="1.2.0.0" morph="HTd/Vqrmsa" id="24Rwm">הַ/נָּ֞ס</w>
            </rdg>
          </note>
          <w lemma="m/6440" morph="HR/Ncbpc" id="24Vrx">מִ/פְּנֵ֤י</w><seg type="x-sof-pasuq">׃</seg> <seg type="x-samekh">ס</seg>
        </verse>
      </chapter>
    </div>
  </osisText>
</osis>
`;

describe('oshbXmlToUsfm', () => {
  const { usfm, readings, verses } = oshbXmlToUsfm(XML, '1SA');

  it('keeps the written text without morpheme breaks, notes or markup', () => {
    expect(usfm.split('\n')).toEqual([
      '\\id 1SA Westminster Leningrad Codex, from the upstream OSHB XML',
      '\\c 9',
      '\\p',
      '\\v 1 וַֽיְהִי־אִ֣ישׁ מבן־ימין וּ֠שְׁמוֹ',
      '\\v 2 בִּֽנְהַר־׃ פ',
      '\\c 10',
      '\\p',
      '\\v 1 יִסְלַח־נא שְׁמַ֖ע הניס מִפְּנֵ֤י׃ ס',
      '',
    ]);
  });

  it('makes the paragraph marks punctuation and the ketiv words', () => {
    const words = (line: string) => tokenize(storedText(line), { paragraphMarks: true }).filter((t) => t.kind === 'word');
    expect(words('בִּֽנְהַר־׃ פ').map((t) => t.text)).toEqual(['בִּֽנְהַר']);
    expect(words('יִסְלַח־נא שְׁמַ֖ע הניס מִפְּנֵ֤י׃ ס')).toHaveLength(5);
  });

  it('keys each qere by the range of written words its note follows (ADR-0007)', () => {
    expect(readings.map(({ verseWords, qere, ...r }) => r)).toEqual([
      // two written words read as one
      { book: '1SA', chapter: 9, verse: 1, wordIndex: 2, wordCount: 2, kind: 'qere', text: 'מִבִּנְיָמִ֗ין', owIds: ['09EC9'], ketiv: ['מבן', 'ימין'] },
      // read and not written, after the verse's last word
      { book: '1SA', chapter: 9, verse: 2, wordIndex: 1, wordCount: 0, kind: 'qere', text: 'פְּרָֽת', owIds: ['10dp9'], ketiv: [] },
      // written and not read
      { book: '1SA', chapter: 10, verse: 1, wordIndex: 1, wordCount: 1, kind: 'qere', text: '', owIds: [], ketiv: ['נא'] },
      // an exegesis note between the ketiv and its qere
      { book: '1SA', chapter: 10, verse: 1, wordIndex: 3, wordCount: 1, kind: 'qere', text: 'הַנָּ֞ס', owIds: ['24Rwm'], ketiv: ['הניס'] },
    ]);
  });

  it("carries its verse's words, so the ingest can check where it sits", () => {
    expect(readings[1].verseWords).toEqual(['בִּֽנְהַר']);
  });

  it('keeps each written word with its OSHB id, lemma and morphology, the ketiv words too (plan step 11)', () => {
    expect(verses.map((v) => `${v.chapter}:${v.verse} ${v.words.map((w) => `${w.id}=${w.lemma}`).join(' ')}`)).toEqual([
      '9:1 09wci=c/1961 09MpA=376 09Una=m/1121 a 09jgC=3225 09Ati=c/8034',
      '9:2 10BJi=b/5104',
      '10:1 12gsX=5545 12yBx=4994 05WH5=8085 24PtS=d/5211 24Vrx=m/6440',
    ]);
    // the text is the word token's: no morpheme breaks, large letters kept
    expect(verses[0].words[0]).toEqual({ id: '09wci', lemma: 'c/1961', morph: 'HC/Vqw3ms', text: 'וַֽיְהִי', wordIndex: 0 });
    expect(verses[2].words[2].text).toBe('שְׁמַ֖ע');
    expect(verses[0].words.map((w) => w.wordIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it('puts two <w> with nothing between them in one word token (1CH 15:13)', () => {
    const xml = `<div type="book" osisID="1Chr"><chapter osisID="1Chr.15"><verse osisID="1Chr.15.13">
      <w lemma="3588 a" morph="HC" id="13pus">כִּ֛י</w>
      <w lemma="l/4100" morph="HR/Ti" id="13Z5a">לְ/מַ</w><w lemma="b/7223" morph="HRd/Aafsa" id="1391p">בָּ/רִ֥אשׁוֹנָ֖ה</w>
      <note type="exegesis">A single word in the text has been divided for exegesis.</note>
      <w lemma="3808" morph="HTn" id="13N2d">לֹ֣א</w></verse></chapter></div></osisText>`;
    const { usfm, verses: [v] } = oshbXmlToUsfm(xml, '1CH');
    expect(usfm).toContain('\\v 13 כִּ֛י לְמַבָּרִ֥אשׁוֹנָ֖ה לֹ֣א');
    expect(v.words.map((w) => `${w.wordIndex}:${w.id}`)).toEqual(['0:13pus', '1:13Z5a', '1:1391p', '2:13N2d']);
  });

  it('keeps the words of each qere with their lemma and morphology', () => {
    expect(readings.map((r) => r.qere.map((w) => `${w.id}=${w.lemma}:${w.morph}`))).toEqual([
      ['09EC9=m/1144:HR/Np'],
      ['10dp9=6578:HNp'],
      [],
      ['24Rwm=d/5127:HTd/Vqrmsa'],
    ]);
  });

  it('rejects a ketiv with no qere note, and markup it does not know', () => {
    const wrap = (verse: string) => `<div type="book" osisID="Gen"><chapter osisID="Gen.1"><verse osisID="Gen.1.1">${verse}</verse></chapter></div></osisText>`;
    const w = (id: string, text: string, ketiv = '') => `<w${ketiv} lemma="1" morph="HNp" id="${id}">${text}</w>`;
    expect(() => oshbXmlToUsfm(wrap(w('a', 'הוצא', ' type="x-ketiv"')), 'GEN')).toThrow(/ketiv with no qere/);
    expect(() => oshbXmlToUsfm(wrap(`${w('a', 'הוצא', ' type="x-ketiv"')} ${w('b', 'אִתָּ֑ךְ')}`), 'GEN')).toThrow(/ketiv with no qere/);
    expect(() => oshbXmlToUsfm(wrap('<w id="a">הוצא</w>'), 'GEN')).toThrow(/without an id, lemma or morph/);
    expect(() => oshbXmlToUsfm(wrap(w('a', 'אִתָּ ךְ')), 'GEN')).toThrow(/is not one word token/);
    expect(() => oshbXmlToUsfm(wrap('<seg type="x-new">*</seg>'), 'GEN')).toThrow(/unknown <seg/);
    expect(() => oshbXmlToUsfm(wrap('stray'), 'GEN')).toThrow(/outside an element/);
  });
});

describe('oshbXmlToUsfm keeps Hebrew as the source wrote it (ADR-0004 v1.6)', () => {
  // JOS 10:1 word 6 (06YgF): the lamed carries a patah, then a hiriq, which NFC would swap.
  const jerusalem = '\u05D9\u05B0\u05E8\u05D5\u05BC\u05E9\u05C1\u05B8\u05DC\u05B7\u05B4\u0597\u05DD';
  const xml = `<osis><osisText><div type="book" osisID="Josh"><chapter osisID="Josh.10"><verse osisID="Josh.10.1">
    <w lemma="3389" morph="HNp" id="06YgF">${jerusalem}</w><note type="variant"><catchWord>x</catchWord><rdg type="x-qere"><w lemma="3389" morph="HNp" id="06Qer">${jerusalem}</w></rdg></note>
  </verse></chapter></div></osisText></osis>`;
  const { usfm, readings, verses } = oshbXmlToUsfm(xml, 'JOS');

  it('in the verse text, the word and the qere', () => {
    expect(usfm.split('\n')).toContain(`\\v 1 ${jerusalem}`);
    expect(verses[0].words[0].text).toBe(jerusalem);
    expect(readings[0]).toMatchObject({ text: jerusalem, qere: [{ text: jerusalem }] });
  });
});

describe('checkReadings', () => {
  // GEN 8:17 cut down: הוצא is the ketiv, read הַיְצֵא
  const words = ['עַל', 'הָאָ֖רֶץ', 'הוצא', 'אִתָּ֑ךְ'];
  const tokens = (texts: readonly string[]) =>
    texts.map((text, i) => ({ chapter: 8, verse: 17, segment: '', wordIndex: i, text, kind: 'word' }) as Token);
  const reading = (r: Partial<OshbReading>): OshbReading => ({
    book: 'GEN', chapter: 8, verse: 17, wordIndex: 2, wordCount: 1, kind: 'qere', text: 'הַיְצֵ֣א', owIds: ['01S7t'],
    ketiv: ['הוצא'], verseWords: words, qere: [], ...r,
  });

  it('passes a reading on the words it was converted from', () => {
    expect(() => checkReadings('GEN', [reading({}), reading({ wordIndex: 4, wordCount: 0, ketiv: [] })], tokens(words))).not.toThrow();
  });

  it('stops on a range that misses its ketiv, or a verse whose stored words differ', () => {
    expect(() => checkReadings('GEN', [reading({ wordIndex: 1 })], tokens(words))).toThrow(/GEN 8:17!2/);
    expect(() => checkReadings('GEN', [reading({ wordIndex: 5, wordCount: 0, ketiv: [] })], tokens(words))).toThrow();
    // a qere with no written word can't be checked by its range alone: the verse's words catch a shift
    const shifted = ['עַל', 'הָאָ֖רֶץ', 'הוצא', 'אִתָּ', 'ךְ'];
    expect(() => checkReadings('GEN', [reading({ wordIndex: 4, wordCount: 0, ketiv: [] })], tokens(shifted))).toThrow(/the tokens have/);
    expect(() => checkReadings('GEN', [reading({ chapter: 9 })], tokens(words))).toThrow();
  });
});

const src = SOURCES.find((s) => s.meta.abbrev === 'WLC')!;
const oshbDir = src.format?.kind === 'oshb-xml' ? join(SOURCES_ROOT, src.dir, src.format.path) : '';
describe.skipIf(!oshbDir || !existsSync(oshbDir))('the pinned OSHB', () => {
  it('has 1,260 qere notes in the shapes ADR-0007 counts', () => {
    const shapes = new Map<string, number>();
    let ids = 0;
    for (const name of readdirSync(oshbDir)) {
      const code = OSHB_BOOKS[name.replace('.xml', '')];
      if (!code) continue;
      for (const r of oshbXmlToUsfm(readFileSync(join(oshbDir, name), 'utf8'), code).readings) {
        const shape = `${r.wordCount}:${r.owIds.length}`;
        shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
        ids += r.owIds.length;
      }
    }
    // written words : read words. 2KI 6:25 and JER 18:3 have two ketiv elements in one written word.
    expect(Object.fromEntries([...shapes].sort())).toEqual({ '0:1': 9, '1:0': 6, '1:1': 1214, '1:2': 16, '2:1': 7, '2:2': 8 });
    expect(ids).toBe(1278);
  }, 60_000);
});

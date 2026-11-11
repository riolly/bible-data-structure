import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Token } from '../model/corpus';
import { OSHB_BOOKS, checkReadings, oshbXmlToUsfm, type OshbReading } from './oshb-xml';
import { SOURCES_ROOT } from './source-files';
import { SOURCES } from './sources';
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
  const { usfm, readings } = oshbXmlToUsfm(XML, '1SA');

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
    const words = (line: string) => tokenize(line.normalize('NFC'), { paragraphMarks: true }).filter((t) => t.kind === 'word');
    expect(words('בִּֽנְהַר־׃ פ').map((t) => t.text)).toEqual(['בִּֽנְהַר'.normalize('NFC')]);
    expect(words('יִסְלַח־נא שְׁמַ֖ע הניס מִפְּנֵ֤י׃ ס')).toHaveLength(5);
  });

  it('keys each qere by the range of written words its note follows (ADR-0007)', () => {
    const nfc = (s: string) => s.normalize('NFC');
    expect(readings.map(({ verseWords, ...r }) => r)).toEqual([
      // two written words read as one
      { book: '1SA', chapter: 9, verse: 1, wordIndex: 2, wordCount: 2, kind: 'qere', text: nfc('מִבִּנְיָמִ֗ין'), owIds: ['09EC9'], ketiv: ['מבן', 'ימין'] },
      // read and not written, after the verse's last word
      { book: '1SA', chapter: 9, verse: 2, wordIndex: 1, wordCount: 0, kind: 'qere', text: nfc('פְּרָֽת'), owIds: ['10dp9'], ketiv: [] },
      // written and not read
      { book: '1SA', chapter: 10, verse: 1, wordIndex: 1, wordCount: 1, kind: 'qere', text: '', owIds: [], ketiv: ['נא'] },
      // an exegesis note between the ketiv and its qere
      { book: '1SA', chapter: 10, verse: 1, wordIndex: 3, wordCount: 1, kind: 'qere', text: nfc('הַנָּ֞ס'), owIds: ['24Rwm'], ketiv: ['הניס'] },
    ]);
  });

  it("carries its verse's words, so the ingest can check where it sits", () => {
    expect(readings[1].verseWords).toEqual(['בִּֽנְהַר'.normalize('NFC')]);
  });

  it('rejects a ketiv with no qere note, and markup it does not know', () => {
    const wrap = (verse: string) => `<div type="book" osisID="Gen"><chapter osisID="Gen.1"><verse osisID="Gen.1.1">${verse}</verse></chapter></div></osisText>`;
    expect(() => oshbXmlToUsfm(wrap('<w type="x-ketiv" id="a">הוצא</w>'), 'GEN')).toThrow(/ketiv with no qere/);
    expect(() => oshbXmlToUsfm(wrap('<w type="x-ketiv" id="a">הוצא</w> <w id="b">אִתָּ֑ךְ</w>'), 'GEN')).toThrow(/ketiv with no qere/);
    expect(() => oshbXmlToUsfm(wrap('<seg type="x-new">*</seg>'), 'GEN')).toThrow(/unknown <seg/);
    expect(() => oshbXmlToUsfm(wrap('stray'), 'GEN')).toThrow(/outside an element/);
  });
});

describe('checkReadings', () => {
  // GEN 8:17 cut down: הוצא is the ketiv, read הַיְצֵא
  const words = ['עַל', 'הָאָ֖רֶץ', 'הוצא', 'אִתָּ֑ךְ'];
  const tokens = (texts: readonly string[]) =>
    texts.map((text, i) => ({ chapter: 8, verse: 17, segment: '', wordIndex: i, text, kind: 'word' }) as Token);
  const reading = (r: Partial<OshbReading>): OshbReading => ({
    book: 'GEN', chapter: 8, verse: 17, wordIndex: 2, wordCount: 1, kind: 'qere', text: 'הַיְצֵ֣א', owIds: ['01S7t'],
    ketiv: ['הוצא'], verseWords: words, ...r,
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

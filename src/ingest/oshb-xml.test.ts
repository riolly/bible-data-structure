import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { OSHB_BOOKS, oshbXmlToUsfm } from './oshb-xml';
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
    expect(readings).toEqual([
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

  it('rejects a ketiv with no qere note, and markup it does not know', () => {
    const wrap = (verse: string) => `<div type="book" osisID="Gen"><chapter osisID="Gen.1"><verse osisID="Gen.1.1">${verse}</verse></chapter></div></osisText>`;
    expect(() => oshbXmlToUsfm(wrap('<w type="x-ketiv" id="a">הוצא</w>'), 'GEN')).toThrow(/ketiv with no qere/);
    expect(() => oshbXmlToUsfm(wrap('<w type="x-ketiv" id="a">הוצא</w> <w id="b">אִתָּ֑ךְ</w>'), 'GEN')).toThrow(/ketiv with no qere/);
    expect(() => oshbXmlToUsfm(wrap('<seg type="x-new">*</seg>'), 'GEN')).toThrow(/unknown <seg/);
    expect(() => oshbXmlToUsfm(wrap('stray'), 'GEN')).toThrow(/outside an element/);
  });
});

const src = SOURCES.find((s) => s.meta.abbrev === 'WLC')!;
const oshbDir = src.format?.kind === 'oshb-xml' ? join(SOURCES_ROOT, src.dir, src.format.path) : '';
/** ebible's hboWLC, the WLC source before ADR-0007. No longer downloaded; the test runs where it is still unpacked. */
const ebibleDir = join(SOURCES_ROOT, 'wlc');

/** The words ebible's copy got wrong: it leaked OSHB markup as text around a large, small or suspended letter. */
const LEAKED_MARKUP = ['DEU 6:4', 'ISA 44:14', 'JDG 18:30', 'JER 39:13', 'JOB 38:13', 'JOB 38:15', 'LEV 11:42', 'NUM 27:5', 'PRO 16:28', 'PSA 80:14'];

describe.skipIf(!oshbDir || !existsSync(oshbDir) || !existsSync(ebibleDir))('the pinned OSHB against ebible hboWLC', () => {
  it('converts to the same verses and the same word addresses, except where ebible leaked markup', () => {
    // A doubled pashta's first mark is U+05A8 in the pinned OSHB and U+0599 in ebible's copy (ADR-0007).
    const words = (s: string) =>
      tokenize(s.normalize('NFC').replaceAll('֨', '֙'), { paragraphMarks: true })
        .filter((t) => t.kind === 'word')
        .map((t) => t.text);
    const verses = (usfm: string) => {
      const out = new Map<string, string>();
      let chapter = 0;
      for (const line of usfm.split('\n')) {
        const c = /^\\c (\d+)/.exec(line);
        const v = /^\\v (\d+) (.*)$/.exec(line);
        if (c) chapter = Number(c[1]);
        else if (v) out.set(`${chapter}:${v[1]}`, v[2]);
      }
      return out;
    };
    const ebible = new Map<string, string>();
    for (const name of readdirSync(ebibleDir).filter((n) => n.endsWith('.usfm'))) {
      const usfm = readFileSync(join(ebibleDir, name), 'utf8');
      ebible.set(/^\\id (\w+)/.exec(usfm)![1], usfm.replace(/\\w ([^|\\]*)\|[^\\]*\\w\*/g, '$1'));
    }
    let count = 0;
    let readings = 0;
    const moved: string[] = [];
    const changed: string[] = [];
    for (const name of readdirSync(oshbDir)) {
      const code = OSHB_BOOKS[name.replace('.xml', '')];
      if (!code) continue;
      const converted = oshbXmlToUsfm(readFileSync(join(oshbDir, name), 'utf8'), code);
      readings += converted.readings.length;
      const ours = verses(converted.usfm);
      const theirs = verses(ebible.get(code)!);
      expect([...ours.keys()], code).toEqual([...theirs.keys()]);
      for (const [k, text] of theirs) {
        const [a, b] = [words(ours.get(k)!), words(text)];
        if (a.length !== b.length) moved.push(`${code} ${k}`);
        else for (const [i, w] of a.entries()) if (w !== b[i]) changed.push(`${code} ${k}!${i + 1}`);
        count++;
      }
    }
    expect(count).toBe(23213);
    expect(readings).toBe(1260);
    expect(moved.sort()).toEqual(LEAKED_MARKUP);
    // Points and letters OSHB corrected after ebible copied it. Same address, new text.
    // prettier-ignore
    expect(changed.sort()).toEqual([
      '2KI 21:26!1', '2SA 5:13!10', '2SA 9:13!12', 'DAN 2:39!5', 'DEU 1:31!9', 'ECC 2:22!8', 'ECC 2:23!11', 'EST 3:13!17',
      'EXO 4:18!9', 'EZK 4:6!7', 'GEN 41:30!2', 'GEN 5:29!6', 'JDG 15:14!5', 'JDG 9:2!24', 'ZEP 2:15!1',
    ]);
  }, 60_000);
});

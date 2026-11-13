import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { OriginalWord, Token } from '../model/corpus';
import type { BookRows, EditionWriter } from './edition-writer';
import type { OshbReading } from './oshb-xml';
import { readSource } from './source-files';
import type { HubIndex } from './source-formats';
import { MACULA_GREEK, MACULA_HEBREW, type SourceDef } from './sources';

const nfc = (s: string) => s.normalize('NFC');
const rows = (book: string, chapter: number, verse: number, texts: readonly string[]): BookRows => ({
  docs: [],
  verses: [],
  blocks: [],
  tokens: texts.map((text, i) => ({ book, chapter, verse, segment: '', wordIndex: i, text: nfc(text), kind: 'word' }) as unknown as Token),
});

/** A sources root holding `files`, by path under it. */
function sourcesRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'sources-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const source = (abbrev: string, books: string[], format?: SourceDef['format']): SourceDef => ({
  meta: { name: abbrev, abbrev, language: '', year: null, scheme: 'org', edition: '' },
  url: '',
  edition: '',
  dir: abbrev.toLowerCase(),
  books,
  format,
  rewriteVersifiedD: false,
});

/** An edition writer that records what it is given. */
function recorder() {
  const calls: { book: string; readings?: readonly OshbReading[]; source?: string; words?: readonly OriginalWord[] }[] = [];
  const writer: EditionWriter = {
    addBook: (book, _rows, readings) => void calls.push({ book, readings }),
    addOriginalWords: (book, source, words) => void calls.push({ book, source, words }),
  };
  return { writer, calls };
}

/** Opens a pinned file under `root` without its hash check: the files here are cut down, so no pin matches them. */
const unpinned = (root: string) => (pin: { file: string }) => join(root, pin.file);

const tsv = (header: string, lines: string[][]) => [header, ...lines.map((l) => l.join('\t'))].join('\n') + '\n';

describe('the usfm format', () => {
  it("reads each listed book by its \\id line and adds it with nothing else", () => {
    const root = sourcesRoot({
      'kjv/02-GENeng.usfm': '\\id GEN\n\\c 1\n\\v 1 In the beginning\n',
      'kjv/03-EXOeng.usfm': '\\id EXO\n\\c 1\n',
      'kjv/readme.txt': '\\id RUT\n',
    });
    const { files, open } = readSource(source('KJV', ['GEN']), root);
    expect(files.map((f) => f.code)).toEqual(['GEN']);
    const { writer, calls } = recorder();
    const extras = open(new Map());
    extras.addBook(writer, 'GEN', rows('GEN', 1, 1, ['In', 'the', 'beginning']));
    expect(calls).toEqual([{ book: 'GEN', readings: undefined }]);
    expect(extras.finish()).toEqual([]);
  });
});

describe('the sblgnt-xml format', () => {
  // JHN 8:5 cut down: our pin spells Μωσῆς, MACULA Μωϋσῆς, the one counted Greek exception.
  const root = sourcesRoot({
    'sblgnt/xml/John.xml': `<book id="John">
  <p>
    <verse-number id="John 8:5">8:5</verse-number>
    <w>ἐν</w><suffix> </suffix><w>δὲ</w><suffix> </suffix><w>τῷ</w><suffix> </suffix><w>νόμῳ</w><suffix> </suffix><w>Μωσῆς</w><suffix> </suffix>
  </p>
</book>`,
    [MACULA_GREEK.file]: tsv('xml:id\tref\ttext\tstrong\tlemma\tmorph\tgloss\tenglish', [
      ['n43008005001', 'JHN 8:5!1', 'ἐν', '1722', 'ἐν', 'PREP', 'in', ''],
      ['n43008005002', 'JHN 8:5!2', 'δὲ', '1161', 'δέ', 'CONJ', 'now', ''],
      ['n43008005003', 'JHN 8:5!3', 'τῷ', '3588', 'ὁ', 'T-DSM', 'the', ''],
      ['n43008005004', 'JHN 8:5!4', 'νόμῳ', '3551', 'νόμος', 'N-DSM', 'law', ''],
      ['n43008005005', 'JHN 8:5!5', 'Μωϋσῆς', '3475', 'Μωϋσῆς', 'N-NSM-P', '', ''],
    ]),
  });
  const src = source('SBLGNT', ['JHN'], { kind: 'sblgnt-xml', path: 'xml' });

  it('converts the XML, and adds each book with its MACULA words, every word id in the hub index', () => {
    const { files, open } = readSource(src, root, unpinned(root));
    expect(files[0].usfm).toMatch(/^\\id JHN [^]*\\v 5 ἐν\s+δὲ\s+τῷ\s+νόμῳ\s+Μωσῆς/);
    const hub: HubIndex = new Map();
    const { writer, calls } = recorder();
    const extras = open(hub);
    extras.addBook(writer, 'JHN', rows('JHN', 8, 5, ['ἐν', 'δὲ', 'τῷ', 'νόμῳ', 'Μωσῆς']));
    expect(calls.map((c) => [c.book, c.source, c.words?.map((w) => w.owId).join()])).toEqual([
      ['JHN', undefined, undefined],
      ['JHN', MACULA_GREEK.id, 'n43008005001,n43008005002,n43008005003,n43008005004,n43008005005'],
    ]);
    expect(hub.get('n43008005005')).toEqual({ source: 'macula-greek', owId: 'n43008005005', strongs: ['G3475'] });
    expect(hub.size).toBe(5);
    expect(extras.finish()).toEqual([`5 original words, glosses from ${MACULA_GREEK.id}: 1 read words have none`]);
  });

  it('checks the MACULA file against its pin when the edition opens, unless told otherwise', () => {
    expect(() => readSource(src, root).open(new Map())).toThrow(`${MACULA_GREEK.id}: ${join(root, MACULA_GREEK.file)} does not match its pin`);
  });

  it('stops at the end of the edition when a counted exception matched no word', () => {
    const extras = readSource(src, root, unpinned(root)).open(new Map());
    extras.addBook(recorder().writer, 'JHN', rows('JHN', 8, 5, ['ἐν', 'δὲ', 'τῷ', 'νόμῳ', 'Μωϋσῆς']));
    expect(() => extras.finish()).toThrow(/matched no word: JHN 8:5!5/);
  });
});

describe('the oshb-xml format', () => {
  // GEN 8:17 cut down: הוצא is written, read הַיְצֵא.
  const root = sourcesRoot({
    'wlc/wlc/Gen.xml': `<osis><osisText osisIDWork="OSHB">
    <div type="book" osisID="Gen">
      <chapter osisID="Gen.8">
        <verse osisID="Gen.8.17">
          <w lemma="d/776" morph="HTd/Ncbsa" id="01a">הָ/אָ֖רֶץ</w>
          <w type="x-ketiv" lemma="3318" morph="HVhv2ms" id="01b">הוצא</w><note type="variant"><catchWord>הוצא</catchWord><rdg type="x-qere"><w lemma="3318" morph="HVhv2ms" id="01q">הַיְצֵ֣א</w></rdg></note>
          <w lemma="854" morph="HR/Sp2ms" id="01c">אִתָּ֑/ךְ</w>
        </verse>
      </chapter>
    </div>
  </osisText></osis>`,
    [MACULA_HEBREW.file]: tsv('xml:id\tref\ttext\tstrongnumberx\tgloss\tenglish', [
      ['o1', 'GEN 8:17!13', 'הָ', '', 'the', ''],
      ['o2', 'GEN 8:17!13', 'אָ֖רֶץ', '776', 'earth', ''],
      ['o3', 'GEN 8:17!15', 'הַיְצֵ֣א', '3318', 'bring.out', ''],
      ['o4', 'GEN 8:17!16', 'אִתָּ֑', '854', 'with', ''],
      ['o5', 'GEN 8:17!16', 'ךְ', '', 'you', ''],
    ]),
  });

  it("adds each book with its qere readings and OSHB's words, every MACULA morpheme in the hub index", () => {
    const { files, open } = readSource(source('WLC', ['GEN'], { kind: 'oshb-xml', path: 'wlc' }), root, unpinned(root));
    expect(files[0].usfm).toContain('\\v 17 הָאָ֖רֶץ הוצא אִתָּ֑ךְ');
    const hub: HubIndex = new Map();
    const { writer, calls } = recorder();
    const extras = open(hub);
    extras.addBook(writer, 'GEN', rows('GEN', 8, 17, ['הָאָ֖רֶץ', 'הוצא', 'אִתָּ֑ךְ']));
    expect(calls.map((c) => [c.book, c.readings?.map((r) => r.owIds.join()), c.source, c.words?.map((w) => `${w.kind}:${w.owId}`).join()])).toEqual([
      ['GEN', ['01q'], undefined, undefined],
      ['GEN', undefined, 'oshb', 'word:01a,ketiv:01b,qere:01q,word:01c'],
    ]);
    expect([...hub]).toEqual([
      ['o1', { source: 'oshb', owId: '01a', strongs: [] }],
      ['o2', { source: 'oshb', owId: '01a', strongs: ['H776'] }],
      ['o3', { source: 'oshb', owId: '01q', strongs: ['H3318'] }],
      ['o4', { source: 'oshb', owId: '01c', strongs: ['H854'] }],
      ['o5', { source: 'oshb', owId: '01c', strongs: [] }],
    ]);
    expect(extras.finish()).toEqual(['1 qere readings (ADR-0007)', `4 original words, glosses from ${MACULA_HEBREW.id}: 0 read words have none`]);
  });
});

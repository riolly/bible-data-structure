import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Mappings, PIVOT, checkCoverage, ref, refKey, type MappingRow, type Ref } from '../model/mapping';
import type { Block, Token } from '../model/corpus';
import type { Scheme } from '../model/scheme';
import { buildPivot, checkExtendOnly, pivotSnapshot } from './pivot';
import { DERIVED_SCHEMES, loadSchemes } from './schemes';
import {
  TVTMS_PATH,
  WORD_TEST_MARGIN,
  addBookText,
  checkSchemeSegments,
  compileTvtms,
  compileMappings,
  editionText,
  editionTextsFromSnapshot,
  evaluateTests,
  decidedTextTest,
  evaluateTextTest,
  foldSchemeSegments,
  parseStandardRefs,
  parseTvtms,
  readTvtms,
  TITLE_IN_VERSE_1,
  type EditionText,
  type EditionTextSnapshot,
} from './tvtms';
import { TVTMS } from './sources';

const keys = (refs: Ref[]) => refs.map(refKey);

/** A Joel-only scheme for test evaluation. */
const scheme = (joel: number[], extra: Partial<Scheme> = {}): Scheme => ({
  id: 't',
  name: 't',
  sourceUrl: '',
  note: '',
  verseCounts: new Map([['JOL', joel], ['PSA', [6, 12, 8]]]),
  excluded: new Set(),
  segments: new Map(),
  titles: new Set(),
  ...extra,
});

describe('parseStandardRefs', () => {
  it.each([
    ['Gen.32:1', ['GEN 32:1']],
    ['Rev.13:1!a', ['REV 13:1a']],
    ['Psa.3:Title', ['PSA 3:0']],
    ['Gen.2:24-3:1', ['GEN 2:24', 'GEN 2:25', 'GEN 3:1']],
    ['Jol.2:28-30', ['JOL 2:28', 'JOL 2:29', 'JOL 2:30']],
    ['Gen.5:32; 6:1', ['GEN 5:32', 'GEN 6:1']],
    ['Est.1:1; 2:1,3-4', ['EST 1:1', 'EST 2:1', 'EST 2:3', 'EST 2:4']],
    ['Jos.9:2!0', ['JOS 9:2']],
    ['2Es.7:35!aa', ['2ES 7:35!aa']],
    ['Sir.1:1; Est.2:2', ['SIR 1:1', 'EST 2:2']],
    ['4Es.10:59', ['2ES 10:59']],
  ])('%s', (text, expected) => {
    expect(parseStandardRefs(text, (b, c) => (b === 'GEN' && c === 2 ? 25 : undefined)).map(refKey)).toEqual(expected);
  });

  it('lists the whole of every chapter a range crosses', () => {
    // TVTMS line 8598 uses Esg.11:2-12:6.
    const refs = parseStandardRefs('Esg.11:2-12:6', (_b, c) => (c === 11 ? 12 : undefined)).map(refKey);
    expect(refs).toHaveLength(11 + 6);
    expect(refs).toContain('ESG 11:7');
  });

  it('rejects a cross-chapter range without counts, and a reversed range', () => {
    expect(() => parseStandardRefs('Gen.2:24-3:1')).toThrow(/no verse count/);
    expect(() => parseStandardRefs('Jdt.2:16-8')).toThrow(/ends before/); // TVTMS line 26586
    expect(() => parseStandardRefs('1Ki.4:34-3:1')).toThrow(/ends before/);
  });

  it('rejects a book TVTMS has but USFM lacks', () => {
    expect(() => parseStandardRefs('Ade.1:1')).toThrow(/no USFM code/);
  });
});

describe('evaluateTests against a verse-count table', () => {
  const t = scheme([20, 27, 5, 21]); // Hebrew Joel: 4 chapters

  it('evaluates =Last, =Exist and =NotExist', () => {
    expect(evaluateTests('Jol.4:21=Last', t)).toBe(true);
    expect(evaluateTests('Jol.3:21=Last', t)).toBe(false);
    expect(evaluateTests('Jol.4:1=Exist & Jol.2:28=NotExist', t)).toBe(true);
    expect(evaluateTests('Jol.2:28=Exist', t)).toBe(false);
  });

  it('counts subverses from the scheme segments', () => {
    const lxx = scheme([20, 32, 21], { segments: new Map([['JOL 2:1', ['', 'a', 'b']]]) });
    expect(evaluateTests('Jol.2:1.2=Exist', lxx)).toBe(true);
    expect(evaluateTests('Jol.2:1.3=Exist', lxx)).toBe(false);
    expect(evaluateTests('Jol.2:2.1=NotExist', lxx)).toBe(true);
  });

  it('defers tests that need text', () => {
    expect(evaluateTests('Jol.2:1<Jol.2:2', t)).toBe('needs-text');
    expect(evaluateTests('Psa.3:TextBeforeV1=Exist', t)).toBe('needs-text');
    expect(evaluateTests('Jol.4:1=Exist & Jol.2:1<Jol.2:2', t)).toBe('needs-text');
    // A failing count test decides it even when another test needs text.
    expect(evaluateTests('Jol.3:21=Last & Jol.2:1<Jol.2:2', t)).toBe(false);
  });

  it('treats an empty test list as true (applies to every Bible)', () => {
    expect(evaluateTests('', t)).toBe(true);
  });
});

/** An edition with these word counts (`BOOK c:v`) and titled chapters (`BOOK c`). */
const edition = (name: string, words: Record<string, number>, titled: string[] = [], books = ['JOL', 'PSA', 'PHP', 'MAL']): EditionText => ({
  edition: name,
  books: new Set(books),
  words: new Map(Object.entries(words)),
  titled: new Set(titled),
});

describe('the word-test margin', () => {
  it('is the registered value (ADR-0006: changing it is a mapping migration)', () => {
    expect(WORD_TEST_MARGIN).toBe(0.2);
  });
});

describe('text tests against an edition', () => {
  // KJV and BSB word counts at TVTMS lines 4084-4087 (research/tvtms-text-tests.md).
  const kjv = edition('KJV', { 'PHP 1:16': 15, 'PHP 1:17': 16 }, ['PSA 3']);
  const bsb = edition('BSB', { 'PHP 1:16': 17, 'PHP 1:17': 22 });

  it('compares word counts, with sums and doubling', () => {
    expect(evaluateTextTest('Php.1:16<Php.1:17', bsb)).toBe(true);
    expect(evaluateTextTest('Php.1:16>Php.1:17', bsb)).toBe(false);
    const e = edition('E', { 'MAL 3:22': 10, 'MAL 3:23': 4, 'MAL 3:24': 12 });
    expect(evaluateTextTest('Mal.3:23*2<Mal.3:22+Mal.3:24', e)).toBe(true); // 8 < 22
    expect(evaluateTextTest('Mal.3:22+Mal.3:24>Mal.3:23*2', e)).toBe(true);
    expect(evaluateTextTest('Mal.3:25<Mal.3:22', e)).toBe(true); // a verse the edition lacks has 0 words
  });

  it('leaves a word test undecided when the sides differ by less than 20%', () => {
    expect(evaluateTextTest('Php.1:16>Php.1:17', kjv)).toBe('close'); // 15 against 16
    expect(evaluateTextTest('Php.1:16<Php.1:17', kjv)).toBe('close');
    expect(evaluateTextTest('Mal.3:1<Mal.3:2', kjv)).toBe('close'); // 0 against 0
  });

  it('reads TextBeforeV1 from the titled chapters', () => {
    expect(evaluateTextTest('Psa.3:TextBeforeV1=Exist', kjv)).toBe(true);
    expect(evaluateTextTest('Psa.4:TextBeforeV1=NotExist', kjv)).toBe(true);
    expect(evaluateTextTest('Psa.3:TextBeforeV1=NotExist', kjv)).toBe(false);
  });

  it('cannot decide a test on a book the edition lacks', () => {
    expect(evaluateTextTest('Gen.1:1<Gen.1:2', kjv)).toBe('no-book');
    expect(evaluateTextTest('Ade.1:1<Php.1:17', kjv)).toBe('no-book');
    expect(evaluateTextTest('Psa.3:TextBeforeV1=Exist', edition('NT', {}, [], ['PHP']))).toBe('no-book');
  });

  it("decides a row only when every edition that has its books agrees", () => {
    const t = scheme([20, 32, 21]);
    const tests = 'Jol.3:1=Exist & Php.1:16<Php.1:17';
    expect(evaluateTests(tests, t, 'Jol', [bsb])).toBe(true);
    expect(evaluateTests(tests, t, 'Jol', [kjv])).toBe('needs-text'); // close
    expect(evaluateTests(tests, t, 'Jol', [bsb, kjv])).toBe('needs-text');
    const greekOrder = edition('X', { 'PHP 1:16': 10, 'PHP 1:17': 30 });
    const kjvOrder = edition('Y', { 'PHP 1:16': 30, 'PHP 1:17': 10 });
    expect(evaluateTests(tests, t, 'Jol', [bsb, greekOrder])).toBe(true);
    expect(evaluateTests(tests, t, 'Jol', [bsb, kjvOrder])).toBe('needs-text');
    expect(evaluateTests(tests, t, 'Jol', [bsb, edition('OT', {}, [], ['JOL'])])).toBe(true); // lacks PHP: skipped
    expect(evaluateTests(tests, t, 'Jol', [edition('OT', {}, [], ['JOL'])])).toBe('needs-text');
    expect(evaluateTests('Jol.3:22=Exist & Php.1:16<Php.1:17', t, 'Jol', [bsb])).toBe(false); // count test first
  });
});

describe('decidedTextTest', () => {
  const decisions = new Map([['Php.1:16<Php.1:17', true]]);
  it('gives the decision for its test, the opposite for its mirror, and nothing for another test', () => {
    expect(decidedTextTest('Php.1:16<Php.1:17', decisions)).toBe(true);
    expect(decidedTextTest('Php.1:16>Php.1:17', decisions)).toBe(false);
    expect(decidedTextTest('Php.1:17<Php.1:18', decisions)).toBeUndefined();
    expect(decidedTextTest('Php.1:16<Php.1:17', undefined)).toBeUndefined();
  });
});

describe('addBookText', () => {
  const block = (id: number, marker: string): Block => ({ id, chapter: 3, genre: 'heading', marker, seq: 0 });
  const token = (blockId: number, verse: number | null, seq: number, kind: Token['kind'] = 'word'): Token => ({
    id: seq, blockId, chapter: 3, verse, segment: '', wordIndex: null, seq, kind, text: 'x', verseStart: false, owId: null,
  });

  it('counts word tokens per verse and finds a psalm title before verse 1', () => {
    const into = editionText('E');
    addBookText(into, 'PSA', [block(0, 's1'), block(1, 'd'), block(2, 'p')], [
      token(0, null, 0), token(1, null, 1), token(2, 1, 2), token(2, 1, 3), token(2, 1, 4, 'punct'), token(2, 2, 5),
    ], []);
    expect([...into.words]).toEqual([['PSA 3:1', 2], ['PSA 3:2', 1]]);
    expect([...into.titled]).toEqual(['PSA 3']);
    expect([...into.books]).toEqual(['PSA']);
  });

  it('does not count a section heading, or a title numbered as verse 1', () => {
    const into = editionText('E');
    addBookText(into, 'PSA', [block(0, 's1'), block(1, 'd')], [token(0, null, 0), token(1, 1, 1)], []);
    expect(into.titled.size).toBe(0);
  });

  it("counts a bridge's words under every number it holds", () => {
    const into = editionText('E');
    const unit = (verse: number, lastVerse: number) => ({ chapter: 3, verse, lastVerse, segment: '' });
    addBookText(into, 'NUM', [block(0, 'p')], [token(0, 20, 0), token(0, 20, 1), token(0, 22, 2)], [unit(20, 21), unit(22, 22)]);
    expect([...into.words]).toEqual([['NUM 3:20', 2], ['NUM 3:22', 1], ['NUM 3:21', 2]]);
    // a side naming both numbers of the bridge counts its 2 words once: 2 < 3, not 4 < 3
    expect(evaluateTextTest('Num.3:20+Num.3:21<Num.3:22*3', into)).toBe(true);
  });
});

describe('parseTvtms and compileTvtms on synthetic rows', () => {
  const header = '#DataStart(Expanded)\nSourceType\tSourceRef\tStandardRef\tAction\tNoteMarker\tA\tB\tC\tTests\n';
  const row = (src: string, std: string, action: string, tests: string) =>
    `Hebrew\t${src}\t${std}\t${action}\tNec.\t\t\t\t${tests}\n`;
  const text =
    header +
    row('Jol.3:1', 'Jol.2:28', 'Renumber verse', 'Jol.4:21=Last') +
    row('Jol.4:1', 'Jol.3:1', 'Renumber verse', 'Jol.4:21=Last') +
    row('Jol.1:1', 'Jol.1:1', 'Keep verse', 'Jol.4:21=Last') +
    row('Jol.1:2', 'Jol.1:2-3', 'Concatenation', 'Jol.1:2<Jol.1:3') +
    row('Ade.1:1', 'Est.1:1', 'Renumber verse', '') +
    '#DataEnd(Expanded)\n';
  const kjvLike = scheme([20, 32, 21]);

  it('reads only the expanded section', () => {
    expect(parseTvtms(text).map((r) => r.source)).toEqual(['Jol.3:1', 'Jol.4:1', 'Jol.1:1', 'Jol.1:2', 'Ade.1:1']);
  });

  it('keeps rows whose count tests pass, drops identity, defers text tests, skips unknown books', () => {
    const c = compileTvtms(parseTvtms(text), scheme([20, 27, 5, 21]), kjvLike);
    expect(c.rows.map((r) => `${refKey(r.from)}>${r.to ? refKey(r.to) : '-'} ${r.kind}`)).toEqual([
      'JOL 3:1>JOL 2:28 Renumber verse',
      'JOL 4:1>JOL 3:1 Renumber verse',
    ]);
    expect(c.needsText).toHaveLength(1);
    expect(c.skipped.map((s) => s.reason)).toEqual([expect.stringMatching(/no USFM code/)]);
  });

  it('compiles nothing for a scheme the tests reject', () => {
    expect(compileTvtms(parseTvtms(text), kjvLike, kjvLike).rows).toEqual([]);
  });

  it('leaves a verse undecided when a text-dependent row disagrees with an untested one', () => {
    // TVTMS AllBibles 1Ki.22:44 (no tests) against rows that need text.
    const t = header + row('Jol.1:5', 'Jol.1:5', 'Keep verse', '') + row('Jol.1:5', 'Jol.1:4!b', 'Renumber verse', 'Jol.1:5<Jol.1:4') + '#DataEnd(Expanded)\n';
    const c = compileTvtms(parseTvtms(t), kjvLike, kjvLike);
    expect(c.decided.has('JOL 1:5')).toBe(false);
  });

  it('keeps a verse identity row when one of its parts moves', () => {
    // TVTMS Latin Sir.18:1 stays and Sir.18:1!b becomes 18:2.
    const t = header + row('Jol.1:5', 'Jol.1:5', 'Keep verse', 'Jol.3:21=Last') + row('Jol.1:5!b', 'Jol.1:6', 'Renumber verse', 'Jol.3:21=Last') + '#DataEnd(Expanded)\n';
    const c = compileTvtms(parseTvtms(t), kjvLike, kjvLike);
    expect(c.rows.map((r) => `${refKey(r.from)}>${refKey(r.to!)}`).sort()).toEqual(['JOL 1:5>JOL 1:5', 'JOL 1:5b>JOL 1:6']);
  });

  it('skips a Standard reference past the KJV extent of a protestant book', () => {
    const t = header + row('Jol.1:5', 'Jol.3:22', 'Renumber verse', '') + row('Jol.1:6', 'Sir.60:1', 'Renumber verse', '') + '#DataEnd(Expanded)\n';
    const c = compileTvtms(parseTvtms(t), kjvLike, kjvLike);
    expect(c.rows.map((r) => refKey(r.to!))).toEqual(['SIR 60:1']); // not a protestant book: no bound
    expect(c.skipped.map((x) => x.reason)).toEqual([expect.stringMatching(/past KJV/)]);
  });
});

describe('scheme-side part letters (#70)', () => {
  const scheme = (id: string, segments: [string, string[]][]): Scheme => ({
    id,
    name: id,
    sourceUrl: '',
    note: '',
    verseCounts: new Map([['1KI', [46, 46, 46, 46, 46, 46, 46, 53]], ['ESG', [1]], ['SIR', [1, 1, 1, 1, 1, 2]], ['EXO', Array(38).fill(17)]]),
    excluded: new Set(),
    segments: new Map(segments),
    titles: new Set(),
  });
  // Rahlfs letters skip j: the 10th and 11th printed parts of 1KI 2:46 are k and l
  const kgs: [string, string[]] = ['1KI 2:46', ['', ...'abcdefghikl']];
  const brn = scheme('brn', [kgs, ['1KI 8:53', ['', 'a']], ['ESG 1:1', ['', 'b', 'c']], ['SIR 6:2', ['a', 'b']]]);
  const lx = scheme('lx', [kgs]);
  const row = (scheme: string, from: Ref, to: Ref): MappingRow => ({ scheme, from, to, kind: 'CopiedFrom verse', source: 'tvtms' });
  const rows = [
    row('brn', ref('1KI', 2, 46, 'a'), ref('1KI', 4, 20)),
    row('brn', ref('1KI', 2, 46, 'e1'), ref('1KI', 4, 22)),
    row('brn', ref('1KI', 2, 46, 'e2'), ref('1KI', 4, 22)),
    row('brn', ref('1KI', 2, 46, 'h1'), ref('1KI', 4, 2)),
    row('brn', ref('1KI', 2, 46, 'h2'), ref('1KI', 4, 3)),
    row('brn', ref('1KI', 2, 46, 'j'), ref('1KI', 4, 21)),
    row('brn', ref('1KI', 2, 46, 'k'), ref('1KI', 11, 42)),
    row('brn', ref('1KI', 8, 53, 'a'), ref('1KI', 8, 12)),
    row('brn', ref('1KI', 8, 53, 'b'), ref('1KI', 8, 13)),
    row('brn', ref('ESG', 1, 1, 'a'), ref('ESG', 11, 2)),
    row('brn', ref('ESG', 1, 1, 'b'), ref('ESG', 11, 3)),
    row('brn', ref('SIR', 6, 2, 'c1'), ref('SIR', 6, 3)),
    row('brn', ref('EXO', 38, 17, 'l'), ref('EXO', 38, 17, 'l')),
    row('brn', ref('EXO', 38, 17, 'aa'), ref('EXO', 38, 18)),
    row('lx', ref('1KI', 2, 46, 'h1'), ref('1KI', 4, 2)),
    row('lx', ref('1KI', 2, 46, 'j'), ref('1KI', 4, 21)),
    row('brn', ref('2ES', 7, 36), ref('2ES', 7, 35, 'aa')),
    row('brn', ref('2ES', 7, 36), ref('2ES', 7, 35, 'aa')),
  ];
  const schemes = new Map([['brn', brn], ['lx', lx]]);
  const keyed = (list: readonly MappingRow[]) =>
    list.map((r) => `${r.scheme} ${refKey(r.from)} ${r.to ? refKey(r.to) : `absent (${r.kind})`}`);

  it("reads TVTMS letters as ordinals over the parts an edition prints, and folds a piece to its part's letter", () => {
    // ESG 1:1: Brenton's unlettered part is TVTMS's a, so its letters were checked and don't line up
    const { rows: out, dropped } = foldSchemeSegments(rows, schemes, new Map([['brn', new Set(['ESG 1:1'])]]));
    expect(keyed(out)).toEqual([
      'brn 1KI 2:46a 1KI 4:20',
      'brn 1KI 2:46e 1KI 4:22',
      'brn 1KI 2:46h 1KI 4:2',
      'brn 1KI 2:46h 1KI 4:3',
      'brn 1KI 2:46k 1KI 4:21',
      'brn 1KI 2:46l 1KI 11:42',
      // one printed part holds every part TVTMS names
      'brn 1KI 8:53a 1KI 8:12',
      'brn 1KI 8:53a 1KI 8:13',
      // parts that can't be aligned map nowhere, like a verse the pivot lacks
      'brn ESG 1:1b absent (TVTMS parts unaligned)',
      'brn ESG 1:1c absent (TVTMS parts unaligned)',
      'brn SIR 6:2a absent (TVTMS parts unaligned)',
      'brn SIR 6:2b absent (TVTMS parts unaligned)',
      // no parts listed: TVTMS's letter stays, and a longer id moves to the whole verse
      'brn EXO 38:17l EXO 38:17l',
      'brn EXO 38:17 EXO 38:18',
      // a scheme no edition prints keeps TVTMS's letters
      'lx 1KI 2:46h 1KI 4:2',
      'lx 1KI 2:46j 1KI 4:21',
      'brn 2ES 7:36 2ES 7:35!aa',
      'brn 2ES 7:36 2ES 7:35!aa', // only changed rows merge: vul's .vrs repeats DAG 3:52's rows
    ]);
    expect(dropped.map((d) => `${refKey(d.row.from)}: ${d.reason}`)).toEqual([
      "ESG 1:1a: TVTMS's letters don't line up with the edition's text",
      "ESG 1:1b: TVTMS's letters don't line up with the edition's text",
      'SIR 6:2!c1: TVTMS names 3 lettered parts, the scheme lists 2',
    ]);
  });

  it('stops the ingest on a scheme-side segment an address cannot carry, and allows one on the pivot side', () => {
    expect(() => checkSchemeSegments(rows)).toThrow(/parseAddress.*brn 1KI 2:46e1/s);
    expect(() => checkSchemeSegments(rows.slice(-1))).not.toThrow();
  });
});

describe('readTvtms opens its file through pinnedPath (#63)', () => {
  it('names the download command when the file is missing, and the fix when it differs from its pin', () => {
    const root = mkdtempSync(join(tmpdir(), 'tvtms-'));
    try {
      expect(() => readTvtms(root)).toThrow(/is missing: run `bun run ingest:download` first/);
      mkdirSync(join(root, 'tvtms'));
      writeFileSync(join(root, TVTMS.file), '#DataStart(Expanded)\n#DataEnd(Expanded)\n');
      expect(() => readTvtms(root)).toThrow(/does not match its pin[\s\S]*Delete it and run `bun run ingest:download`/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const hasTvtms = existsSync(TVTMS_PATH);

describe.skipIf(!hasTvtms)('the pinned TVTMS file', () => {
  // describe.skipIf still runs this body while collecting tests.
  const schemes = loadSchemes();
  const tvtms = hasTvtms ? readTvtms() : [];
  /** The editions' word counts for the tested verses, from the last ingest (build/edition-text.json). */
  const snapshot = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'edition-text.json'), 'utf8')) as EditionTextSnapshot;
  const texts = editionTextsFromSnapshot(snapshot);
  const { pivot, rows, dropped, perScheme: compiled, diff, conflicts } = hasTvtms
    ? compileMappings(schemes, tvtms, texts)
    : { pivot: buildPivot(schemes), rows: [], dropped: [], perScheme: new Map(), diff: new Map(), conflicts: new Map() };
  const m = new Mappings(rows, new Map(schemes).set(PIVOT, pivot));

  it('keeps KJV numbering for the 66 protestant books and gives 2 Esdras 7 KJV\'s 70 verses', () => {
    for (const [book, counts] of schemes.get('kjv')!.verseCounts) expect(pivot.verseCounts.get(book), book).toEqual(counts);
    expect(pivot.verseCounts.get('2ES')![6]).toBe(70);
    expect(pivot.segments.get('REV 13:1')).toEqual(['a', 'b']);
    expect([...pivot.segments.values()].flat().every((x) => /^[a-z]+$/.test(x))).toBe(true);
  });

  it('gives every scheme-side row a segment an address can carry (#70)', () => {
    expect(rows.filter((r) => !/^[a-z]?$/.test(r.from.segment)).map((r) => `${r.scheme} ${refKey(r.from)}`)).toEqual([]);
    expect(keys(m.toPivot('brenton', ref('1KI', 2, 46, 'h')))).toEqual(['1KI 4:2', '1KI 4:3', '1KI 4:4', '1KI 4:5']);
  });

  it("maps Brenton's printed letters, which skip j, to TVTMS's ordinals", () => {
    expect(keys(m.toPivot('brenton', ref('1KI', 2, 35, 'k')))).toEqual(['1KI 9:10']);
    expect(keys(m.toPivot('brenton', ref('1KI', 2, 35, 'o')))).toEqual(['1KI 2:9']);
    expect(keys(m.toPivot('brenton', ref('1KI', 2, 46, 'l')))).toEqual(['1KI 11:42']);
    expect(keys(m.toPivot('brenton', ref('1KI', 12, 24, 'n')))).toEqual(['1KI 14:17', '1KI 14:18']);
    expect(keys(m.toPivot('brenton', ref('1KI', 12, 24, 'y')))).toEqual(['1KI 12:22', '1KI 12:23']);
    expect(keys(m.toPivot('brenton', ref('ESG', 10, 3, 'l')))).toEqual(['ESG 11:1']);
    // lxx has no edition to check the letters against, so its rows keep TVTMS's
    expect(keys(m.toPivot('lxx', ref('ESG', 10, 3, 'k')))).toEqual(['ESG 11:1']);
  });

  it('folds every TVTMS part into the one part Brenton prints (1KI 8:53a)', () => {
    expect(keys(m.toPivot('brenton', ref('1KI', 8, 53, 'a')))).toEqual(['1KI 8:12', '1KI 8:13']);
    expect(keys(m.toPivot('brenton', ref('1KI', 8, 53)))).toEqual(['1KI 8:53']);
  });

  it('maps the parts of a dropped verse nowhere, and keeps its unlettered unit', () => {
    for (const r of [ref('ESG', 1, 1, 'k'), ref('ESG', 4, 17, 'k'), ref('ESG', 8, 12, 'x')]) {
      expect(m.toPivot('brenton', r), refKey(r)).toEqual([]);
      expect(m.followsWhole('brenton', r), refKey(r)).toBe(false);
    }
    expect(keys(m.toPivot('brenton', ref('ESG', 1, 1)))).toEqual(['ESG 1:1']);
    // the pivot verses those parts held reach no Brenton part (WEB's ESG 4:19 is pivot ESG 13:9)
    for (const r of [ref('ESG', 13, 9), ref('ESG', 11, 3), ref('ESG', 16, 21)]) expect(m.fromPivot('brenton', r), refKey(r)).toEqual([]);
  });

  /**
   * Brenton verses whose lettered-part rows are dropped: TVTMS names more
   * parts than Brenton prints (ESG 4:17), or its letters don't line up with
   * Brenton's text (ESG 1:1, ESG 8:12, UNALIGNED_PARTS).
   */
  const KNOWN_DROPPED: Record<string, string[]> = { brenton: ['ESG 1:1', 'ESG 4:17', 'ESG 8:12'] };

  it('drops only the known verses whose TVTMS letters name no printed part', () => {
    const verses: Record<string, string[]> = {};
    for (const { row: r } of dropped) (verses[r.scheme] ??= []).push(`${r.from.book} ${r.from.chapter}:${r.from.verse}`);
    expect(Object.fromEntries(Object.entries(verses).map(([id, v]) => [id, [...new Set(v)].sort()]))).toEqual(KNOWN_DROPPED);
  });

  it('keeps a Latin verse whole when only its part moves (Sir 18:1)', () => {
    expect(keys(m.toPivot('vul', ref('SIR', 18, 1)))).toContain('SIR 18:1');
  });

  it('compiles rows for every scheme', () => {
    for (const [id, c] of compiled as Map<string, ReturnType<typeof compileTvtms>>) expect(c.rows.length, id).toBeGreaterThan(id === 'kjv' ? -1 : 0);
  });

  it('reads the 53 Psalm titles Hebrew prints inside verse 1 from the short tables (issue #12)', () => {
    const rows = tvtms.filter((r) => r.action === TITLE_IN_VERSE_1);
    expect(rows.length).toBe(106);
    expect(rows.filter((r) => r.source === 'Psa.23:1!a' || r.source === 'Psa.23:1!b').map((r) => [r.source, r.standard])).toEqual([
      ['Psa.23:1!a', 'Psa.23:Title'],
      ['Psa.23:1!b', 'Psa.23:1'],
    ]);
    expect(rows[0].tests).toMatch(/^Psa\.9:30=NotExist & /);
    expect(keys(m.map('kjv', 'org', ref('PSA', 23, 0)))).toEqual(['PSA 23:1a']);
    expect(keys(m.map('org', 'kjv', ref('PSA', 23, 1)))).toEqual(['PSA 23:0', 'PSA 23:1']);
    // Greek-numbered schemes keep their own titles: their Psalm 23 is Hebrew 24
    expect(keys(m.map('lxx', 'kjv', ref('PSA', 23, 0)))).toEqual(['PSA 24:0']);
  });

  it('agrees with the .vrs witness on the ADR-0006 cases', () => {
    expect(keys(m.map('eng', 'kjv', ref('REV', 12, 18)))).toEqual(['REV 13:1a']);
    expect(keys(m.map('eng', 'kjv', ref('3JN', 1, 15)))).toEqual(['3JN 1:14b']);
    expect(keys(m.map('org', 'kjv', ref('PSA', 51, 1)))).toEqual(['PSA 51:0']);
    expect(keys(m.map('org', 'kjv', ref('PSA', 51, 3)))).toEqual(['PSA 51:1']);
    expect(keys(m.map('org', 'kjv', ref('JOL', 3, 1)))).toEqual(['JOL 2:28']);
    expect(keys(m.map('vul', 'kjv', ref('DAN', 3, 91)))).toEqual(['DAN 3:24']);
  });

  it('maps the KJV numbering to itself', () => {
    expect(compiled.get('kjv')!.rows).toEqual([]);
  });

  it('gives NASB 1995, NIV and NLT the critical order of Philippians 1:16-17 too (#20)', () => {
    for (const id of ['nasb95', 'niv', 'nlt']) {
      expect(keys(m.map(id, 'kjv', ref('PHP', 1, 16))), id).toEqual(['PHP 1:17']);
      expect(keys(m.map(id, 'kjv', ref('PHP', 1, 17))), id).toEqual(['PHP 1:16']);
    }
  });

  it("keeps a scheme's text decisions only for tests its editions read as close (ADR-0006)", () => {
    const tested = new Set(tvtms.flatMap((r) => r.tests.split('&').map((t) => t.trim())));
    for (const s of schemes.values()) {
      for (const test of s.textDecisions?.keys() ?? []) {
        expect(tested.has(test), `${s.id} ${test} is a TVTMS test`).toBe(true);
        const editions = texts.get(s.id) ?? [];
        expect(editions.length, `${s.id} has editions`).toBeGreaterThan(0);
        for (const text of editions) expect(evaluateTextTest(test, text), `${s.id} ${text.edition} ${test}`).toBe('close');
      }
    }
  });

  it('gives BSB the critical order of Philippians 1:16-17 and KJV its own', () => {
    expect(keys(m.map('bsb', 'kjv', ref('PHP', 1, 16)))).toEqual(['PHP 1:17']);
    expect(keys(m.map('bsb', 'kjv', ref('PHP', 1, 17)))).toEqual(['PHP 1:16']);
    expect(keys(m.toPivot('kjv', ref('PHP', 1, 16)))).toEqual(['PHP 1:16']);
  });

  it('finds no edition whose text maps a verse differently from its scheme', () => {
    expect(Object.fromEntries(conflicts)).toEqual({});
  });

  it('stops BSB from sharing the kjv scheme with KJV', () => {
    const shared = editionTextsFromSnapshot({ ...snapshot, BSB: { ...snapshot.BSB, scheme: 'kjv' } });
    const c = compileMappings(schemes, tvtms, shared).conflicts;
    expect([...c.keys()]).toEqual(['BSB']);
    expect(c.get('BSB')).toEqual(['PHP 1:16\tBSB: PHP 1:17\tkjv: PHP 1:16', 'PHP 1:17\tBSB: PHP 1:16\tkjv: PHP 1:17']);
  }, 60_000); // a second full compile

  it('stores TVTMS rows where TVTMS decides and .vrs rows only where it cannot', () => {
    for (const r of rows.filter((x) => x.source === 'vrs')) {
      expect(compiled.get(r.scheme)!.decided.has(refKey(r.from))).toBe(false);
    }
    expect(rows.some((r) => r.source === 'tvtms')).toBe(true);
  });

  it('reports where TVTMS and the .vrs files disagree', () => {
    expect(diff.has('kjv')).toBe(false);
    expect(diff.has('rp')).toBe(false);
    expect(diff.has('brenton')).toBe(true); // through the rows it takes from lxx
    for (const [id, lines] of diff) for (const l of lines) expect(l, id).toMatch(/^\S+ \d+:\d+\S*\ttvtms: .*\tvrs: /);
  });

  /** The upstream ESG inconsistencies of pivot.test.ts, now only through `.vrs` fill-in rows. */
  const KNOWN: Record<string, number> = { org: 2, vul: 2, rso: 15 };
  /**
   * Derived schemes: verses in a chapter the scheme changes, where TVTMS
   * decides nothing even with the edition's text and no base `.vrs` row
   * applies. Brenton's are 2 Esdras 14 and 19, Proverbs 24:35-62 and Sirach
   * 30; WEB's are Baruch 1:22 and 4 Maccabees 7:24-25.
   */
  const KNOWN_DERIVED: Record<string, number> = { web: 3, brenton: 97 };

  it.each([...schemes.keys()])('maps every %s verse into the pivot, apart from known gaps', (id) => {
    const problems = checkCoverage(schemes.get(id)!, pivot, rows);
    const derived = DERIVED_SCHEMES.find((d) => d.id === id);
    if (!derived) {
      expect(problems.length, problems.join('\n')).toBe(KNOWN[id] ?? 0);
      expect(problems.every((p) => p.startsWith('ESG '))).toBe(true);
      return;
    }
    expect(problems.length, problems.slice(0, 10).join('\n')).toBe(KNOWN_DERIVED[id] ?? 0);
    const changed = new Set(derived.lastVerses.map(([b, c]) => `${b} ${c}`));
    for (const p of problems) expect(changed.has(p.replace(/:.*/, '')), p).toBe(true);
  });

  it('extends the committed pivot without removing anything', () => {
    const committed = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'pivot.json'), 'utf8'));
    expect(checkExtendOnly(committed, pivotSnapshot(pivot))).toEqual([]);
  });
});

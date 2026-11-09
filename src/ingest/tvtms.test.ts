import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Mappings, PIVOT, checkCoverage, refKey, type Ref } from '../model/mapping';
import type { Scheme } from '../model/scheme';
import { buildPivot, checkExtendOnly, pivotSnapshot } from './pivot';
import { DERIVED_SCHEMES, loadSchemes } from './schemes';
import {
  TVTMS_PATH,
  compileTvtms,
  compileMappings,
  evaluateTests,
  parseStandardRefs,
  parseTvtms,
  readTvtms,
} from './tvtms';

const ref = (book: string, chapter: number, verse: number, segment = ''): Ref => ({ book, chapter, verse, segment });
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

const hasTvtms = existsSync(TVTMS_PATH);

describe.skipIf(!hasTvtms)('the pinned TVTMS file', () => {
  // describe.skipIf still runs this body while collecting tests.
  const schemes = loadSchemes();
  const tvtms = hasTvtms ? readTvtms() : [];
  const { pivot, rows, perScheme: compiled, diff } = hasTvtms
    ? compileMappings(schemes, tvtms)
    : { pivot: buildPivot(schemes), rows: [], perScheme: new Map(), diff: new Map() };
  const m = new Mappings(rows, new Map(schemes).set(PIVOT, pivot));

  it('keeps KJV numbering for the 66 protestant books and gives 2 Esdras 7 KJV\'s 70 verses', () => {
    for (const [book, counts] of schemes.get('kjv')!.verseCounts) expect(pivot.verseCounts.get(book), book).toEqual(counts);
    expect(pivot.verseCounts.get('2ES')![6]).toBe(70);
    expect(pivot.segments.get('REV 13:1')).toEqual(['a', 'b']);
    expect([...pivot.segments.values()].flat().every((x) => /^[a-z]+$/.test(x))).toBe(true);
  });

  it('keeps a Latin verse whole when only its part moves (Sir 18:1)', () => {
    expect(keys(m.toPivot('vul', ref('SIR', 18, 1)))).toContain('SIR 18:1');
  });

  it('compiles rows for every scheme', () => {
    for (const [id, c] of compiled as Map<string, ReturnType<typeof compileTvtms>>) expect(c.rows.length, id).toBeGreaterThan(id === 'kjv' ? -1 : 0);
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

  it('stores TVTMS rows where TVTMS decides and .vrs rows only where it cannot', () => {
    for (const r of rows.filter((x) => x.source === 'vrs')) {
      expect(compiled.get(r.scheme)!.decided.has(refKey(r.from))).toBe(false);
    }
    expect(rows.some((r) => r.source === 'tvtms')).toBe(true);
  });

  it('reports where TVTMS and the .vrs files disagree', () => {
    expect(diff.get('kjv')).toEqual([]);
    for (const [id, lines] of diff) for (const l of lines) expect(l, id).toMatch(/^\S+ \d+:\d+\S*\ttvtms: .*\tvrs: /);
  });

  /** The upstream ESG inconsistencies of pivot.test.ts, now only through `.vrs` fill-in rows. */
  const KNOWN: Record<string, number> = { org: 2, vul: 2, rso: 15 };
  /**
   * Derived schemes: verses in a chapter the scheme changes, where TVTMS
   * decides nothing without the edition's text (`needsText`) and no base
   * `.vrs` row applies. Brenton's are 2 Esdras 14 and 19, Proverbs 24:35-62
   * and Sirach 30 and 36; WEB's are Baruch 1:22 and 4 Maccabees 7:24-25.
   */
  const KNOWN_DERIVED: Record<string, number> = { web: 3, brenton: 102 };

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

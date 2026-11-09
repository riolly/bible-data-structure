import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Mappings, PIVOT, checkCoverage, refKey, type Ref } from '../model/mapping';
import type { Scheme } from '../model/scheme';
import { allVrsPivotRows, buildPivot, checkExtendOnly, pivotSnapshot } from './pivot';
import { loadSchemes } from './schemes';
import {
  TVTMS_PATH,
  compileTvtms,
  diffWitnesses,
  engToPivotRows,
  evaluateTests,
  extendPivot,
  mergeWitnesses,
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
    ['Gen.2:25-3:1', ['GEN 2:25', 'GEN 3:1']],
    ['Jol.2:28-30', ['JOL 2:28', 'JOL 2:29', 'JOL 2:30']],
    ['Gen.5:32; 6:1', ['GEN 5:32', 'GEN 6:1']],
    ['Est.1:1; 2:1,3-4', ['EST 1:1', 'EST 2:1', 'EST 2:3', 'EST 2:4']],
    ['Jos.9:2!0', ['JOS 9:2!0']],
    ['Sir.1:1; Est.2:2', ['SIR 1:1', 'EST 2:2']],
    ['4Es.10:59', ['2ES 10:59']],
  ])('%s', (text, expected) => {
    expect(parseStandardRefs(text).map((r) => (/^\d/.test(r.segment) ? `${r.book} ${r.chapter}:${r.verse}!${r.segment}` : refKey(r)))).toEqual(expected);
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

  it('reads only the expanded section', () => {
    expect(parseTvtms(text).map((r) => r.source)).toEqual(['Jol.3:1', 'Jol.4:1', 'Jol.1:1', 'Jol.1:2', 'Ade.1:1']);
  });

  it('keeps rows whose count tests pass, drops identity, defers text tests, skips unknown books', () => {
    const c = compileTvtms(parseTvtms(text), scheme([20, 27, 5, 21]));
    expect(c.rows.map((r) => `${refKey(r.from)}>${r.to ? refKey(r.to) : '-'} ${r.kind}`)).toEqual([
      'JOL 3:1>JOL 2:28 Renumber verse',
      'JOL 4:1>JOL 3:1 Renumber verse',
    ]);
    expect(c.needsText).toHaveLength(1);
    expect(c.skipped.map((s) => s.reason)).toEqual([expect.stringMatching(/no USFM code/)]);
  });

  it('compiles nothing for a scheme the tests reject', () => {
    expect(compileTvtms(parseTvtms(text), scheme([20, 32, 21])).rows).toEqual([]);
  });
});

const hasTvtms = existsSync(TVTMS_PATH);

describe.skipIf(!hasTvtms)('the pinned TVTMS file', () => {
  // describe.skipIf still runs this body while collecting tests.
  const schemes = loadSchemes();
  const tvtms = hasTvtms ? readTvtms() : [];
  const seed = buildPivot(schemes);
  const pivot = extendPivot(seed, tvtms);
  const compiled = new Map([...schemes.keys()].map((id) => [id, compileTvtms(tvtms, schemes.get(id)!)]));
  const vrsRows = allVrsPivotRows(schemes, engToPivotRows(compiled.get('eng')!));
  const rows = mergeWitnesses(compiled, vrsRows);
  const m = new Mappings(rows, new Map(schemes).set(PIVOT, pivot));

  it('extends the seeded pivot without removing anything', () => {
    expect(checkExtendOnly(pivotSnapshot(seed), pivotSnapshot(pivot))).toEqual([]);
    expect(pivot.segments.get('REV 13:1')).toEqual(['a', 'b']);
  });

  it('compiles rows for every scheme', () => {
    for (const [id, c] of compiled) expect(c.rows.length, id).toBeGreaterThan(id === 'kjv' ? -1 : 0);
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
    expect(rows.filter((r) => r.source === 'tvtms').length).toBeGreaterThan(rows.length / 2);
  });

  it('reports where TVTMS and the .vrs files disagree', () => {
    const diff = diffWitnesses(compiled, vrsRows);
    expect(diff.get('kjv')).toEqual([]);
    for (const [id, lines] of diff) for (const l of lines) expect(l, id).toMatch(/^\S+ \d+:\d+\S*\ttvtms: .*\tvrs: /);
  });

  /** The upstream ESG inconsistencies of pivot.test.ts, now only through `.vrs` fill-in rows. */
  const KNOWN: Record<string, number> = { org: 2, vul: 2, rso: 14 };

  it.each([...schemes.keys()])('maps every %s verse into the pivot, apart from known upstream ESG lines', (id) => {
    const problems = checkCoverage(schemes.get(id)!, pivot, rows);
    expect(problems.length, problems.join('\n')).toBe(KNOWN[id] ?? 0);
    expect(problems.every((p) => p.startsWith('ESG '))).toBe(true);
  });

  it('extends the committed pivot without removing anything', () => {
    const committed = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'pivot.json'), 'utf8'));
    expect(checkExtendOnly(committed, pivotSnapshot(pivot))).toEqual([]);
  });
});

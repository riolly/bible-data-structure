import { describe, expect, it } from 'vitest';

import { Mappings, PIVOT, Relation, checkCoverage, parseRefKey, ref, refKey, type MappingRow } from './mapping';
import type { Scheme } from './scheme';

const scheme = (id: string, counts: Record<string, number[]>, extra: Partial<Scheme> = {}): Scheme => ({
  id,
  name: id,
  sourceUrl: '',
  note: '',
  verseCounts: new Map(Object.entries(counts)),
  excluded: new Set(),
  segments: new Map(),
  titles: new Set(),
  ...extra,
});

/** Revelation with chapter 12 ending at `last12` and 18 verses in chapter 13. */
const rev = (last12: number) => [...Array(11).fill(1), last12, 18];

// A pivot with KJV-like Joel and Rev 13:1 split in two; `heb` numbers Joel 2:28-32
// as 3:1-5; `nrs` has Rev 12:18.
const pivot = scheme(PIVOT, { JOL: [20, 32, 21], REV: rev(17) }, { segments: new Map([['REV 13:1', ['a', 'b']]]) });
const heb = scheme('heb', { JOL: [20, 27, 5, 21], REV: rev(17) });
const nrs = scheme('nrs', { JOL: [20, 32, 21], REV: rev(18) });
const rows: MappingRow[] = [
  ...[1, 2, 3, 4, 5].map((v) => ({ scheme: 'heb', from: ref('JOL', 3, v), to: ref('JOL', 2, 27 + v), kind: 'renumber' })),
  ...Array.from({ length: 21 }, (_, i) => ({ scheme: 'heb', from: ref('JOL', 4, i + 1), to: ref('JOL', 3, i + 1), kind: 'renumber' })),
  { scheme: 'nrs', from: ref('REV', 12, 18), to: ref('REV', 13, 1, 'a'), kind: 'renumber' },
  { scheme: 'nrs', from: ref('REV', 13, 1), to: ref('REV', 13, 1, 'b'), kind: 'renumber' },
];
const schemes = new Map([[PIVOT, pivot], ['heb', heb], ['nrs', nrs], ['kjv', scheme('kjv', { JOL: [20, 32, 21], REV: rev(17) })]]);
const m = new Mappings(rows, schemes);

describe('Mappings', () => {
  it('is identity where no row speaks', () => {
    expect(m.map('heb', 'kjv', ref('JOL', 1, 1))).toEqual([ref('JOL', 1, 1)]);
  });

  it('moves a verse across chapters and back', () => {
    expect(m.map('heb', 'kjv', ref('JOL', 3, 1))).toEqual([ref('JOL', 2, 28)]);
    expect(m.map('kjv', 'heb', ref('JOL', 2, 28))).toEqual([ref('JOL', 3, 1)]);
    expect(m.map('kjv', 'heb', ref('JOL', 3, 21))).toEqual([ref('JOL', 4, 21)]);
  });

  it('maps a whole verse to every part of it, and a part to its own source', () => {
    expect(m.map('kjv', 'nrs', ref('REV', 13, 1))).toEqual([ref('REV', 12, 18), ref('REV', 13, 1)]);
    expect(m.map('kjv', 'nrs', ref('REV', 13, 1, 'a'))).toEqual([ref('REV', 12, 18)]);
    expect(m.map('nrs', 'kjv', ref('REV', 12, 18))).toEqual([ref('REV', 13, 1, 'a')]);
  });

  it('drops a whole verse when one of its own parts covers the same target (TVTMS gives both)', () => {
    // org-style ACT 19:40-41: the whole verse concatenates two pivot verses, and its parts map one each.
    const pv = scheme(PIVOT, { ACT: [...Array(18).fill(1), 41] });
    const org = scheme('org', { ACT: [...Array(18).fill(1), 40] });
    const kjv = scheme('kjv', { ACT: [...Array(18).fill(1), 41] });
    const acts = new Mappings(
      [
        { scheme: 'org', from: ref('ACT', 19, 40), to: ref('ACT', 19, 40), kind: 'Concatenation' },
        { scheme: 'org', from: ref('ACT', 19, 40), to: ref('ACT', 19, 41), kind: 'Concatenation' },
        { scheme: 'org', from: ref('ACT', 19, 40, 'a'), to: ref('ACT', 19, 40), kind: 'Keep verse' },
        { scheme: 'org', from: ref('ACT', 19, 40, 'b'), to: ref('ACT', 19, 41), kind: 'MergedPrev verse' },
      ],
      new Map([[PIVOT, pv], ['org', org], ['kjv', kjv]]),
    );
    expect(acts.map('kjv', 'org', ref('ACT', 19, 41))).toEqual([ref('ACT', 19, 40, 'b')]);
    expect(acts.map('kjv', 'org', ref('ACT', 19, 40))).toEqual([ref('ACT', 19, 40, 'a')]);
    expect(acts.map('org', 'kjv', ref('ACT', 19, 40))).toEqual([ref('ACT', 19, 40), ref('ACT', 19, 41)]);
  });

  it('returns nothing where the target scheme lacks the verse', () => {
    // kjv's 12:17 is the last verse of Revelation 12; pivot 12:18 does not exist anywhere.
    expect(m.fromPivot('kjv', ref('REV', 12, 18))).toEqual([]);
  });

  it('rejects an unknown scheme', () => {
    expect(() => m.map('av11n', 'kjv', ref('JOL', 1, 1))).toThrow(/unknown scheme/);
  });
});

describe('Relation.forward with part rows', () => {
  it('sends a whole verse to its own row and its parts rows', () => {
    // TVTMS Latin Sir 18:1 keeps its number while 18:1b becomes 18:2.
    const r = new Relation([
      { from: ref('SIR', 18, 1), to: ref('SIR', 18, 1) },
      { from: ref('SIR', 18, 1, 'b'), to: ref('SIR', 18, 2) },
    ]);
    expect(r.forward(ref('SIR', 18, 1))).toEqual([ref('SIR', 18, 1), ref('SIR', 18, 2)]);
    expect(r.forward(ref('SIR', 18, 1, 'b'))).toEqual([ref('SIR', 18, 2)]);
    expect(r.forward(ref('SIR', 18, 1, 'a'))).toEqual([ref('SIR', 18, 1)]);
  });

  it('keeps keys apart for long segments', () => {
    expect(refKey(ref('2ES', 7, 35, 'aa'))).toBe('2ES 7:35!aa');
    expect(refKey(ref('ESG', 1, 1, 'a'))).not.toBe(refKey(ref('ESG', 1, 10)));
    expect(parseRefKey('2ES 7:35!aa')).toEqual(ref('2ES', 7, 35, 'aa'));
    expect(parseRefKey('REV 13:1a')).toEqual(ref('REV', 13, 1, 'a'));
  });
});

describe('checkCoverage (replaces the bijection check)', () => {
  it('passes when every verse lands in the pivot', () => {
    expect(checkCoverage(heb, pivot, rows)).toEqual([]);
    expect(checkCoverage(nrs, pivot, rows)).toEqual([]);
  });

  it('reports a verse that lands outside the pivot', () => {
    const bad = scheme('bad', { JOL: [20, 32, 22] });
    expect(checkCoverage(bad, pivot, [])).toEqual(['JOL 3:22 maps to JOL 3:22, which the pivot lacks']);
  });

  it('accepts a verse explicitly marked absent', () => {
    const bad = scheme('bad', { JOL: [20, 32, 22] });
    const absent: MappingRow = { scheme: 'bad', from: ref('JOL', 3, 22), to: null, kind: 'absent' };
    expect(checkCoverage(bad, pivot, [absent])).toEqual([]);
  });

  it('accepts a verse whose parts are all marked absent', () => {
    const bad = scheme('bad', { JOL: [20, 32, 22] });
    const parts: MappingRow[] = ['a', 'b'].map((seg) => ({ scheme: 'bad', from: ref('JOL', 3, 22, seg), to: null, kind: 'absent' }));
    expect(checkCoverage(bad, pivot, parts)).toEqual([]);
  });

  it('allows many-to-one rows that the old bijection check rejected', () => {
    const two: MappingRow[] = [
      { scheme: 'heb', from: ref('JOL', 3, 1), to: ref('JOL', 2, 28), kind: 'merge' },
      { scheme: 'heb', from: ref('JOL', 3, 2), to: ref('JOL', 2, 28), kind: 'merge' },
    ];
    const mm = new Mappings(two, schemes);
    expect(mm.map('kjv', 'heb', ref('JOL', 2, 28))).toEqual([ref('JOL', 3, 1), ref('JOL', 3, 2)]);
  });
});

describe('a part letter the rows do not use (#71)', () => {
  it('follows its whole verse when the scheme rows divide that verse into other parts', () => {
    const r = new Relation([
      { from: ref('XYZ', 5, 1, 'a'), to: ref('XYZ', 5, 1) },
      { from: ref('XYZ', 5, 1, 'b'), to: ref('XYZ', 5, 2) },
    ]);
    expect(r.forward(ref('XYZ', 5, 1, 'c'))).toEqual([ref('XYZ', 5, 1), ref('XYZ', 5, 2)]);
    expect(r.followsWhole(ref('XYZ', 5, 1, 'c'))).toBe(true);
    expect(r.followsWhole(ref('XYZ', 5, 1, 'a'))).toBe(false);
  });

  it('follows its whole verse when the pivot divides that verse into other parts', () => {
    // kjv has no rows for REV 13:1; the pivot divides it into a and b
    expect(m.map('kjv', 'nrs', ref('REV', 13, 1, 'c'))).toEqual([ref('REV', 12, 18), ref('REV', 13, 1)]);
    expect(m.followsWhole('kjv', ref('REV', 13, 1, 'c'))).toBe(true);
    expect(m.map('kjv', 'nrs', ref('REV', 13, 1, 'a'))).toEqual([ref('REV', 12, 18)]);
    expect(m.followsWhole('kjv', ref('REV', 13, 1, 'a'))).toBe(false);
    // a verse nobody divides keeps the letter, and the target marks the part (JHN 3:16c)
    expect(m.map('kjv', 'nrs', ref('JOL', 1, 1, 'c'))).toEqual([ref('JOL', 1, 1, 'c')]);
    expect(m.followsWhole('kjv', ref('JOL', 1, 1, 'c'))).toBe(false);
  });
});

describe('a verse printed as an unlettered first part and lettered parts (#69)', () => {
  // Brenton prints 1KI 2:35, then 35a and 35b, text copied from 4:29 and 3:1
  const kgs = scheme('brn', { '1KI': [46, 35] }, { segments: new Map([['1KI 2:35', ['', 'a', 'b']]]) });
  const kjv1 = scheme('kjv', { '1KI': [46, 35, 28, 34] });
  const pv = scheme(PIVOT, { '1KI': [46, 35, 28, 34] });
  const parts: MappingRow[] = [
    { scheme: 'brn', from: ref('1KI', 2, 35, 'a'), to: ref('1KI', 4, 29), kind: 'CopiedFrom verse' },
    { scheme: 'brn', from: ref('1KI', 2, 35, 'b'), to: ref('1KI', 3, 1), kind: 'CopiedFrom verse' },
  ];
  const mm = new Mappings(parts, new Map([[PIVOT, pv], ['brn', kgs], ['kjv', kjv1]]));

  it('maps the address without a letter to the unlettered unit only, both ways', () => {
    expect(mm.map('kjv', 'brn', ref('1KI', 2, 35))).toEqual([ref('1KI', 2, 35)]);
    expect(mm.map('brn', 'kjv', ref('1KI', 2, 35))).toEqual([ref('1KI', 2, 35)]);
    // each lettered part is a unit of its own, with its own row
    expect(mm.map('brn', 'kjv', ref('1KI', 2, 35, 'a'))).toEqual([ref('1KI', 4, 29)]);
  });

  it('keeps the unlettered unit when a lettered part lands on the same verse (TVTMS 1KI 12:24w)', () => {
    const w: MappingRow = { scheme: 'brn', from: ref('1KI', 2, 35, 'b'), to: ref('1KI', 2, 35), kind: 'CopiedFrom verse' };
    const mw = new Mappings([parts[0], w], new Map([[PIVOT, pv], ['brn', kgs], ['kjv', kjv1]]));
    expect(mw.map('kjv', 'brn', ref('1KI', 2, 35))).toEqual([ref('1KI', 2, 35, 'b'), ref('1KI', 2, 35)]);
  });

  it("reads a row at the verse without a letter as the unlettered unit's row (ESG 3:13 to Hebrew EST 3:13)", () => {
    const rel = new Relation([...parts, { from: ref('1KI', 2, 35), to: ref('1KI', 2, 36) }], new Set(['1KI 2:35']));
    expect(rel.forward(ref('1KI', 2, 35))).toEqual([ref('1KI', 2, 36)]);
    expect(rel.backward(ref('1KI', 2, 35), () => true)).toEqual([]);
    // a lettered unit with no row keeps its own address: it doesn't take the unlettered unit's row
    expect(rel.forward(ref('1KI', 2, 35, 'c'))).toEqual([ref('1KI', 2, 35, 'c')]);
    expect(rel.followsWhole(ref('1KI', 2, 35, 'c'))).toBe(false);
  });

  it('moves the lettered units with the verse when only the verse has a row (Brenton PSA 144:13a)', () => {
    const rel = new Relation([{ from: ref('1KI', 2, 35), to: ref('1KI', 2, 36) }], new Set(['1KI 2:35']));
    expect(rel.forward(ref('1KI', 2, 35, 'a'))).toEqual([ref('1KI', 2, 36)]);
    expect(rel.forward(ref('1KI', 2, 35))).toEqual([ref('1KI', 2, 36)]);
    expect(rel.followsWhole(ref('1KI', 2, 35, 'a'))).toBe(false);
  });

  it('gives a lettered unit with an absent row no counterpart', () => {
    const rel = new Relation([{ from: ref('1KI', 2, 35, 'a'), to: null }], new Set(['1KI 2:35']));
    expect(rel.forward(ref('1KI', 2, 35, 'a'))).toEqual([]);
    expect(rel.forward(ref('1KI', 2, 35))).toEqual([ref('1KI', 2, 35)]);
  });

  it('leaves verses whose lettered parts make up the whole verse as they were (kjv REV 13:1)', () => {
    const rel = new Relation(parts);
    expect(rel.forward(ref('1KI', 2, 35))).toEqual([ref('1KI', 4, 29), ref('1KI', 3, 1)]);
    expect(rel.backward(ref('1KI', 2, 35), () => true)).toEqual([]);
  });

  it('passes the coverage check', () => {
    expect(checkCoverage(kgs, pv, parts)).toEqual([]);
  });
});

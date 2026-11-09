import { describe, expect, it } from 'vitest';

import { Mappings, PIVOT, checkCoverage, type MappingRow } from './mapping';
import type { Scheme } from './scheme';

const ref = (book: string, chapter: number, verse: number, segment = '') => ({ book, chapter, verse, segment });
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

  it('returns nothing where the target scheme lacks the verse', () => {
    // kjv's 12:17 is the last verse of Revelation 12; pivot 12:18 does not exist anywhere.
    expect(m.fromPivot('kjv', ref('REV', 12, 18))).toEqual([]);
  });

  it('rejects an unknown scheme', () => {
    expect(() => m.map('av11n', 'kjv', ref('JOL', 1, 1))).toThrow(/unknown scheme/);
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

  it('allows many-to-one rows that the old bijection check rejected', () => {
    const two: MappingRow[] = [
      { scheme: 'heb', from: ref('JOL', 3, 1), to: ref('JOL', 2, 28), kind: 'merge' },
      { scheme: 'heb', from: ref('JOL', 3, 2), to: ref('JOL', 2, 28), kind: 'merge' },
    ];
    const mm = new Mappings(two, schemes);
    expect(mm.map('kjv', 'heb', ref('JOL', 2, 28))).toEqual([ref('JOL', 3, 1), ref('JOL', 3, 2)]);
  });
});

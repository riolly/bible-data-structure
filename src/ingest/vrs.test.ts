import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseVrs, parseVrsCounts } from './vrs';

const ref = (book: string, chapter: number, verse: number, segment = '') => ({ book, chapter, verse, segment });

describe('parseVrsCounts (libpalaso count-line rules)', () => {
  it('reads count lines and excluded verses, skipping comments and mappings', () => {
    const { verseCounts, excluded } = parseVrsCounts(
      ['# header', 'GEN 1:31 2:25', '-GEN 2:7', 'GEN 1:1 = GEN 1:2', '*GEN 1:5,-,a,b'].join('\n'),
    );
    expect(verseCounts.get('GEN')).toEqual([31, 25]);
    expect([...excluded]).toEqual(['GEN 2:7']);
  });

  it('fills skipped chapters with one verse, as Paratext does', () => {
    // vul.vrs line 156 reads `6EZ 1:63 12:78`.
    const counts = parseVrsCounts('6EZ 1:63 12:78').verseCounts.get('6EZ')!;
    expect(counts).toHaveLength(12);
    expect(counts[1]).toBe(1);
    expect(counts[11]).toBe(78);
  });

  it('lets a later line update a book and END truncate it', () => {
    expect(parseVrsCounts('PSA 1:6 2:12 3:8\nPSA 2:13').verseCounts.get('PSA')).toEqual([6, 13, 8]);
    expect(parseVrsCounts('PSA 1:6 2:12 3:8\nPSA 1:6 END').verseCounts.get('PSA')).toEqual([6]);
  });

  it('reads a #! line as a real line', () => {
    expect([...parseVrsCounts('#! -ACT 19:41').excluded]).toEqual(['ACT 19:41']);
  });

  it('throws on a malformed count', () => {
    expect(() => parseVrsCounts('GEN 1:x')).toThrow(/bad count/);
    expect(() => parseVrsCounts('-GEN 1:1\n-GEN 1:1')).toThrow(/twice/);
  });
});

describe('parseVrs mapping lines (the ADR-0006 real cases)', () => {
  const vrs = parseVrs(readFileSync(join(import.meta.dirname, 'fixtures', 'real-cases.vrs'), 'utf8'));
  const targets = (from: ReturnType<typeof ref>) =>
    vrs.mappings.filter((m) => JSON.stringify(m.from) === JSON.stringify(from)).map((m) => m.to);
  const sources = (to: ReturnType<typeof ref>) =>
    vrs.mappings.filter((m) => JSON.stringify(m.to) === JSON.stringify(to)).map((m) => m.from);

  it('maps two verses onto one Psalm title (many-to-one)', () => {
    expect(targets(ref('PSA', 51, 0))).toEqual([ref('PSA', 51, 1), ref('PSA', 51, 2)]);
    expect(targets(ref('PSA', 51, 19))).toEqual([ref('PSA', 51, 21)]);
  });

  it('maps across chapters', () => {
    expect(targets(ref('ROM', 14, 24))).toEqual([ref('ROM', 16, 25)]);
    expect(targets(ref('ROM', 14, 26))).toEqual([ref('ROM', 16, 27)]);
  });

  it('maps across books', () => {
    expect(targets(ref('DAN', 3, 24))).toEqual([ref('S3Y', 1, 1)]);
    expect(targets(ref('DAN', 3, 90))).toEqual([ref('S3Y', 1, 67)]);
    expect(targets(ref('DAN', 3, 91))).toEqual([ref('DAN', 3, 24)]);
  });

  it('reads a #! & line as a range onto one verse', () => {
    expect(sources(ref('ACT', 19, 40))).toEqual([ref('ACT', 19, 40), ref('ACT', 19, 41)]);
  });

  it('reads segments on either side and segment definitions', () => {
    expect(targets(ref('ESG', 1, 1))).toEqual([ref('ESG', 1, 1, 'a')]);
    expect(vrs.segments.get('JOS 9:2')).toEqual(['', 'a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('reads a lossy line as Paratext does, and warns', () => {
    expect(targets(ref('PSA', 141, 0))).toEqual([ref('PSA', 142, 0)]);
    expect(vrs.warnings.some((w) => w.includes('PSA 141:0 = PSA 142:0-1'))).toBe(true);
  });

  it('throws on an unreadable mapping line', () => {
    expect(() => parseVrs('GEN 1:1 = Genesis 1:2')).toThrow(/unreadable/);
    expect(() => parseVrs('GEN 1:1-3 = GEN 1:1-3 = GEN 1:1')).toThrow();
  });
});

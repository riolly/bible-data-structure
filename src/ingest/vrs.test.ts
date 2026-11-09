import { describe, expect, it } from 'vitest';

import { parseVrsCounts } from './vrs';

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

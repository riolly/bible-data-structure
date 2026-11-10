import { describe, expect, it } from 'vitest';

import { wordsStamp } from './edition';

const tok = (verse: number, wordIndex: number | null, text: string, segment = '') => ({ chapter: 1, verse, segment, wordIndex, text });
const stamp = (tokens: ReturnType<typeof tok>[]) => {
  const s = wordsStamp();
  s.add('GEN', tokens);
  return s.digest();
};

describe('wordsStamp (ADR-0005 amendment)', () => {
  const base = [tok(1, 0, 'In'), tok(1, 1, 'the'), tok(1, null, ','), tok(1, 2, 'beginning')];

  it('is the same for the same words at the same addresses, whatever the punctuation', () => {
    expect(stamp(base)).toBe(stamp([...base.slice(0, 2), tok(1, null, ';'), base[3]]));
  });

  it('changes when a word, its index or its segment changes', () => {
    expect(stamp(base)).not.toBe(stamp([...base.slice(0, 3), tok(1, 2, 'Beginning')]));
    // a mark that stops counting as a word moves the later indexes (ADR-0004 v1.3)
    expect(stamp(base)).not.toBe(stamp([tok(1, 0, 'In'), tok(1, 1, 'the'), tok(1, 3, 'beginning')]));
    expect(stamp(base)).not.toBe(stamp([...base.slice(0, 3), tok(1, 2, 'beginning', 'a')]));
  });

  it('hashes a word in a bridge with its range, and other words as before (ADR-0004 v1.5)', () => {
    const units = [{ chapter: 1, verse: 1, lastVerse: 2, segment: '' }];
    const s = wordsStamp();
    s.add('GEN', base, units);
    expect(s.digest()).not.toBe(stamp(base));
    const single = wordsStamp();
    single.add('GEN', base, [{ chapter: 1, verse: 1, lastVerse: 1, segment: '' }]);
    expect(single.digest()).toBe(stamp(base));
  });
});

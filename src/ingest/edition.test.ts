import { describe, expect, it } from 'vitest';

import { chapterStampAsync } from '../model/chapter-stamp';
import { chapterStamp, textStamp, wordsStamp } from './edition';

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

describe('chapterStamp and textStamp (ADR-0005 amendment, 2026-11-11)', () => {
  const doc = (footnote: string) =>
    JSON.stringify([{ type: 'para', marker: 'p', content: ['In the beginning', { type: 'note', marker: 'f', caller: '+', content: [footnote] }] }]);
  const verse = (text: string) => [{ verse: 1, lastVerse: 1, segment: '', text }];
  const base = chapterStamp(doc('Or at first'), verse('In the beginning,'));

  it('keeps the value it had before its input moved to src/model/chapter-stamp.ts', async () => {
    expect(base).toBe('sha256:5e516e7d234d8885');
    expect(await chapterStampAsync(doc('Or at first'), verse('In the beginning,'))).toBe(base);
  });

  it('is the same for the same document and verse text', () => {
    expect(chapterStamp(doc('Or at first'), verse('In the beginning,'))).toBe(base);
  });

  it('changes with punctuation in the verse text, which the words stamp skips', () => {
    expect(chapterStamp(doc('Or at first'), verse('In the beginning;'))).not.toBe(base);
  });

  it('changes with a note or anything else in the document', () => {
    expect(chapterStamp(doc('Or first'), verse('In the beginning,'))).not.toBe(base);
  });

  it('changes when a number moves into a bridge', () => {
    expect(chapterStamp(doc('Or at first'), [{ verse: 1, lastVerse: 2, segment: '', text: 'In the beginning,' }])).not.toBe(base);
  });

  it('the text stamp changes with any chapter stamp', () => {
    const of = (stamps: string[]) => {
      const t = textStamp();
      t.add('GEN', stamps.map((stamp, i) => ({ chapter: i + 1, stamp })));
      return t.digest();
    };
    expect(of(['a', 'b'])).toBe(of(['a', 'b']));
    expect(of(['a', 'c'])).not.toBe(of(['a', 'b']));
  });
});

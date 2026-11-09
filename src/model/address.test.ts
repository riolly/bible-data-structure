import { describe, expect, it } from 'vitest';

import { formatAddress, parseAddress, type Address } from './address';

/** ADR-0002 "Address syntax". Strings count words from 1, storage from 0. */
describe('parseAddress', () => {
  it('parses a verse under a named scheme', () => {
    expect(parseAddress('PSA 51:3/org')).toEqual({
      scheme: 'org',
      start: { book: 'PSA', chapter: 51, verse: 3, segment: '' },
    });
  });

  it('allows verse 0 for a Psalm title', () => {
    expect(parseAddress('PSA 51:0/eng').start.verse).toBe(0);
  });

  it('parses a one-letter segment', () => {
    expect(parseAddress('REV 13:1a/kjv').start).toEqual({
      book: 'REV',
      chapter: 13,
      verse: 1,
      segment: 'a',
    });
  });

  it('parses a range whose end is a verse in the same chapter', () => {
    expect(parseAddress('GEN 1:1-31/kjv')).toEqual({
      scheme: 'kjv',
      start: { book: 'GEN', chapter: 1, verse: 1, segment: '' },
      end: { book: 'GEN', chapter: 1, verse: 31, segment: '' },
    });
  });

  it('parses a range that crosses a chapter', () => {
    expect(parseAddress('GEN 1:1-2:3/kjv').end).toEqual({
      book: 'GEN',
      chapter: 2,
      verse: 3,
      segment: '',
    });
  });

  it('converts a 1-based word number to a 0-based word index', () => {
    expect(parseAddress('MAT 2:1!3/kjv').start).toEqual({
      book: 'MAT',
      chapter: 2,
      verse: 1,
      segment: '',
      wordIndex: 2,
    });
  });

  it('parses a word span inside one verse', () => {
    const a = parseAddress('MAT 2:1!3-5/kjv');
    expect(a.start.wordIndex).toBe(2);
    expect(a.end).toEqual({ book: 'MAT', chapter: 2, verse: 1, segment: '', wordIndex: 4 });
  });

  it.each([
    ['PSA 51:3', 'no scheme'],
    ['PSA 51:3/', 'empty scheme'],
    ['PSA 51:3/ORG', 'uppercase scheme'],
    ['Psa 51:3/org', 'lowercase book code'],
    ['PSALMS 51:3/org', 'not a USFM code'],
    ['PSA 51/org', 'no verse'],
    ['PSA 0:1/org', 'chapter 0'],
    ['MAT 2:1!0/kjv', 'word number 0'],
    ['REV 13:1ab/kjv', 'two-letter segment'],
    ['GEN 2:1-1:3/kjv', 'descending range'],
    ['GEN 1:5-3/kjv', 'descending verse range'],
    ['GEN 1:1-EXO 1:1/kjv', 'cross-book range'],
    ['GEN 1:1/kjv/org', 'two schemes'],
    ['GEN 1:1-2/kjv extra', 'trailing text'],
  ])('rejects %s (%s)', (s) => {
    expect(() => parseAddress(s)).toThrow();
  });
});

describe('formatAddress', () => {
  it('writes a 0-based word index as a 1-based word number', () => {
    const a: Address = {
      scheme: 'kjv',
      start: { book: 'MAT', chapter: 2, verse: 1, segment: '', wordIndex: 2 },
    };
    expect(formatAddress(a)).toBe('MAT 2:1!3/kjv');
  });

  it('writes the shortest range end', () => {
    expect(
      formatAddress({
        scheme: 'kjv',
        start: { book: 'GEN', chapter: 1, verse: 1, segment: '' },
        end: { book: 'GEN', chapter: 1, verse: 31, segment: '' },
      }),
    ).toBe('GEN 1:1-31/kjv');
  });
});

describe('round trip', () => {
  it.each([
    'PSA 51:3/org',
    'PSA 51:0/eng',
    'REV 13:1a/kjv',
    'GEN 1:1-31/kjv',
    'GEN 1:1-2:3/kjv',
    'REV 12:17-13:1a/kjv',
    'MAT 2:1!3/kjv',
    'MAT 2:1!3-5/kjv',
    'MAT 2:1!3-2!1/kjv',
    'MAT 2:23!3-3:1!1/kjv',
    '1MA 1:1/vul',
  ])('%s', (s) => {
    expect(formatAddress(parseAddress(s))).toBe(s);
  });
});

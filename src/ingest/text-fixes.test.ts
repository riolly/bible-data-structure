import { describe, expect, it } from 'vitest';

import { applyTextFixes } from './text-fixes';

describe('applyTextFixes', () => {
  const files = [
    { code: 'PHM', usfm: '\\v 25 ὑμῶν. ‘p /’ ‘/book’\n' },
    { code: 'REV', usfm: '\\v 21 ἁγίων.\n' },
  ];
  const fix = { find: ' ‘p /’ ‘/book’', replace: '', count: 1, why: 'test' };

  it('replaces every occurrence and leaves other files alone', () => {
    const out = applyTextFixes(files, [fix]);
    expect(out.map((f) => f.usfm)).toEqual(['\\v 25 ὑμῶν.\n', '\\v 21 ἁγίων.\n']);
    expect(out[1]).toBe(files[1]);
  });

  it('stops when the count differs', () => {
    expect(() => applyTextFixes(files, [{ ...fix, count: 2 }])).toThrow(/occurs 1 times, expected 2/);
    expect(() => applyTextFixes(files, [{ ...fix, find: 'absent' }])).toThrow(/occurs 0 times/);
  });
});

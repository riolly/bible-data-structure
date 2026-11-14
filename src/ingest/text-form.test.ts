import { describe, expect, it } from 'vitest';

import { storedText } from './text-form';

// JOS 10:1 word 6 in the pinned OSHB (id 06YgF): the lamed carries a patah, then a hiriq.
const JERUSALEM = 'יְרוּשָׁלִַ֗ם';

describe('storedText (ADR-0004 v1.6)', () => {
  it('keeps Hebrew-script text as the source wrote it', () => {
    expect(JERUSALEM.normalize('NFC')).not.toBe(JERUSALEM); // NFC would put the hiriq first
    expect(storedText(JERUSALEM)).toBe(JERUSALEM);
    expect(storedText('שׁ')).toBe('שׁ'); // a presentation form, which NFC decomposes
  });

  it('applies NFC to every other script', () => {
    const decomposed = 'ἐν ἀρχῇ ἦν'.normalize('NFD');
    expect(storedText(decomposed)).toBe('ἐν ἀρχῇ ἦν'.normalize('NFC'));
    expect(storedText('café')).toBe('café');
  });

  it('in mixed text, applies NFC around the Hebrew and keeps the Hebrew', () => {
    expect(storedText(`café ${JERUSALEM} café`)).toBe(`café ${JERUSALEM} café`);
  });
});

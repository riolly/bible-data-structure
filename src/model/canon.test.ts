import { describe, expect, it } from 'vitest';

import { BOOKS, BOOK_BY_CODE, ENGLISH_NAMES } from './books';
import { CANONS, canonBookCodes } from './canon';

describe('books (USFM spec)', () => {
  it('keys every book by its USFM code and skips peripherals', () => {
    for (const b of BOOKS) expect(b.code).toMatch(/^[0-9A-Z]{3}$/);
    for (const code of ['FRT', 'BAK', 'GLO', 'XXA']) expect(BOOK_BY_CODE.has(code)).toBe(false);
    expect(BOOK_BY_CODE.get('ESG')?.usfmNumber).toBe('70');
    expect(BOOK_BY_CODE.get('DAG')?.usfmNumber).toBe('B2');
    expect(new Set(BOOKS.map((b) => b.code)).size).toBe(BOOKS.length);
  });

  it('has a default English name for every book', () => {
    const named = new Set(ENGLISH_NAMES.map((n) => n.bookCode));
    for (const b of BOOKS) expect(named.has(b.code), b.code).toBe(true);
    expect(ENGLISH_NAMES.find((n) => n.bookCode === 'SNG')?.long).toBe('Song of Songs');
  });
});

describe('protestant canon', () => {
  const canon = CANONS.find((c) => c.id === 'protestant')!;

  it('has 66 entries, 39 in the Old Testament and 27 in the New', () => {
    expect(canon.entries).toHaveLength(66);
    expect(canon.entries.filter((e) => e.section === 'ot')).toHaveLength(39);
    expect(canon.entries.filter((e) => e.section === 'nt')).toHaveLength(27);
    expect(canon.entries.every((e) => e.status === 'canonical')).toBe(true);
  });

  it('orders the books GEN to MAL, then MAT to REV', () => {
    const codes = canonBookCodes(canon);
    expect(codes[0]).toBe('GEN');
    expect(codes[38]).toBe('MAL');
    expect(codes[39]).toBe('MAT');
    expect(codes[65]).toBe('REV');
  });

  it('points only at books that exist', () => {
    for (const code of canonBookCodes(canon)) expect(BOOK_BY_CODE.has(code), code).toBe(true);
  });

  it('places every entry in a declared section', () => {
    const sections = new Set(canon.sections.map((s) => s.id));
    for (const e of canon.entries) expect(sections.has(e.section)).toBe(true);
  });
});

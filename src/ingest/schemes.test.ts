import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BOOK_BY_CODE } from '../model/books';
import { PROTESTANT, canonBookCodes } from '../model/canon';
import { checkVerses, hasVerse, lastVerse } from '../model/scheme';
import { nativeModuleLoads } from './native-probe';
import { KJV_TITLES, SCHEME_IDS, loadSchemes } from './schemes';
import { SOURCES as SOURCE_DEFS } from './sources';

const schemes = loadSchemes();

describe('scheme registry', () => {
  it('holds kjv and the six Paratext schemes', () => {
    expect([...schemes.keys()].sort()).toEqual(['eng', 'kjv', 'lxx', 'org', 'rsc', 'rso', 'vul']);
    expect([...SCHEME_IDS].sort()).toEqual([...schemes.keys()].sort());
  });

  it('uses only USFM book codes', () => {
    for (const s of schemes.values()) {
      for (const code of s.verseCounts.keys()) expect(BOOK_BY_CODE.has(code), `${s.id} ${code}`).toBe(true);
    }
  });

  it('keeps Paratext eng apart from kjv at Revelation 12 and 3 John', () => {
    const eng = schemes.get('eng')!;
    const kjv = schemes.get('kjv')!;
    expect(lastVerse(eng, 'REV', 12)).toBe(18);
    expect(lastVerse(kjv, 'REV', 12)).toBe(17);
    expect(lastVerse(eng, '3JN', 1)).toBe(15);
    expect(lastVerse(kjv, '3JN', 1)).toBe(14);
    expect(hasVerse(kjv, 'REV', 12, 18)).toBe(false);
  });

  it('gives kjv exactly the 66 protestant books', () => {
    expect([...schemes.get('kjv')!.verseCounts.keys()].sort()).toEqual(
      canonBookCodes(PROTESTANT).sort(),
    );
  });

  it('counts the Hebrew Psalm title as verse 1 in org', () => {
    expect(lastVerse(schemes.get('org')!, 'PSA', 3)).toBe(9);
    expect(lastVerse(schemes.get('eng')!, 'PSA', 3)).toBe(8);
  });

  it('honours verses a scheme leaves out', () => {
    const lxx = schemes.get('lxx')!;
    expect(lastVerse(lxx, 'GEN', 31)).toBeGreaterThan(51);
    expect(hasVerse(lxx, 'GEN', 31, 51)).toBe(false);
    expect(hasVerse(lxx, 'GEN', 31, 50)).toBe(true);
  });

  it('rejects unknown chapters and books', () => {
    const kjv = schemes.get('kjv')!;
    expect(lastVerse(kjv, 'GEN', 51)).toBeUndefined();
    expect(hasVerse(kjv, 'TOB', 1, 1)).toBe(false);
  });
});

describe('checkVerses', () => {
  const kjv = schemes.get('kjv')!;

  it('reports a verse the scheme does not have', () => {
    const r = checkVerses(kjv, 'REV', [{ chapter: 12, verse: 18 }]);
    expect(r.unknown).toEqual([{ chapter: 12, verse: 18 }]);
  });

  it('reports chapters that end early or are missing', () => {
    const r = checkVerses(kjv, 'JOL', [
      { chapter: 1, verse: 20 },
      { chapter: 2, verse: 31 },
    ]);
    expect(r.unknown).toEqual([]);
    expect(r.short).toEqual([
      { chapter: 2, last: 31, expected: 32 },
      { chapter: 3, last: 0, expected: 21 },
    ]);
  });
});

/** Every `\v` marker per chapter; a bridge `\v 17-18` counts as its last verse. */
function usfmVerses(usfm: string): { chapter: number; verse: number }[] {
  const out: { chapter: number; verse: number }[] = [];
  let chapter = 0;
  for (const m of usfm.matchAll(/\\c (\d+)|\\v (\d+)(?:-(\d+))?/g)) {
    if (m[1]) chapter = Number(m[1]);
    else out.push({ chapter, verse: Number(m[3] ?? m[2]) });
  }
  return out;
}

const SOURCES = join(import.meta.dirname, 'sources');

describe.each(['kjv', 'bsb'])('%s source text under the kjv scheme', (dir) => {
  it.skipIf(!existsSync(join(SOURCES, dir)))('has every verse of every protestant book, and no other', () => {
    const kjv = schemes.get('kjv')!;
    const books = new Set(canonBookCodes(PROTESTANT));
    let checked = 0;
    for (const name of readdirSync(join(SOURCES, dir))) {
      if (!name.endsWith('.usfm')) continue;
      const usfm = readFileSync(join(SOURCES, dir, name), 'utf8');
      const code = usfm.match(/^\\id (\w{3})/)?.[1];
      if (!code || !books.has(code)) continue;
      expect(checkVerses(kjv, code, usfmVerses(usfm)), code).toEqual({ unknown: [], short: [] });
      if (code === 'PSA') {
        const titled = new Set<number>();
        let chapter = 0;
        for (const line of usfm.split('\n')) {
          const c = /^\\c (\d+)/.exec(line);
          if (c) chapter = Number(c[1]);
          else if (line.startsWith('\\d')) titled.add(chapter);
        }
        expect([...titled].sort((a, b) => a - b)).toEqual(KJV_TITLES);
      }
      checked++;
    }
    expect(checked).toBe(66);
  });
});

describe.each(SOURCE_DEFS.map((s) => [s.meta.abbrev, s] as const))('%s source text', (_, src) => {
  it.skipIf(!existsSync(join(SOURCES, src.dir)))('has its listed books, and no verse its scheme lacks', () => {
    const scheme = schemes.get(src.meta.scheme)!;
    const wanted = new Set(src.books);
    const seen: string[] = [];
    for (const name of readdirSync(join(SOURCES, src.dir))) {
      if (!name.endsWith('.usfm')) continue;
      const usfm = readFileSync(join(SOURCES, src.dir, name), 'utf8');
      const code = usfm.match(/^\\id (\w{3})/)?.[1];
      if (!code || !wanted.has(code)) continue;
      expect(checkVerses(scheme, code, usfmVerses(usfm)).unknown, code).toEqual([]);
      seen.push(code);
    }
    expect(seen.sort()).toEqual([...src.books].sort());
  });
});

const native = nativeModuleLoads(
  "import('better-sqlite3').then(({ default: Database }) => { new Database(':memory:').close(); process.exit(0); }, () => process.exit(1));",
);

describe.skipIf(!native)('scheme tables', () => {
  it('stores every scheme with its verse counts, and editions must name one', async () => {
    const { createCorpusDb, insertTranslation, seedBooksAndCanons, seedSchemes } = await import('./write-db');
    const { db, sqlite } = createCorpusDb(':memory:');
    seedBooksAndCanons(db);
    seedSchemes(db, schemes);

    const ids = (sqlite.prepare('SELECT id FROM scheme ORDER BY id').all() as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(['eng', 'kjv', 'lxx', 'org', 'rsc', 'rso', 'vul']);
    const rev12 = sqlite
      .prepare("SELECT scheme, verse_count FROM scheme_verse_count WHERE book = 'REV' AND chapter = 12 ORDER BY scheme")
      .all();
    expect(rev12).toContainEqual({ scheme: 'kjv', verse_count: 17 });
    expect(rev12).toContainEqual({ scheme: 'eng', verse_count: 18 });
    expect(sqlite.prepare("SELECT count(*) AS n FROM scheme_excluded_verse WHERE scheme = 'lxx'").get()).toEqual({
      n: schemes.get('lxx')!.excluded.size,
    });

    const meta = { name: 'X', abbrev: 'X', language: 'en', year: null, license: null, edition: 'sha256:0' };
    expect(() => insertTranslation(db, { ...meta, scheme: 'kjv' })).not.toThrow();
    expect(() => insertTranslation(db, { ...meta, abbrev: 'Y', scheme: 'av11n' })).toThrow(/FOREIGN KEY/);
    sqlite.close();
  });
});

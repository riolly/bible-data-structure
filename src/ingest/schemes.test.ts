import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BOOK_BY_CODE } from '../model/books';
import { PROTESTANT, canonBookCodes } from '../model/canon';
import { checkVerses, hasVerse, lastVerse } from '../model/scheme';
import { sqliteLoads } from './native-probe';
import { DERIVED_SCHEMES, KJV_TITLES, deriveScheme, loadSchemes } from './schemes';
import { SOURCES as SOURCE_DEFS } from './sources';
import { readSource } from './source-files';
import { loadEditionFacts } from '../provider/edition-facts';

const schemes = loadSchemes();

describe('scheme registry', () => {
  it('holds kjv, the six Paratext schemes and the derived schemes', () => {
    expect([...schemes.keys()].sort()).toEqual(['brenton', 'bsb', 'eng', 'kjv', 'lxx', 'nasb95', 'niv', 'nlt', 'org', 'rp', 'rsc', 'rso', 'vul', 'web']);
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

describe('the scheme of each ingested edition (ADR-0006 amendment)', () => {
  // An ingested edition keeps its scheme: its addresses name it. When a new
  // edition conflicts with a scheme's rows, the newcomer gets a derived scheme.
  // Changing an entry here moves every address of that edition.
  it('stays as first ingested', () => {
    expect(Object.fromEntries(SOURCE_DEFS.map((s) => [s.meta.abbrev, s.meta.scheme]))).toEqual({
      KJV: 'kjv',
      BSB: 'bsb',
      WLC: 'org',
      SBLGNT: 'org',
      RP: 'rp',
      WEB: 'web',
      Brenton: 'brenton',
    });
  });
});

describe.each(loadEditionFacts().map((e) => [e.facts.edition, e] as const))('%s facts (plan step 10)', (_, { scheme: id, facts }) => {
  const scheme = schemes.get(id)!;

  it('keeps its scheme', () => {
    expect({ NASB95: 'nasb95', NLT: 'nlt', NIV: 'niv' }[facts.edition]).toBe(id);
  });

  it("prints every chapter of its scheme's 66 books to the scheme's last verse", () => {
    expect(Object.keys(facts.lastVerses)).toEqual(canonBookCodes(PROTESTANT));
    for (const [book, lasts] of Object.entries(facts.lastVerses)) expect(lasts, book).toEqual(scheme.verseCounts.get(book));
  });

  it("titles the Psalms its scheme numbers a title for, and holds no verse the scheme lacks", () => {
    expect([...facts.titled].sort()).toEqual([...scheme.titles].sort());
    const ref = (r: string) => /^(\S+) (\d+):(\d+)(?:-(\d+))?/.exec(r)!;
    for (const r of [...facts.bridges, ...facts.missing]) {
      const m = ref(r);
      expect(hasVerse(scheme, m[1], Number(m[2]), Number(m[4] ?? m[3])), r).toBe(true);
    }
    expect(facts.parts).toEqual([]);
  });
});

describe('derived schemes (ADR-0002 amendment)', () => {
  it('moves the Romans doxology to 14:24-26 in rp, and web inherits it', () => {
    for (const id of ['rp', 'web']) {
      const s = schemes.get(id)!;
      expect(lastVerse(s, 'ROM', 14)).toBe(26);
      expect(hasVerse(s, 'ROM', 16, 25)).toBe(false);
      expect(lastVerse(s, 'REV', 12)).toBe(17);
    }
    expect(schemes.get('rp')!.verseCounts.has('TOB')).toBe(false);
  });

  it("gives web eng's deuterocanon with its own chapter lengths", () => {
    const web = schemes.get('web')!;
    const eng = schemes.get('eng')!;
    expect(lastVerse(web, 'TOB', 5)).toBe(22);
    expect(lastVerse(eng, 'TOB', 5)).toBe(21);
    expect(web.verseCounts.get('1MA')).toEqual(eng.verseCounts.get('1MA'));
    expect(web.titles.has('PSA 3')).toBe(true);
  });

  it("leaves Brenton's Proverbs 30 with no verses", () => {
    const brenton = schemes.get('brenton')!;
    expect(lastVerse(brenton, 'PRO', 24)).toBe(62);
    expect(lastVerse(brenton, 'PRO', 30)).toBe(0);
    expect(hasVerse(brenton, 'PRO', 30, 1)).toBe(false);
    // lxx's excluded verses carry over, except those past a chapter's new end
    const lxx = schemes.get('lxx')!;
    const dropped = [...lxx.excluded].filter((k) => !brenton.excluded.has(k));
    expect([...brenton.excluded].every((k) => lxx.excluded.has(k))).toBe(true);
    for (const k of dropped) {
      const [, book, c, v] = /^(\S+) (\d+):(\d+)$/.exec(k)!;
      expect(Number(v), k).toBeGreaterThan(lastVerse(brenton, book, Number(c))!);
    }
  });

  it('rejects a change that changes nothing, and an unknown base', () => {
    const def = { ...DERIVED_SCHEMES[0], lastVerses: [['ROM', 14, 23] as const] };
    expect(() => deriveScheme(def, schemes)).toThrow(/already ends at 23/);
    expect(() => deriveScheme({ ...def, base: 'nope' }, schemes)).toThrow(/not defined before it/);
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

/**
 * The verses that carry text, as the ingest's scheme check sees them: a `\v`
 * holding only a footnote (WEB ROM 16:25) makes no token, so it is no verse.
 */
function versesWithText(usfm: string): { chapter: number; verse: number }[] {
  const out: { chapter: number; verse: number }[] = [];
  const parts = usfm.replace(/\\f .*?\\f\*/gs, '').split(/(\\c \d+|\\v \d+(?:-\d+)?)/);
  let chapter = 0;
  for (let i = 1; i < parts.length; i += 2) {
    const [marker, num] = parts[i].split(' ');
    if (marker === '\\c') chapter = Number(num);
    else if (/\p{L}/u.test(parts[i + 1].replace(/\\[a-z0-9+]+\*?/g, ''))) {
      out.push({ chapter, verse: Number(num.split('-').pop()) });
    }
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
    // the books as the ingest reads them: converted, with the counted text fixes applied
    const { files } = readSource(src);
    expect(files.map((f) => f.code)).toEqual([...src.books]);
    for (const { code, usfm } of files) {
      expect(usfm, code).not.toMatch(/‘\/?(book|p)\b/);
      // a footnote or cross-reference standing between two letters runs two words together (WEB 2ES 7:36)
      expect(usfm, code).not.toMatch(/[\p{L}\p{M}](?:\\w\*)?\\[fx] [^\\]*(?:\\(?![fx]\*)[^\\]*)*\\[fx]\*(?:\\w )?\p{L}/u);
      expect(checkVerses(scheme, code, versesWithText(usfm)).unknown, code).toEqual([]);
    }
  }, 60_000); // converting the 39 OSHB books takes seconds
});

const native = sqliteLoads();

describe.skipIf(!native)('scheme tables', () => {
  it('stores every scheme with its verse counts, and editions must name one', async () => {
    const { createCorpusDb, insertTranslation, seedBooksAndCanons, seedSchemes } = await import('./write-db');
    const { db, sqlite } = createCorpusDb(':memory:');
    seedBooksAndCanons(db);
    seedSchemes(db, schemes);

    const ids = (sqlite.prepare('SELECT id FROM scheme ORDER BY id').all() as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(['brenton', 'bsb', 'eng', 'kjv', 'lxx', 'nasb95', 'niv', 'nlt', 'org', 'rp', 'rsc', 'rso', 'vul', 'web']);
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

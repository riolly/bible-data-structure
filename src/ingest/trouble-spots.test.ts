import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import type { Mappings, Ref } from '../model/mapping';
import { PIVOT } from '../model/mapping';
import { checkVerses } from '../model/scheme';
import { nativeModuleLoads } from './native-probe';
import { loadSchemes } from './schemes';
import { TVTMS_PATH, compileMappings, readTvtms } from './tvtms';

/**
 * The trouble spots of research/README.md, imported from excerpts of the
 * pinned sources (fixtures/trouble-spots/README.md) through the ingest's own
 * steps: parse, normalize, the scheme check, the DB write, readChapter, and
 * mappings compiled from TVTMS. No step knows about any trouble spot.
 */

const FIXTURES = join(import.meta.dirname, 'fixtures', 'trouble-spots');

/** Fixture editions: directory, abbreviation, declared scheme, language. */
const EDITIONS = [
  { dir: 'kjv', abbrev: 'KJV', scheme: 'kjv', language: 'english' },
  { dir: 'kjva', abbrev: 'KJVA', scheme: 'eng', language: 'english' },
  { dir: 'wlc', abbrev: 'WLC', scheme: 'org', language: 'hebrew' },
  { dir: 'sblgnt', abbrev: 'SBLGNT', scheme: 'org', language: 'greek' },
  { dir: 'rp', abbrev: 'RP', scheme: 'rp', language: 'greek' },
  { dir: 'web', abbrev: 'WEB', scheme: 'web', language: 'english' },
] as const;

const native = nativeModuleLoads(
  "Promise.all([import('usfm-grammar'), import('better-sqlite3').then(({ default: D }) => new D(':memory:').close())]).then(() => process.exit(0), () => process.exit(1));",
);
const hasTvtms = existsSync(TVTMS_PATH);

const ref = (book: string, chapter: number, verse: number, segment = ''): Ref => ({ book, chapter, verse, segment });
const fmt = (r: Ref) => `${r.book} ${r.chapter}:${r.verse}${r.segment}`;

describe.skipIf(!native || !hasTvtms)('trouble spots (research/README.md)', () => {
  let mappings: Mappings;
  let words: (abbrev: string, book: string, chapter: number, verse: number) => string[];
  let tokens: (abbrev: string, book: string, chapter: number, verse: number) => string[];

  beforeAll(async () => {
    const { usfmToUsj } = await import('./parse');
    const { normalizeUsj } = await import('./normalize');
    const w = await import('./write-db');
    const { readChapter, loadMappings } = await import('../db/corpus-read');

    const schemes = loadSchemes();
    const { pivot, rows } = compileMappings(schemes, readTvtms());
    const { db } = w.createCorpusDb(':memory:');
    w.seedBooksAndCanons(db);
    w.seedSchemes(db, new Map(schemes).set(PIVOT, pivot));
    w.insertMappings(db, rows);

    for (const e of EDITIONS) {
      const translationId = w.insertTranslation(db, {
        name: e.abbrev,
        abbrev: e.abbrev,
        language: e.language,
        year: null,
        license: null,
        scheme: e.scheme,
        edition: 'sha256:fixture',
      });
      for (const name of readdirSync(join(FIXTURES, e.dir))) {
        const usfm = readFileSync(join(FIXTURES, e.dir, name), 'utf8');
        const { usj, parseErrors } = usfmToUsj(usfm);
        expect(parseErrors, `${e.dir}/${name}`).toEqual([]);
        const { blocks, tokens } = normalizeUsj(usj);
        const book = name.slice(0, 3);
        const verses = tokens.flatMap((t) => (t.verse == null ? [] : [{ chapter: t.chapter, verse: t.verse }]));
        expect(checkVerses(schemes.get(e.scheme)!, book, verses).unknown, `${e.dir}/${name}`).toEqual([]);
        w.insertBookRows(db, { translationId, book }, { blocks, tokens });
      }
    }

    mappings = loadMappings(db);
    const verseTokens = (abbrev: string, book: string, chapter: number, verse: number) =>
      readChapter(db, abbrev, book, chapter).tokens.filter((t) => t.verse === verse);
    words = (...a) => verseTokens(...a).filter((t) => t.kind === 'word').map((t) => t.text);
    tokens = (...a) => verseTokens(...a).map((t) => t.text);
  }, 60_000);

  const map = (from: string, to: string, r: Ref) => mappings.map(from, to, r).map(fmt);

  it('Psalm titles: KJV prints the title unnumbered, WLC numbers it as verses 1-2', () => {
    expect(words('KJV', 'PSA', 51, 1).slice(0, 3)).toEqual(['Have', 'mercy', 'upon']);
    expect(words('WLC', 'PSA', 51, 1)).toEqual(['לַמְנַצֵּ֗חַ', 'מִזְמ֥וֹר', 'לְדָוִֽד']);
    expect(map('kjv', 'org', ref('PSA', 51, 1))).toEqual(['PSA 51:3']);
    expect(map('org', 'kjv', ref('PSA', 51, 3))).toEqual(['PSA 51:1']);
    expect(map('org', 'kjv', ref('PSA', 51, 1))).toEqual(['PSA 51:0']);
    expect(map('org', 'kjv', ref('PSA', 51, 2))).toEqual(['PSA 51:0']);
  });

  it('Joel 2/3 and Malachi 3/4: the chapter boundary moves', () => {
    expect(map('kjv', 'org', ref('JOL', 2, 28))).toEqual(['JOL 3:1']);
    expect(map('kjv', 'org', ref('JOL', 3, 1))).toEqual(['JOL 4:1']);
    expect(map('kjv', 'org', ref('MAL', 4, 1))).toEqual(['MAL 3:19']);
    expect(map('org', 'kjv', ref('MAL', 3, 24))).toEqual(['MAL 4:6']);
    for (const [kjv, wlc] of [
      [ref('JOL', 2, 28), ref('JOL', 3, 1)],
      [ref('MAL', 4, 6), ref('MAL', 3, 24)],
    ]) {
      expect(words('KJV', kjv.book, kjv.chapter, kjv.verse).length).toBeGreaterThan(0);
      expect(words('WLC', wlc.book, wlc.chapter, wlc.verse).length).toBeGreaterThan(0);
    }
  });

  it('Revelation 12:18 and 3 John 15: one verse in org is half a verse in kjv', () => {
    expect(words('SBLGNT', 'REV', 12, 18).length).toBeGreaterThan(0);
    expect(words('KJV', 'REV', 12, 18)).toEqual([]);
    expect(map('org', 'kjv', ref('REV', 12, 18))).toEqual(['REV 13:1a']);
    expect(map('kjv', 'org', ref('REV', 13, 1, 'a'))).toEqual(['REV 12:18']);
    expect(words('SBLGNT', '3JN', 1, 15).length).toBeGreaterThan(0);
    expect(map('org', 'kjv', ref('3JN', 1, 15))).toEqual(['3JN 1:14b']);
  });

  it('Romans 16:25-27: at 16:25-27 in KJV, at 14:24-26 in RP and WEB, absent from SBLGNT', () => {
    expect(words('KJV', 'ROM', 16, 25).slice(0, 3)).toEqual(['Now', 'to', 'him']);
    expect(words('RP', 'ROM', 14, 24).slice(0, 3)).toEqual(['τω', 'δε', 'δυναμενω']); // ebible's RP is unaccented
    expect(words('WEB', 'ROM', 14, 24).slice(0, 3)).toEqual(['Now', 'to', 'him']);
    expect(words('RP', 'ROM', 16, 25)).toEqual([]);
    expect(words('SBLGNT', 'ROM', 16, 25)).toEqual([]);
    expect(words('SBLGNT', 'ROM', 14, 24)).toEqual([]);
    expect(map('rp', 'kjv', ref('ROM', 14, 24))).toEqual(['ROM 16:25']);
    expect(map('kjv', 'rp', ref('ROM', 16, 27))).toEqual(['ROM 14:26']);
    expect(map('web', 'rp', ref('ROM', 14, 25))).toEqual(['ROM 14:25']);
  });

  it('Mark 16:9-20 and John 7:53-8:11: present in KJV, double-bracketed in SBLGNT', () => {
    expect(words('KJV', 'MRK', 16, 9).length).toBeGreaterThan(0);
    expect(words('SBLGNT', 'MRK', 16, 9).length).toBeGreaterThan(0);
    expect(tokens('SBLGNT', 'MRK', 16, 8)).toContain('⟦');
    expect(tokens('SBLGNT', 'JHN', 7, 53)[0]).toBe('⟦');
    expect(tokens('SBLGNT', 'JHN', 8, 11).at(-1)).toBe('.⟧');
    expect(words('KJV', 'JHN', 7, 53)).toEqual(['And', 'every', 'man', 'went', 'unto', 'his', 'own', 'house']);
  });

  it('Acts 8:37: present in KJV, absent from SBLGNT, and the address still exists under org', () => {
    expect(words('KJV', 'ACT', 8, 37).slice(0, 3)).toEqual(['And', 'Philip', 'said']);
    expect(words('SBLGNT', 'ACT', 8, 37)).toEqual([]);
    expect(map('kjv', 'org', ref('ACT', 8, 37))).toEqual(['ACT 8:37']);
  });

  it('a deuterocanonical chapter imports under a second scheme: Tobit 1 under eng and web', () => {
    expect(words('KJVA', 'TOB', 1, 1).slice(0, 3)).toEqual(['The', 'book', 'of']);
    expect(words('WEB', 'TOB', 1, 1).length).toBeGreaterThan(0);
    expect(map('eng', 'web', ref('TOB', 1, 1))).toEqual(['TOB 1:1']);
    expect(map('web', 'eng', ref('TOB', 1, 22))).toEqual(['TOB 1:22']);
  });
});

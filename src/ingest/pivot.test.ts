import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Mappings, PIVOT, checkCoverage, refKey, type Ref } from '../model/mapping';
import { nativeModuleLoads } from './native-probe';
import {
  allVrsPivotRows,
  buildPivot,
  checkExtendOnly,
  pivotSnapshot,
  type PivotSnapshot,
} from './pivot';
import { PARATEXT_SCHEMES, loadSchemes, readParatextVrs } from './schemes';
import { parseVrs } from './vrs';

const ref = (book: string, chapter: number, verse: number, segment = ''): Ref => ({ book, chapter, verse, segment });
const keys = (refs: Ref[]) => refs.map(refKey);

const schemes = loadSchemes();
const pivot = buildPivot(schemes);
const withPivot = new Map(schemes).set(PIVOT, pivot);
const rows = allVrsPivotRows(schemes);
const m = new Mappings(rows, withPivot);

/** The ADR-0006 real cases, through the pivot, from the libpalaso data. */
describe('real cases through the pivot', () => {
  it('3 John 14-15: eng splits the verse KJV keeps whole', () => {
    expect(keys(m.map('eng', 'kjv', ref('3JN', 1, 15)))).toEqual(['3JN 1:14b']);
    expect(keys(m.map('kjv', 'eng', ref('3JN', 1, 14)))).toEqual(['3JN 1:14', '3JN 1:15']);
  });

  it('Revelation 12:18 is part of KJV 13:1, not a one-verse shift', () => {
    expect(keys(m.map('eng', 'kjv', ref('REV', 12, 18)))).toEqual(['REV 13:1a']);
    expect(keys(m.map('kjv', 'eng', ref('REV', 13, 1, 'a')))).toEqual(['REV 12:18']);
    expect(keys(m.map('kjv', 'eng', ref('REV', 13, 2)))).toEqual(['REV 13:2']);
  });

  it('Psalm 51: two Hebrew verses are one title (many-to-one)', () => {
    expect(keys(m.map('org', 'kjv', ref('PSA', 51, 1)))).toEqual(['PSA 51:0']);
    expect(keys(m.map('org', 'kjv', ref('PSA', 51, 2)))).toEqual(['PSA 51:0']);
    expect(keys(m.map('kjv', 'org', ref('PSA', 51, 0)))).toEqual(['PSA 51:1', 'PSA 51:2']);
    expect(keys(m.map('kjv', 'org', ref('PSA', 51, 1)))).toEqual(['PSA 51:3']);
  });

  it('Romans 14:24-26 in rso is KJV 16:25-27 (cross-chapter)', () => {
    expect(keys(m.map('rso', 'kjv', ref('ROM', 14, 24)))).toEqual(['ROM 16:25']);
    expect(keys(m.map('kjv', 'rso', ref('ROM', 16, 27)))).toEqual(['ROM 14:26']);
    expect(keys(m.map('kjv', 'rso', ref('ROM', 14, 23)))).toEqual(['ROM 14:23']);
  });

  it('Daniel 3:24-90 in vul is the Song of the Three (cross-book)', () => {
    expect(keys(m.toPivot('vul', ref('DAN', 3, 24)))).toContain('S3Y 1:1');
    expect(keys(m.map('vul', 'kjv', ref('DAN', 3, 24)))).toEqual([]); // KJV has no S3Y
    expect(keys(m.map('vul', 'kjv', ref('DAN', 3, 91)))).toEqual(['DAN 3:24']);
  });

  it('Joel 3 in org is KJV 2:28-32', () => {
    expect(keys(m.map('kjv', 'org', ref('JOL', 2, 28)))).toEqual(['JOL 3:1']);
    expect(keys(m.map('org', 'kjv', ref('JOL', 4, 1)))).toEqual(['JOL 3:1']);
  });
});

/**
 * Upstream inconsistencies in libpalaso's eng.vrs and rso.vrs: mapping lines
 * name ESG verses or segments the files' own counts lack. Reported here, not
 * fixed (ADR-0006). A new problem fails the test.
 */
const KNOWN_COVERAGE_PROBLEMS: Record<string, number> = { org: 3, vul: 3, rso: 17 };

describe('coverage (replaces the bijection check)', () => {
  it.each([...schemes.keys()])('every %s verse maps into the pivot or is marked absent', (id) => {
    const problems = checkCoverage(schemes.get(id)!, pivot, rows);
    expect(problems.length, problems.slice(0, 5).join('\n')).toBe(KNOWN_COVERAGE_PROBLEMS[id] ?? 0);
    expect(problems.every((p) => p.startsWith('ESG '))).toBe(true);
  });
});

describe('the pivot only grows', () => {
  const committed = JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures', 'pivot.json'), 'utf8'),
  ) as PivotSnapshot;

  it('keeps every book, verse, segment and title of the previous build', () => {
    expect(checkExtendOnly(committed, pivotSnapshot(pivot))).toEqual([]);
  });

  it('flags a removed verse, a renamed segment and a dropped title', () => {
    const shrunk: PivotSnapshot = {
      books: { ...committed.books, REV: committed.books.REV.map((c, i) => (i === 12 ? c - 1 : c)) },
      segments: { ...committed.segments, 'REV 13:1': ['b', 'a'] },
      titles: committed.titles.filter((t) => t !== 'PSA 51'),
    };
    expect(checkExtendOnly(committed, shrunk)).toEqual([
      'REV 13 shrank from 18 to 17 verses',
      'segments of REV 13:1 changed from a,b to b,a',
      'title PSA 51 removed',
    ]);
  });

  it('is never a scheme stored addresses use', () => {
    expect(schemes.has(PIVOT)).toBe(false);
  });
});

describe('.vrs lines Paratext reads lossily', () => {
  it('are reported, not fixed', () => {
    const warnings = PARATEXT_SCHEMES.flatMap((s) => parseVrs(readParatextVrs(s.id)).warnings.map((w) => `${s.id} ${w}`));
    expect(warnings.map((w) => w.slice(0, w.indexOf('"', w.indexOf('"') + 1) + 1))).toEqual([
      'vul line 812: "DAG 3:52-23 = S3Y 1:30-31"',
      'rso line 286: "PSA 89:2-6 = PSA 90:1-6"',
      'rso line 316: "PSA 115:0-10 = PSA 116:10-19"',
      'rsc line 295: "PSA 141:0 = PSA 142:0-1"',
    ]);
  });
});

const native = nativeModuleLoads(
  "import('better-sqlite3').then(({ default: Database }) => { new Database(':memory:').close(); process.exit(0); }, () => process.exit(1));",
);

describe.skipIf(!native)('mapping rows in the corpus DB', () => {
  it('read back into the same mappings', async () => {
    const { createCorpusDb, seedBooksAndCanons, seedSchemes, insertMappings, insertTranslation } = await import('./write-db');
    const { loadMappings } = await import('../db/corpus-read');
    const { db, sqlite } = createCorpusDb(':memory:');
    seedBooksAndCanons(db);
    seedSchemes(db, withPivot);
    insertMappings(db, rows, 'vrs');

    const count = sqlite.prepare('SELECT count(*) AS n FROM scheme_mapping').get() as { n: number };
    expect(count.n).toBe(rows.length);
    const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).not.toContain('versification_map');

    const read = loadMappings(db);
    for (const [a, b, r] of [
      ['eng', 'kjv', ref('3JN', 1, 15)],
      ['kjv', 'org', ref('PSA', 51, 0)],
      ['rso', 'kjv', ref('ROM', 14, 24)],
      ['vul', 'kjv', ref('DAN', 3, 91)],
      ['kjv', 'eng', ref('REV', 13, 1)],
    ] as const) {
      expect(keys(read.map(a, b, r)), `${refKey(r)} ${a}→${b}`).toEqual(keys(m.map(a, b, r)));
    }

    const meta = { name: 'X', abbrev: 'X', language: 'en', year: null, license: null, edition: 'sha256:0', scheme: PIVOT };
    expect(() => insertTranslation(db, meta)).toThrow(/pivot/);
    sqlite.close();
  });
});

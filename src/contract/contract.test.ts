import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { nativeModuleLoads } from '../ingest/native-probe';
import type { BibleContract, Lookup } from './contract';
import { parseReference } from './reference';

/**
 * The app contract (plan step 9) against the real KJV and BSB in
 * build/corpus.db, and against the `\v 5-6` bridge fixture, since KJV and BSB
 * have no bridges. The corpus tests skip until `bun run ingest` has run.
 */

const CORPUS = join(import.meta.dirname, '..', '..', 'build', 'corpus.db');
const native = nativeModuleLoads(
  "import('better-sqlite3').then(({ default: D }) => { new D(':memory:').close(); process.exit(0); }, () => process.exit(1));",
);

/** No storage id in a result: an `id` key may only hold an edition abbreviation. */
const ROW_IDS = ['id', 'blockId', 'translationId', 'rowid'];
const noRowIds = (x: unknown) => {
  const walk = (y: unknown): void => {
    if (Array.isArray(y)) y.forEach(walk);
    else if (y && typeof y === 'object') {
      for (const [k, v] of Object.entries(y)) {
        if (ROW_IDS.includes(k)) expect(typeof v, `key ${k}`).toBe('string');
        walk(v);
      }
    }
  };
  walk(x);
};
const addresses = (found: readonly Lookup[]) => found.map((l) => `${l.kind} ${l.address}`);

describe('parseReference (bible-passage-reference-parser, English)', () => {
  it('reads chapters, verse ranges, lists and ranges across books', () => {
    expect(parseReference('Ps 23')).toEqual([{ book: 'PSA', start: { chapter: 23, verse: null }, end: { chapter: 23, verse: null } }]);
    expect(parseReference('1 Cor 13:4-7')).toEqual([{ book: '1CO', start: { chapter: 13, verse: 4 }, end: { chapter: 13, verse: 7 } }]);
    expect(parseReference('Matt 17:20-22; Acts 8:37').map((r) => r.book)).toEqual(['MAT', 'ACT']);
    expect(parseReference('Gen 50-Lev 2')).toEqual([
      { book: 'GEN', start: { chapter: 50, verse: null }, end: { chapter: Infinity, verse: null } },
      { book: 'EXO', start: { chapter: 1, verse: null }, end: { chapter: Infinity, verse: null } },
      { book: 'LEV', start: { chapter: 1, verse: null }, end: { chapter: 2, verse: null } },
    ]);
    expect(parseReference('Jude 3')).toEqual([{ book: 'JUD', start: { chapter: 1, verse: 3 }, end: { chapter: 1, verse: 3 } }]);
    expect(parseReference('no reference here')).toEqual([]);
  });

  it('a book on its own is the whole book, at either end of a range', () => {
    const whole = { chapter: 1, verse: null };
    const rest = { chapter: Infinity, verse: null };
    expect(parseReference('Jude')).toEqual([{ book: 'JUD', start: whole, end: whole }]); // a book of one chapter
    expect(parseReference('Genesis')).toEqual([{ book: 'GEN', start: whole, end: rest }]);
    expect(parseReference('Gen 1:3-Exod')).toEqual([
      { book: 'GEN', start: { chapter: 1, verse: 3 }, end: rest },
      { book: 'EXO', start: whole, end: rest },
    ]);
    // "to chapter 3" ends at the chapter's last verse
    expect(parseReference('Gen 1:2 to chapter 3')).toEqual([{ book: 'GEN', start: { chapter: 1, verse: 2 }, end: { chapter: 3, verse: null } }]);
  });
});

describe.skipIf(!native || !existsSync(CORPUS))('the app contract on the corpus editions (build/corpus.db)', () => {
  let c: BibleContract;

  beforeAll(async () => {
    const { default: Database } = await import('better-sqlite3');
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const schema = await import('../db/corpus-schema');
    const { corpusContract } = await import('./corpus-contract');
    c = corpusContract(drizzle({ client: new Database(CORPUS, { readonly: true }), schema }));
  });

  it('JHN 3:16: the edition supplies the scheme, and the result carries its stamps', async () => {
    const kjv = await c.verseText('KJV', 'JHN 3:16');
    expect(kjv.asked).toBe('JHN 3:16/kjv');
    expect(kjv.edition).toMatchObject({ id: 'KJV', scheme: 'kjv', stamp: 'sha256:7ead3d28b2b34c9b', wordsStamp: 'sha256:13f8787f02884340' });
    expect(kjv.found).toMatchObject({ kind: 'verse', address: 'JHN 3:16/kjv', verse: 16, lastVerse: 16 });
    expect(kjv.found.kind === 'verse' && kjv.found.text).toContain('For God so loved the world, that he gave his only begotten Son');

    const bsb = await c.verseText('BSB', 'JHN 3:16');
    expect(bsb.edition).toMatchObject({ scheme: 'bsb', stamp: 'sha256:3b0004861fcf2481' });
    expect(bsb.found).toMatchObject({ kind: 'verse', address: 'JHN 3:16/bsb' });
    expect(bsb.found.kind === 'verse' && bsb.found.text).toMatch(/^For God so loved the world that He gave His one and only Son/);

    // a full address is allowed in the edition's own scheme only
    expect((await c.verseText('KJV', 'JHN 3:16/kjv')).found.address).toBe('JHN 3:16/kjv');
    await expect(c.verseText('KJV', 'JHN 3:16/org')).rejects.toThrow(/Use map/);
    await expect(c.verseText('KJV', 'JHN 3:16-17')).rejects.toThrow(/not one verse/);
    await expect(c.verseText('NIV', 'JHN 3:16')).rejects.toThrow(/unknown edition/);
    noRowIds(kjv);
  });

  it('human references resolve through the parser: "Ps 23" and "1 Cor 13:4-7"', async () => {
    const ps = await c.passage('BSB', 'Ps 23');
    expect(ps.parts.map((p) => p.address)).toEqual(['PSA 23:0-6/bsb']); // the title is verse 0 under bsb
    expect(addresses(ps.parts[0].found)).toEqual([0, 1, 2, 3, 4, 5, 6].map((v) => `verse PSA 23:${v}/bsb`));
    expect(ps.parts[0].found[1].kind === 'verse' && ps.parts[0].found[1].text).toMatch(/^The LORD is my shepherd/);

    const cor = await c.passage('KJV', '1 Cor 13:4-7');
    expect(cor.parts.map((p) => p.address)).toEqual(['1CO 13:4-7/kjv']);
    expect(cor.parts[0].found).toHaveLength(4);
    expect(cor.parts[0].found[0].kind === 'verse' && cor.parts[0].found[0].text).toMatch(/^Charity suffereth long/);

    expect((await c.passage('KJV', 'Ps 151')).parts.map((p) => addresses(p.found))).toEqual([['absent PSA 151:1/kjv']]);
    expect((await c.passage('KJV', 'hello')).parts).toEqual([]);
    noRowIds(ps);
  });

  it('a verse absent in an edition: BSB prints ACT 8:37 and MAT 17:21 only in footnotes', async () => {
    expect((await c.verseText('BSB', 'ACT 8:37')).found).toEqual({ kind: 'absent', address: 'ACT 8:37/bsb', reason: 'text' });
    expect((await c.verseText('KJV', 'ACT 8:37')).found.kind).toBe('verse');
    // the scheme lacks the verse: KJV ends Revelation 12 at 17
    expect((await c.verseText('KJV', 'REV 12:18')).found).toEqual({ kind: 'absent', address: 'REV 12:18/kjv', reason: 'scheme' });

    const gap = await c.passage('BSB', 'Matt 17:20-22');
    expect(addresses(gap.parts[0].found)).toEqual(['verse MAT 17:20/bsb', 'absent MAT 17:21/bsb', 'verse MAT 17:22/bsb']);

    const m = await c.map('KJV', 'ACT 8:37', 'BSB');
    expect(m).toMatchObject({ asked: 'ACT 8:37/kjv', kind: 'absent', verses: [] });
    expect(m.missing).toEqual([{ kind: 'absent', address: 'ACT 8:37/bsb', reason: 'text' }]);
  });

  it('verse parts: Brenton prints 1KI 2:35 whole with parts 35a to 35o, and SIR 6:2 only as 2a and 2b', async () => {
    const parts = 'abcdefghiklmno'.split(''); // Brenton skips j
    const kgs = await c.passage('Brenton', '1 Kgs 2:35');
    expect(addresses(kgs.parts[0].found)).toEqual(['verse 1KI 2:35/brenton', ...parts.map((s) => `verse 1KI 2:35${s}/brenton`)]);
    const ch = await c.chapter('Brenton', '1KI', 2);
    expect(ch.kind === 'chapter' && ch.verses.filter((v) => v.verse === 35).map((v) => v.address)).toEqual(kgs.parts[0].found.map((l) => l.address));

    const sir = await c.verseText('Brenton', 'SIR 6:2');
    expect(sir.found.kind).toBe('parts');
    expect(sir.found.kind === 'parts' && sir.found.parts.map((v) => v.address)).toEqual(['SIR 6:2a/brenton', 'SIR 6:2b/brenton']);
    expect((await c.verseText('Brenton', 'SIR 6:2b')).found).toMatchObject({ kind: 'verse', address: 'SIR 6:2b/brenton' });
    noRowIds(sir);
  });

  it('map gives one verse with another number: BSB PHP 1:16 is KJV PHP 1:17', async () => {
    const m = await c.map('BSB', 'PHP 1:16', 'KJV');
    expect(m.kind).toBe('one');
    expect(m.verses.map((v) => v.address)).toEqual(['PHP 1:17/kjv']);
    expect(m.verses[0].text).toMatch(/^But the other of love/);
    expect((await c.verseText('BSB', 'PHP 1:16')).found.kind === 'verse').toBe(true);
    expect((await c.map('KJV', 'JHN 3:16', 'BSB')).verses.map((v) => v.address)).toEqual(['JHN 3:16/bsb']);
    noRowIds(m);
  });

  it('map gives several verses: the KJV title of Psalm 51 is WLC 51:1-2', async () => {
    const m = await c.map('KJV', 'PSA 51:0', 'WLC');
    expect(m.kind).toBe('several');
    expect(m.verses.map((v) => v.address)).toEqual(['PSA 51:1/org', 'PSA 51:2/org']);
    // and back: each WLC verse is the one KJV title
    for (const v of ['PSA 51:1', 'PSA 51:2']) {
      const back = await c.map('WLC', v, 'KJV');
      expect([back.kind, back.verses.map((x) => x.address)]).toEqual(['one', ['PSA 51:0/kjv']]);
    }
    const bsb = await c.map('WLC', 'PSA 51:3', 'BSB');
    expect([bsb.kind, bsb.verses.map((x) => x.address)]).toEqual(['one', ['PSA 51:1/bsb']]);
  });

  it('map gives part of a verse: SBLGNT REV 12:18 is the first part of KJV REV 13:1', async () => {
    const m = await c.map('SBLGNT', 'REV 12:18', 'KJV');
    expect(m.kind).toBe('part');
    expect(m.verses).toHaveLength(1);
    expect(m.verses[0]).toMatchObject({ kind: 'verse', address: 'REV 13:1/kjv', part: 'a' });
    expect(m.verses[0].text).toMatch(/^And I stood upon the sand of the sea/);
    // asking for the part directly gives the same whole unit, flagged
    expect((await c.verseText('KJV', 'REV 13:1a')).found).toMatchObject({ address: 'REV 13:1/kjv', part: 'a' });
    // the other way, KJV's whole 13:1 is SBLGNT's 12:18 and 13:1
    const back = await c.map('KJV', 'REV 13:1', 'SBLGNT');
    expect([back.kind, back.verses.map((v) => v.address)]).toEqual(['several', ['REV 12:18/org', 'REV 13:1/org']]);
  });

  it('map throws for a verse the source scheme lacks', async () => {
    await expect(c.map('KJV', 'REV 12:18', 'BSB')).rejects.toThrow(/kjv has no REV 12:18\/kjv/);
  });

  it('chapter gives the document, the front matter on chapter 1, and every verse unit', async () => {
    const jhn3 = await c.chapter('KJV', 'JHN', 3);
    if (jhn3.kind !== 'chapter') throw new Error('JHN 3 absent');
    expect(jhn3.content.length).toBeGreaterThan(0);
    expect(jhn3.front).toBeNull();
    expect(jhn3.verses).toHaveLength(36);
    expect(jhn3.verses[15].address).toBe('JHN 3:16/kjv');
    const jhn1 = await c.chapter('BSB', 'JHN', 1);
    expect(jhn1.kind === 'chapter' && jhn1.front).not.toBeNull();
    // BSB skips MAT 17:21, so the chapter has one unit fewer than its scheme's 27 verses
    const mat17 = await c.chapter('BSB', 'MAT', 17);
    expect(mat17.kind === 'chapter' && mat17.verses.map((v) => v.verse)).not.toContain(21);
    expect(await c.chapter('KJV', 'PSA', 151)).toMatchObject({ kind: 'absent', reason: 'scheme' });
    noRowIds(jhn3);
  });

  it('rights: a record for each of the seven editions in the corpus', async () => {
    for (const id of ['KJV', 'BSB', 'WLC', 'SBLGNT', 'RP', 'WEB', 'Brenton']) {
      const r = await c.rights(id);
      expect(r).toMatchObject({ edition: id, route: 'local', offline: 'full', refreshDays: null, copyLimit: null, aiUse: 'allowed' });
    }
    expect((await c.rights('KJV')).attribution).toBeNull();
    expect((await c.rights('SBLGNT')).attribution).toMatch(/Society of Biblical Literature/);
    expect((await c.rights('WLC')).attribution).toMatch(/Open Scriptures Hebrew Bible/);
    await expect(c.rights('NIV')).rejects.toThrow(/no rights record/);
  });
});

describe.skipIf(!native)('the app contract on a verse bridge (fixtures/adversarial.usfm, \\v 5-6)', () => {
  let c: BibleContract;

  beforeAll(async () => {
    const w = await import('../ingest/write-db');
    const { normalizeChapters, splitChapters } = await import('../ingest/normalize');
    const { loadSchemes } = await import('../ingest/schemes');
    const { corpusContract } = await import('./corpus-contract');
    const usj = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'ingest', 'fixtures', 'adversarial.usj.json'), 'utf8'));
    const docs = splitChapters(usj);
    const { blocks, tokens, verses } = normalizeChapters(docs);
    const { db } = w.createCorpusDb(':memory:');
    w.seedBooksAndCanons(db);
    w.seedSchemes(db, loadSchemes());
    const translationId = w.insertTranslation(db, {
      name: 'Fixture',
      abbrev: 'FIX',
      language: 'english',
      year: null,
      license: null,
      scheme: 'kjv',
      edition: 'sha256:fixture',
    });
    w.insertBookRows(db, { translationId, book: 'JHN' }, { docs, verses, blocks, tokens });
    c = corpusContract(db);
  });

  it('both numbers of the bridge find the one unit, with its range', async () => {
    for (const v of ['JHN 1:5', 'JHN 1:6']) {
      const r = await c.verseText('FIX', v);
      expect(r.found).toEqual({
        kind: 'bridge',
        address: 'JHN 1:5-6/kjv',
        book: 'JHN',
        chapter: 1,
        verse: 5,
        lastVerse: 6,
        segment: '',
        text: 'A bridged verse collapses to its first number.',
      });
    }
  });

  it('a passage lists the bridge once, and the chapter has it as one unit', async () => {
    const p = await c.passage('FIX', 'John 1:4-7');
    expect(p.parts[0].address).toBe('JHN 1:4-7/kjv');
    expect(addresses(p.parts[0].found)).toEqual(['verse JHN 1:4/kjv', 'bridge JHN 1:5-6/kjv', 'absent JHN 1:7/kjv']);
    const ch = await c.chapter('FIX', 'JHN', 1);
    expect(ch.kind === 'chapter' && ch.verses.map((v) => v.address)).toEqual([1, 2, 3, 4].map((v) => `JHN 1:${v}/kjv`).concat('JHN 1:5-6/kjv'));
  });

  it('map to a bridge is one unit', async () => {
    const m = await c.map('FIX', 'JHN 1:6', 'FIX');
    expect([m.kind, m.verses.map((v) => `${v.kind} ${v.address}`)]).toEqual(['one', ['bridge JHN 1:5-6/kjv']]);
  });
});

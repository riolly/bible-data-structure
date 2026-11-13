import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { sqliteLoads } from '../ingest/native-probe';
import type { BibleContract, Lookup } from './contract';
import { parseReference } from './reference';

/**
 * The app contract (plan step 9) against the real KJV and BSB in
 * build/corpus.db, and against the `\v 5-6` bridge fixture, since KJV and BSB
 * have no bridges. The corpus tests skip until `bun run ingest` has run.
 */

const CORPUS = join(import.meta.dirname, '..', '..', 'build', 'corpus.db');
const native = sqliteLoads();

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
    expect(kjv.edition.textStamp).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(kjv.found).toMatchObject({ kind: 'verse', address: 'JHN 3:16/kjv', verse: 16, lastVerse: 16 });
    expect(kjv.found.kind === 'verse' && kjv.found.text).toContain('For God so loved the world, that he gave his only begotten Son');

    const bsb = await c.verseText('BSB', 'JHN 3:16');
    expect(bsb.edition).toMatchObject({ scheme: 'bsb', stamp: 'sha256:3b0004861fcf2481' });
    expect(bsb.found).toMatchObject({ kind: 'verse', address: 'JHN 3:16/bsb' });
    expect(bsb.found.kind === 'verse' && bsb.found.text).toMatch(/^For God so loved the world that He gave His one and only Son/);

    // a full address is allowed in the edition's own scheme only
    expect((await c.verseText('KJV', 'JHN 3:16/kjv')).found.address).toBe('JHN 3:16/kjv');
    await expect(c.verseText('KJV', 'JHN 3:16/org')).rejects.toThrow(/Use resolve/);
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

  it('map: a Psalm title Hebrew prints inside verse 1 is part of that verse (issue #12, ADR-0006 amendment)', async () => {
    // KJV 23:0 "A Psalm of David." is the start of WLC 23:1, מִזְמ֥וֹר לְדָוִ֑ד
    const title = await c.map('KJV', 'PSA 23:0', 'WLC');
    expect([title.kind, title.verses.map((v) => [v.address, v.part])]).toEqual(['part', [['PSA 23:1/org', 'a']]]);
    const verse1 = await c.map('KJV', 'PSA 23:1', 'WLC');
    expect([verse1.kind, verse1.verses.map((v) => [v.address, v.part])]).toEqual(['part', [['PSA 23:1/org', 'b']]]);
    const back = await c.map('WLC', 'PSA 23:1', 'KJV');
    expect([back.kind, back.verses.map((v) => v.address)]).toEqual(['several', ['PSA 23:0/kjv', 'PSA 23:1/kjv']]);
    const later = await c.map('WLC', 'PSA 23:2', 'BSB');
    expect([later.kind, later.verses.map((v) => v.address)]).toEqual(['one', ['PSA 23:2/bsb']]);
    // Psalm 37, where TVTMS's notes are wrong and its short table is right
    expect((await c.map('BSB', 'PSA 37:0', 'WLC')).verses.map((v) => v.address)).toEqual(['PSA 37:1/org']);
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

  it('a range that ends past the book stops at its last verse (#9)', async () => {
    const cases: [string, string, number][] = [
      ['Ps 150:5-151:2', 'PSA 150:5-6/kjv', 2],
      ['Gen 50:25-51:3', 'GEN 50:25-26/kjv', 2],
      ['Gen 49:30-60:5', 'GEN 49:30-50:26/kjv', 4 + 26],
    ];
    for (const [ref, address, n] of cases) {
      const [part] = (await c.passage('KJV', ref)).parts;
      expect([part.address, part.found.length, part.found.every((l) => l.kind === 'verse')]).toEqual([address, n, true]);
    }
  });

  it('map gives several verses in text order (#10)', async () => {
    const cases: [string, string[]][] = [
      ['1CH 12:4', ['1CH 12:4/org', '1CH 12:5/org']],
      ['1SA 20:42', ['1SA 20:42/org', '1SA 21:1/org']],
      ['1KI 22:43', ['1KI 22:43/org', '1KI 22:44/org']],
    ];
    for (const [address, want] of cases) {
      expect((await c.map('KJV', address, 'WLC')).verses.map((v) => v.address)).toEqual(want);
    }
  });

  it('resolve reads back any address the contract returns (#11)', async () => {
    const found = async (edition: string, address: string) => addresses((await c.resolve(edition, address)).found);
    // a range, including books the English parser doesn't know by their USFM code
    expect(await found('KJV', '1CO 13:4-7/kjv')).toEqual([4, 5, 6, 7].map((v) => `verse 1CO 13:${v}/kjv`));
    expect(await found('KJV', 'JOL 2:1-3/kjv')).toEqual([1, 2, 3].map((v) => `verse JOL 2:${v}/kjv`));
    expect(await found('KJV', 'JHN 3:16/kjv')).toEqual(['verse JHN 3:16/kjv']);
    expect(await found('Brenton', 'SIR 6:2/brenton')).toEqual(['verse SIR 6:2a/brenton', 'verse SIR 6:2b/brenton']);
    expect(await found('BSB', 'MAT 17:20-22/bsb')).toEqual(['verse MAT 17:20/bsb', 'absent MAT 17:21/bsb', 'verse MAT 17:22/bsb']);
    // a bridge (WEB's only one with words)
    const bridge = await c.verseText('WEB', '4MA 8:29');
    expect(await found('WEB', bridge.found.address)).toEqual(['bridge 4MA 8:28-29/web']);

    // a scheme the edition no longer uses: BSB numbered under kjv before step 3.3
    expect(await found('BSB', 'PHP 1:16/kjv')).toEqual(['verse PHP 1:17/bsb']);
    // a range under another scheme comes back in the edition's text order
    expect(await found('BSB', 'PHP 1:15-17/kjv')).toEqual([15, 16, 17].map((v) => `verse PHP 1:${v}/bsb`));
    expect(await found('BSB', 'ACT 8:37/kjv')).toEqual(['absent ACT 8:37/bsb']);
    expect(await found('KJV', 'PSA 51:1-2/org')).toEqual(['verse PSA 51:0/kjv']);
    const part = await c.resolve('KJV', 'REV 12:18/org');
    expect(part.found).toMatchObject([{ kind: 'verse', address: 'REV 13:1/kjv', part: 'a' }]);
    // a verse with no counterpart in the edition's scheme: absent, under the asked scheme
    expect((await c.resolve('KJV', 'REV 12:18/kjv')).found).toEqual([{ kind: 'absent', address: 'REV 12:18/kjv', reason: 'scheme' }]);

    await expect(c.resolve('KJV', 'JHN 3:16')).rejects.toThrow(/missing "\/scheme"/);
    await expect(c.resolve('KJV', 'JHN 3:16!2/kjv')).rejects.toThrow(/word address/);
    await expect(c.resolve('KJV', 'JHN 3:16/nope')).rejects.toThrow(/unknown scheme/);
    noRowIds(part);
  });

  it('passage reads a reference under another numbering when asked: English numbers on WLC', async () => {
    // under the edition's own scheme, the default, Ps 51:1 is the Hebrew title
    expect(addresses((await c.passage('WLC', 'Ps 51:1')).parts[0].found)).toEqual(['verse PSA 51:1/org']);
    const ps = await c.passage('WLC', 'Ps 51:1', { scheme: 'kjv' });
    expect([ps.parts[0].address, addresses(ps.parts[0].found)]).toEqual(['PSA 51:1/kjv', ['verse PSA 51:3/org']]);
    const mal = await c.passage('WLC', 'Mal 4:1', { scheme: 'kjv' });
    expect(addresses(mal.parts[0].found)).toEqual(['verse MAL 3:19/org']);
    expect(addresses((await c.passage('WLC', 'Mal 4:1')).parts[0].found)).toEqual(['absent MAL 4:1/org']);
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
    // the chapter stamp covers the document and every unit's text, and each unit carries it
    expect(jhn3.stamp).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(new Set(jhn3.verses.map((v) => v.chapterStamp))).toEqual(new Set([jhn3.stamp]));
    expect((await c.verseText('KJV', 'JHN 3:16')).found).toMatchObject({ chapterStamp: jhn3.stamp });
    expect((await c.chapter('KJV', 'JHN', 4)).kind === 'chapter' && (await c.chapter('KJV', 'JHN', 4))).not.toMatchObject({ stamp: jhn3.stamp });
    // no word attributes reach a document: nothing checks the sources' Strong's numbers (ADR-0003)
    expect(JSON.stringify(jhn3.content)).not.toMatch(/strong|x-morph/);
    const jhn1 = await c.chapter('BSB', 'JHN', 1);
    expect(jhn1.kind === 'chapter' && jhn1.front).not.toBeNull();
    // BSB skips MAT 17:21, so the chapter has one unit fewer than its scheme's 27 verses
    const mat17 = await c.chapter('BSB', 'MAT', 17);
    expect(mat17.kind === 'chapter' && mat17.verses.map((v) => v.verse)).not.toContain(21);
    expect(await c.chapter('KJV', 'PSA', 151)).toMatchObject({ kind: 'absent', reason: 'scheme' });
    noRowIds(jhn3);
  });

  it('words: map plus one read gives the Hebrew words of an English verse, each with a Strong\'s number and a gloss', async () => {
    const m = await c.map('KJV', 'GEN 1:1', 'WLC');
    const w = await c.words('WLC', m.verses[0].address);
    expect(w.asked).toBe('GEN 1:1/org');
    expect(w.words.map((x) => `${x.address} ${x.strongs.join()} ${x.original?.gloss}`)).toEqual([
      'GEN 1:1!1/org H7225 in beginning',
      'GEN 1:1!2/org H1254 he created',
      'GEN 1:1!3/org H430 God',
      'GEN 1:1!4/org H853 (et)',
      'GEN 1:1!5/org H8064 the heavens',
      'GEN 1:1!6/org H853 and (et)',
      'GEN 1:1!7/org H776 the earth',
    ]);
    // OSHB's own word ids, lemma and morphology
    expect(w.words[0]).toMatchObject({ kind: 'word', text: 'בְּרֵאשִׁ֖ית'.normalize('NFC'), original: { owId: '01xeN', lemma: 'b/7225', morph: 'HR/Ncfsa' } });
    noRowIds(w);
  });

  it('words: the Greek words of an English verse, from MACULA Greek', async () => {
    const m = await c.map('BSB', 'JHN 3:16', 'SBLGNT');
    const w = await c.words('SBLGNT', m.verses[0].address);
    expect(w.words).toHaveLength(25);
    expect(w.words.slice(0, 3).map((x) => [x.address, x.text, x.strongs, x.original?.owId, x.original?.lemma])).toEqual([
      ['JHN 3:16!1/org', 'Οὕτως', ['G3779'], 'n43003016001', 'οὕτω(ς)'],
      ['JHN 3:16!2/org', 'γὰρ', ['G1063'], 'n43003016002', 'γάρ'],
      ['JHN 3:16!3/org', 'ἠγάπησεν', ['G25'], 'n43003016003', 'ἀγαπάω'],
    ]);
    expect(w.words.every((x) => x.strongs.length === 1 && x.original?.gloss)).toBe(true);
    // Strong's dictionary has no Ἀρνί (Luke 3:33)
    expect((await c.words('SBLGNT', 'LUK 3:33!6')).words.map((x) => [x.text, x.strongs])).toEqual([['Ἀρνὶ', []]]);
  });

  it('words: a Psalm title maps to two Hebrew verses, each read once', async () => {
    const m = await c.map('KJV', 'PSA 51:0', 'WLC');
    const words = (await Promise.all(m.verses.map((v) => c.words('WLC', v.address)))).flatMap((r) => r.words);
    expect(words.length).toBeGreaterThan(5);
    expect(words.every((x) => /^H\d+$/.test(x.strongs[0]) && x.original?.gloss)).toBe(true);
  });

  it('words: a ketiv is followed by its qere, and a qere read with no written word sits in its place (ADR-0007)', async () => {
    const gen = await c.words('WLC', 'GEN 8:17');
    const at = gen.words.findIndex((x) => x.kind === 'ketiv');
    expect(gen.words[at]).toMatchObject({ address: 'GEN 8:17!14/org', text: 'הוצא', strongs: ['H3318'], original: { gloss: null } });
    expect(gen.words[at + 1]).toMatchObject({ kind: 'qere', address: null, text: 'הַיְצֵ֣א'.normalize('NFC'), strongs: ['H3318'], original: { gloss: 'bring out' } });
    const rut = await c.words('WLC', 'RUT 3:5');
    expect(rut.words.map((x) => `${x.kind} ${x.address ?? '-'}`)).toEqual([
      ...[1, 2, 3, 4, 5].map((n) => `word RUT 3:5!${n}/org`),
      'qere -',
      'word RUT 3:5!6/org',
    ]);
  });

  it('words: a word address gives that word, both halves where OSHB divides one (1CH 15:13)', async () => {
    const one = await c.words('WLC', 'GEN 1:1!1');
    expect(one.words.map((x) => x.strongs[0])).toEqual(['H7225']);
    const two = await c.words('WLC', 'PSA 51:1/org');
    expect(two.words.every((x) => x.original)).toBe(true);
    const divided = await c.words('WLC', '1CH 15:13!2');
    expect(divided.words.map((x) => [x.address, x.strongs[0], x.original?.owId])).toEqual([
      ['1CH 15:13!2/org', 'H4100', '13Z5a'],
      ['1CH 15:13!2/org', 'H7223', '1391p'],
    ]);
  });

  it("words: a BSB word address gives its Strong's numbers and the original words it translates (plan step 12)", async () => {
    const for_ = await c.words('BSB', 'JHN 3:16!1');
    expect(for_.words).toEqual([
      {
        address: 'JHN 3:16!1/bsb',
        text: 'For',
        kind: 'word',
        strongs: ['G1063'],
        original: null,
        originals: [{ edition: 'SBLGNT', address: 'JHN 3:16!2/org', owId: 'n43003016002' }],
      },
    ]);
    // "In the beginning" is one group aligned to the two morphemes of בְּרֵאשִׁית
    const gen = await c.words('BSB', 'GEN 1:1');
    expect(gen.words.slice(0, 4).map((x) => [x.text, x.strongs, x.originals.map((o) => o.address)])).toEqual([
      ['In', ['H871', 'H7225'], ['GEN 1:1!1/org']],
      ['the', ['H871', 'H7225'], ['GEN 1:1!1/org']],
      ['beginning', ['H871', 'H7225'], ['GEN 1:1!1/org']],
      ['God', ['H430'], ['GEN 1:1!3/org']],
    ]);
    // a word aligned to a qere points at it with no address (ADR-0007)
    const rut = await c.words('BSB', 'RUT 3:5!1');
    expect(rut.words[0].originals.map((o) => [o.address, o.owId])).toEqual([[null, '08k23'], ['RUT 3:5!6/org', '08nxs']]);
    // a word Clear's 2024 BSB doesn't have, and a Psalm title, which Clear doesn't align
    expect((await c.words('BSB', 'GEN 2:14')).words.find((x) => x.text === 'Hiddekel')).toMatchObject({ strongs: [], originals: [] });
    expect((await c.words('BSB', 'PSA 3:0')).words.every((x) => x.strongs.length === 0)).toBe(true);
    noRowIds(gen);
  });

  it("words: a KJV word has the number of its own checked tag, linked to one original word (plan step 12)", async () => {
    const gen = await c.words('KJV', 'GEN 1:1');
    expect(gen.words.map((x) => [x.text, x.strongs, x.originals.map((o) => o.address)])).toEqual([
      ['In', [], []],
      ['the', [], []],
      ['beginning', ['H7225'], ['GEN 1:1!1/org']],
      ['God', ['H430'], ['GEN 1:1!3/org']],
      ['created', ['H1254'], ['GEN 1:1!2/org']],
      ['the', [], []],
      ['heaven', ['H8064'], ['GEN 1:1!5/org']],
      // tagged H0853, the second אֵת: וְאֵת, nearest its place in the verse
      ['and', ['H853'], ['GEN 1:1!6/org']],
      ['the', [], []],
      ['earth', ['H776'], ['GEN 1:1!7/org']],
    ]);
    // a tag whose number no word of the mapped verse has is not stored (GEN 6:4 men|H0582, OSHB H376)
    expect((await c.words('KJV', 'GEN 6:4')).words.filter((x) => x.text === 'men').at(-1)).toMatchObject({ strongs: [], originals: [] });
    // a New Testament tag links to the SBLGNT word
    expect((await c.words('KJV', 'JHN 3:16')).words.find((x) => x.text === 'God')?.originals).toEqual([
      { edition: 'SBLGNT', address: 'JHN 3:16!5/org', owId: 'n43003016005' },
    ]);
    noRowIds(gen);
    expect((await c.words('BSB', 'ACT 8:37')).words).toEqual([]);
    await expect(c.words('KJV', 'JHN 3:16-17')).rejects.toThrow(/range/);
    await expect(c.words('WLC', 'GEN 1:1/kjv')).rejects.toThrow(/Map it first/);
    // Brenton prints SIR 6:2 only as 2a and 2b: a word needs the part's letter
    await expect(c.words('Brenton', 'SIR 6:2!1')).rejects.toThrow(/SIR 6:2a!1/);
    expect((await c.words('Brenton', 'SIR 6:2a!1')).words.map((x) => x.address)).toEqual(['SIR 6:2a!1/brenton']);
  });

  it('words: every original word but 2 has a Strong\'s number, and all but 219 read words a gloss', async () => {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(CORPUS, { readonly: true });
    const rows = db
      .prepare(
        `SELECT t.abbrev, count(*) AS words, sum(o.strongs = '') AS none,
           sum(o.strongs != '' AND o.strongs NOT GLOB '[HG][1-9]*') AS bad,
           sum(o.gloss IS NULL AND o.kind != 'ketiv') AS unglossed, sum(o.kind = 'qere') AS qere
         FROM original_word o JOIN translation t ON t.id = o.translation_id GROUP BY t.abbrev ORDER BY t.abbrev`,
      )
      .all();
    db.close();
    // WLC: 305,495 word tokens, 12 of them two OSHB words, and 1,278 qere words
    expect(rows).toEqual([
      { abbrev: 'SBLGNT', words: 137741, none: 2, bad: 0, unglossed: 69, qere: 0 },
      { abbrev: 'WLC', words: 306785, none: 0, bad: 0, unglossed: 150, qere: 1278 },
    ]);
  });

  it('rights: a record for each of the seven editions in the corpus', async () => {
    for (const id of ['KJV', 'BSB', 'WLC', 'SBLGNT', 'RP', 'WEB', 'Brenton']) {
      const r = await c.rights(id);
      expect(r).toMatchObject({ edition: id, route: 'local', offline: 'full', refreshDays: null, copyLimit: null, aiUse: 'allowed' });
    }
    expect((await c.rights('KJV')).attribution).toBeNull();
    expect((await c.rights('SBLGNT')).attribution).toMatch(/Society of Biblical Literature/);
    expect((await c.rights('WLC')).attribution).toMatch(/Open Scriptures Hebrew Bible/);
    await expect(c.rights('ESV')).rejects.toThrow(/no rights record/);
    // the BSB's Strong's numbers are Clear Bible's (plan step 12)
    expect((await c.rights('BSB')).conditions.join(' ')).toMatch(/Clear Bible/);
  });

  it('credits: every data source with its license and credit', async () => {
    const credits = await c.credits();
    expect(credits.map((r) => r.id)).toEqual(['clear-bsb', 'kjv-strongs', 'macula-greek', 'macula-hebrew', 'oshb', 'tvtms', 'usfm-spec', 'vrs']);
    for (const r of credits) expect(r.attribution.length && r.license.length && r.url.length).toBeTruthy();
    expect(credits.find((r) => r.id === 'vrs')).toMatchObject({ license: 'MIT' });
  });
});

describe.skipIf(!native)('the app contract on a verse bridge (fixtures/adversarial.usfm, \\v 5-6)', () => {
  let c: BibleContract;

  beforeAll(async () => {
    const { memoryCorpus } = await import('./test-corpus');
    const { corpusContract } = await import('./corpus-contract');
    const usj = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'ingest', 'fixtures', 'adversarial.usj.json'), 'utf8'));
    c = corpusContract(await memoryCorpus({ abbrev: 'FIX', scheme: 'kjv', book: 'JHN', usj }));
  });

  it('a word address in a bridge counts within the unit, and the bridge\'s own address reads', async () => {
    const w = await c.words('FIX', 'JHN 1:6!2');
    expect(w.words).toEqual([{ address: 'JHN 1:5!2/kjv', text: 'bridged', kind: 'word', strongs: [], original: null, originals: [] }]);
    expect((await c.words('FIX', 'JHN 1:5-6/kjv')).words.map((x) => x.text).slice(0, 2)).toEqual(['A', 'bridged']);
    await expect(c.words('FIX', 'JHN 1:4-6/kjv')).rejects.toThrow(/range/);
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
        chapterStamp: expect.stringMatching(/^sha256:/),
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

  it('resolve reads a stored bridge address back', async () => {
    const r = await c.resolve('FIX', 'JHN 1:5-6/kjv');
    expect(addresses(r.found)).toEqual(['bridge JHN 1:5-6/kjv']);
  });

  it('map to a bridge is one unit', async () => {
    const m = await c.map('FIX', 'JHN 1:6', 'FIX');
    expect([m.kind, m.verses.map((v) => `${v.kind} ${v.address}`)]).toEqual(['one', ['bridge JHN 1:5-6/kjv']]);
  });
});

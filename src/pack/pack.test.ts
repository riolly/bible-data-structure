import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import type { BibleContract } from '../contract/contract';
import { sqliteLoads } from '../ingest/native-probe';

const CORPUS = join(import.meta.dirname, '..', '..', 'build', 'corpus.db');

const native = sqliteLoads();

describe.skipIf(!native)('checkPack on a small corpus (fixtures/adversarial.usj.json)', () => {
  let dir: string;
  let corpus: BibleContract;

  beforeAll(async () => {
    const { testCorpus } = await import('../contract/test-corpus');
    const { corpusContract } = await import('../contract/corpus-contract');
    const { buildPack } = await import('./pack');
    dir = mkdtempSync(join(tmpdir(), 'pack-'));
    const usj = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'ingest', 'fixtures', 'adversarial.usj.json'), 'utf8'));
    // a pack needs the hubs, so the fixture stands in for them too
    const fixtures = [
      { abbrev: 'FIX', scheme: 'kjv', book: 'JHN', usj },
      { abbrev: 'WLC', scheme: 'org', book: 'JHN', usj },
      { abbrev: 'SBLGNT', scheme: 'org', book: 'JHN', usj },
    ];
    corpus = corpusContract(await testCorpus(join(dir, 'corpus.db'), fixtures));
    buildPack(join(dir, 'corpus.db'), join(dir, 'FIX.db'), ['FIX']);
  });

  it('reads the same as the corpus DB, with every document deflated and no token or block rows', async () => {
    const { checkPack, openPack } = await import('./pack');
    const pack = openPack(join(dir, 'FIX.db'));
    const tables = pack.sqlite.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    expect(tables).not.toContain('token');
    expect(tables).not.toContain('block');
    expect(pack.sqlite.prepare('SELECT DISTINCT typeof(usj) type FROM chapter_doc').all()).toEqual([{ type: 'blob' }]);
    const got = await checkPack(pack, corpus, 'FIX');
    expect(got.chapters).toBe(2);
    expect(got.ms).toHaveLength(2);
    expect(got.words).toBeGreaterThan(0);
    pack.sqlite.close();
  });

  it('reads through the provider with packReader', async () => {
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const schema = await import('../db/corpus-schema');
    const { openPack } = await import('./pack');
    const { packReader } = await import('./format');
    const { provider } = await import('../provider/provider');
    const pack = openPack(join(dir, 'FIX.db'));
    const p = provider({ local: packReader(drizzle({ client: pack.sqlite, schema })), fetchChapter: async () => null });
    const got = await p.chapter('FIX', 'JHN', 1);
    expect(got).toEqual(await corpus.chapter('FIX', 'JHN', 1));
    expect(got.kind === 'chapter' && got.front).not.toBeNull();
    pack.sqlite.close();
  });

  it('stops at a verse text row the pack lacks', async () => {
    const { default: Database } = await import('better-sqlite3');
    const { checkPack, openPack } = await import('./pack');
    const broken = join(dir, 'broken.db');
    copyFileSync(join(dir, 'FIX.db'), broken);
    const sqlite = new Database(broken);
    // the last verse unit of chapter 1
    sqlite.exec(`DELETE FROM verse_text WHERE translation_id = (SELECT id FROM translation WHERE abbrev = 'FIX') AND chapter = 1
      AND verse = (SELECT max(verse) FROM verse_text WHERE chapter = 1 AND translation_id = (SELECT id FROM translation WHERE abbrev = 'FIX'))`);
    expect(sqlite.prepare('SELECT changes() n').get()).toEqual({ n: 1 });
    sqlite.close();
    const pack = openPack(broken);
    await expect(checkPack(pack, corpus, 'FIX')).rejects.toThrow(/the pack's chapter differs from the corpus DB's/);
    pack.sqlite.close();
  });
});

describe.skipIf(!native || !existsSync(CORPUS))('a BSB pack (build/corpus.db)', () => {
  let pack: BibleContract;
  let corpus: BibleContract;
  let editions: string[];
  let tables: string[];

  beforeAll(async () => {
    const { default: Database } = await import('better-sqlite3');
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const schema = await import('../db/corpus-schema');
    const { corpusContract } = await import('../contract/corpus-contract');
    const { buildPack, openPack } = await import('./pack');
    const path = join(mkdtempSync(join(tmpdir(), 'pack-')), 'BSB.db');
    // three books keep the build near a second, and cover a Psalm title and both hubs
    editions = buildPack(CORPUS, path, ['BSB'], { books: ['GEN', 'PSA', 'JHN'] });
    const opened = openPack(path);
    tables = opened.sqlite.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    pack = opened.contract;
    corpus = corpusContract(drizzle({ client: new Database(CORPUS, { readonly: true }), schema }));
  }, 30_000);

  it('holds the hub editions, and no token rows', () => {
    expect(editions).toEqual(['BSB', 'WLC', 'SBLGNT']);
    expect(tables).not.toContain('token');
    expect(tables).not.toContain('block');
  });

  it('reads a chapter, its document deflated, as the corpus DB does', async () => {
    const got = await pack.chapter('BSB', 'PSA', 3);
    expect(got).toEqual(await corpus.chapter('BSB', 'PSA', 3));
    expect(got.kind === 'chapter' && got.verses[0].address).toBe('PSA 3:0/bsb');
  });

  it("gives a BSB word's Strong's numbers and original word from the verse text's words", async () => {
    const got = await pack.words('BSB', 'JHN 3:16!1');
    expect(got).toEqual(await corpus.words('BSB', 'JHN 3:16!1'));
    expect(got.words[0]).toMatchObject({ text: 'For', strongs: ['G1063'], originals: [{ edition: 'SBLGNT', address: 'JHN 3:16!2/org' }] });
  });

  it('maps and reads the Hebrew words of a BSB verse', async () => {
    // the Hebrew numbers the title as verses 1 and 2
    const m = await pack.map('BSB', 'PSA 51:1', 'WLC');
    expect(m.verses.map((v) => v.address)).toEqual(['PSA 51:3/org']);
    const words = await pack.words('WLC', 'PSA 51:3');
    expect(words).toEqual(await corpus.words('WLC', 'PSA 51:3'));
    expect(words.words[0].strongs.length).toBeGreaterThan(0);
  });

  it('knows only the editions, books and schemes it holds', async () => {
    await expect(pack.chapter('KJV', 'JHN', 3)).rejects.toThrow(/unknown edition "KJV"/);
    await expect(pack.resolve('BSB', 'PSA 51:1/vul')).rejects.toThrow(/unknown scheme "vul"/);
    expect((await pack.resolve('BSB', 'PHP 1:16/kjv')).found.map((l) => l.address)).toEqual(['PHP 1:17/bsb']);
    expect(await pack.chapter('BSB', 'MAT', 1)).toMatchObject({ kind: 'absent', reason: 'text' });
  });
});

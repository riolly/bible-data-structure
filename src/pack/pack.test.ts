import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import type { BibleContract } from '../contract/contract';
import { nativeModuleLoads } from '../ingest/native-probe';

const CORPUS = join(import.meta.dirname, '..', '..', 'build', 'corpus.db');

const native = nativeModuleLoads(
  "import('better-sqlite3').then(({ default: D }) => { new D(':memory:').close(); process.exit(0); }, () => process.exit(1));",
);

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
    const { buildPack } = await import('./pack');
    const path = join(mkdtempSync(join(tmpdir(), 'pack-')), 'BSB.db');
    editions = buildPack(CORPUS, path, ['BSB']);
    const sqlite = new Database(path, { readonly: true });
    tables = sqlite.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    pack = corpusContract(drizzle({ client: sqlite, schema }));
    corpus = corpusContract(drizzle({ client: new Database(CORPUS, { readonly: true }), schema }));
  }, 120_000);

  it('holds the hub editions the BSB aligns to, and no token rows', () => {
    expect(editions).toEqual(['BSB', 'SBLGNT', 'WLC']);
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

  it('knows only the editions it holds', async () => {
    await expect(pack.chapter('KJV', 'JHN', 3)).rejects.toThrow(/unknown edition "KJV"/);
  });
});

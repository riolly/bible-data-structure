import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SBLGNT_BOOKS, sblgntXmlToUsfm } from './sblgnt-xml';
import { SOURCES_ROOT } from './source-files';
import { SOURCES } from './sources';
import { tokenize } from './tokenize';

describe('sblgntXmlToUsfm', () => {
  it('keeps prefixes, words and suffixes, and marks a paragraph that runs into a new chapter', () => {
    const xml = `﻿<book id="Mark">
  <title>ΚΑΤΑ ΜΑΡΚΟΝ</title>
  <p>
    <verse-number id="Mark 1:45">1:45</verse-number>
    <w>ὥστε</w>
    <suffix>. </suffix>
    <verse-number id="Mark 2:1">2:1</verse-number>
    <prefix> ⸀</prefix>
    <w>Καὶ</w>
    <suffix></suffix>
  </p>
  <p>
    <w>ἀμήν</w>
    <suffix>.⟧ </suffix>
    <verse-number id="Mark 2:2">2</verse-number>
    <prefix> ⟦</prefix>
    <w>Ἀναστὰς</w>
    <suffix> </suffix>
  </p>
  <p />
</book>`;
    expect(sblgntXmlToUsfm(xml, 'MRK').split('\n')).toEqual([
      '\\id MRK SBL Greek New Testament, from the upstream XML',
      '\\mt1 ΚΑΤΑ ΜΑΡΚΟΝ',
      '\\c 1',
      '\\p',
      '\\v 45 ὥστε.',
      '\\c 2',
      '\\nb',
      '\\v 1  ⸀Καὶ',
      '\\p',
      'ἀμήν.⟧',
      '\\v 2  ⟦Ἀναστὰς',
      '',
    ]);
  });

  it('rejects text outside an element', () => {
    expect(() => sblgntXmlToUsfm('<p>stray</p>', 'MRK')).toThrow(/outside an element/);
  });
});

const src = SOURCES.find((s) => s.meta.abbrev === 'SBLGNT')!;
const root = src.format ? join(SOURCES_ROOT, src.dir, src.format.path) : '';
const textDir = join(root, '..', 'text');

describe.skipIf(!existsSync(textDir))('the pinned upstream SBLGNT', () => {
  it("converts to USFM whose every verse tokenizes like upstream's plain-text edition", () => {
    const words = (s: string) => tokenize(s.normalize('NFC'), { paragraphMarks: true }).map((t) => t.text).join(' ');
    let verses = 0;
    for (const name of readdirSync(root)) {
      const code = SBLGNT_BOOKS[name.replace('.xml', '')];
      if (!code) continue;
      // the converted USFM's verses, with the paragraph markers removed
      const ours = new Map<string, string>();
      let chapter = 0;
      let key = '';
      for (const line of sblgntXmlToUsfm(readFileSync(join(root, name), 'utf8'), code).split('\n')) {
        const c = /^\\c (\d+)/.exec(line);
        const v = /^\\v (\d+) (.*)$/.exec(line);
        if (c) chapter = Number(c[1]);
        else if (v) ours.set((key = `${chapter}:${v[1]}`), v[2]);
        else if (key && !/^\\(p|nb)$/.test(line)) ours.set(key, `${ours.get(key)} ${line}`);
      }
      const theirs = readFileSync(join(textDir, name.replace('.xml', '.txt')), 'utf8')
        .split('\n')
        .flatMap((l) => {
          const m = /^\S.* (\d+:\d+)\t(.*)$/.exec(l);
          return m ? [[m[1], m[2]] as const] : [];
        });
      expect([...ours.keys()], code).toEqual(theirs.map(([k]) => k));
      for (const [k, text] of theirs) expect(words(ours.get(k)!), `${code} ${k}`).toBe(words(text));
      verses += theirs.length;
    }
    expect(verses).toBe(7939);
  });
});

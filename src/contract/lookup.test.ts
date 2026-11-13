import { describe, expect, it } from 'vitest';

import type { VerseText } from '../model/corpus';
import type { Scheme } from '../model/scheme';
import { readerContract } from './corpus-contract';
import type { CorpusReader } from './reader';

/**
 * The contract's rules for finding a verse in a chapter's units (ADR-0004
 * v1.5), over a reader that returns arrays: no SQLite, so these run on a
 * fresh checkout. Numbers 1 of `TST` has a bridge, a verse printed only in
 * parts, a verse whose part the edition doesn't mark, and a verse it skips.
 */

const SCHEME: Scheme = {
  id: 'tst',
  name: 'Test',
  sourceUrl: '',
  note: '',
  verseCounts: new Map([['NUM', [25, 10]]]),
  excluded: new Set(),
  segments: new Map(),
  titles: new Set(),
};

const unit = (verse: number, lastVerse = verse, segment = ''): VerseText => ({ chapter: 1, verse, lastVerse, segment, text: `${verse}-${lastVerse}${segment}` });
const NUM_1 = [unit(1), unit(20, 21), unit(22, 22, 'a'), unit(22, 22, 'b'), unit(23)];

const reader: CorpusReader = {
  edition: (abbrev) => (abbrev === 'TST' ? { abbrev, scheme: 'tst', edition: null, wordsStamp: null, textStamp: null } : null),
  chapter: (_, book, chapter) => (book === 'NUM' && chapter === 1 ? { stamp: 'sha256:num1', verses: NUM_1 } : null),
  chapterDoc: () => null,
  originalWords: () => [],
  wordAlignments: () => [],
  dataSources: () => [],
  schemes: () => new Map([['tst', SCHEME]]),
  mappings: () => {
    throw new Error('no mappings');
  },
};
const c = readerContract(reader);
const found = async (address: string) => (await c.verseText('TST', address)).found;

describe('finding a verse in a chapter\'s units', () => {
  it('finds a bridge from each number in its range', async () => {
    for (const v of ['NUM 1:20', 'NUM 1:21']) {
      expect(await found(v)).toMatchObject({ kind: 'bridge', address: 'NUM 1:20-21/tst', verse: 20, lastVerse: 21, chapterStamp: 'sha256:num1' });
    }
    const p = await c.passage('TST', 'Num 1:19-21');
    expect(p.parts[0].found.map((l) => `${l.kind} ${l.address}`)).toEqual(['absent NUM 1:19/tst', 'bridge NUM 1:20-21/tst']);
  });

  it('finds a segment, and a part the edition does not mark as its whole unit', async () => {
    expect(await found('NUM 1:22b')).toMatchObject({ kind: 'verse', address: 'NUM 1:22b/tst', text: '22-22b' });
    expect(await found('NUM 1:23b')).toMatchObject({ kind: 'verse', address: 'NUM 1:23/tst', part: 'b' });
  });

  it('gives a verse printed only in parts as its parts', async () => {
    const l = await found('NUM 1:22');
    expect(l.kind === 'parts' && l.parts.map((u) => u.address)).toEqual(['NUM 1:22a/tst', 'NUM 1:22b/tst']);
  });

  it('gives absent for a verse with no unit, a chapter with none, and a verse outside the scheme', async () => {
    expect(await found('NUM 1:25')).toMatchObject({ kind: 'absent', reason: 'text' });
    expect(await found('NUM 2:1')).toMatchObject({ kind: 'absent', reason: 'text' });
    expect(await found('NUM 1:26')).toMatchObject({ kind: 'absent', reason: 'scheme' });
    expect(await c.chapter('TST', 'NUM', 2)).toMatchObject({ kind: 'absent', reason: 'text' });
  });
});

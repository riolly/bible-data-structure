import { describe, expect, it } from 'vitest';

import { linkVerseTags, normalStrongs, type HubWord, type TagStats } from './kjv-tags';
import { normalizeChapters, type RawUsjNode, type WordTag } from './normalize';

const w = (text: string, strong: string): RawUsjNode => ({ type: 'char', marker: 'w', strong, content: [text] });

/** One chapter with one paragraph holding `\v 1` and the given inline nodes. */
const chapter = (...inline: RawUsjNode[]) => [
  {
    chapter: 1,
    content: [
      { type: 'chapter', marker: 'c', number: '1' },
      { type: 'para', marker: 'p', content: [{ type: 'verse', marker: 'v', number: '1' }, ...inline] },
    ],
  },
];

describe('collecting `\\w strong=` tags in normalize', () => {
  // GEN 1:1 as ebible's eng-kjv prints it
  const gen = chapter(
    'In the ', w('beginning', 'H7225'), ' ', w('God', 'H0430'), ' ', w('created', 'H1254'), ' the ',
    w('heaven', 'H8064'), ' ', w('and', 'H0853'), ' the ', w('earth', 'H0776'), '.',
  );

  it('gives each tag the word indexes of the words it covers, and leaves untagged words out', () => {
    const { wordTags } = normalizeChapters(gen, { wordTags: true });
    expect(wordTags.map((t) => [t.wordIndexes, t.strongs])).toEqual([
      [[2], ['H7225']],
      [[3], ['H0430']],
      [[4], ['H1254']],
      [[6], ['H8064']],
      [[7], ['H0853']],
      [[9], ['H0776']],
    ]);
  });

  it('changes no token and stores no attribute', () => {
    const plain = normalizeChapters(gen);
    const tagged = normalizeChapters(gen, { wordTags: true });
    expect(tagged.tokens).toEqual(plain.tokens);
    expect(plain.wordTags).toEqual([]);
    expect(JSON.stringify(tagged.docs)).not.toContain('strong');
  });

  it('counts every word a tag covers, and a word the tag covers only in part', () => {
    const { tokens, wordTags } = normalizeChapters(
      chapter('All ', w('these things', 'G5023'), ' are the ', w('LORD', 'H3068'), "'s."),
      { wordTags: true },
    );
    expect(tokens.filter((t) => t.kind === 'word').map((t) => t.text)).toEqual(['All', 'these', 'things', 'are', 'the', "LORD's"]);
    expect(wordTags.map((t) => t.wordIndexes)).toEqual([[1, 2], [5]]);
  });

  it('gives a tag split by a verse marker one entry per verse', () => {
    const { wordTags } = normalizeChapters(
      chapter({ type: 'char', marker: 'w', strong: 'G1', content: ['one ', { type: 'verse', marker: 'v', number: '2' }, 'two'] }),
      { wordTags: true },
    );
    expect(wordTags.map((t) => [t.verse, t.wordIndexes])).toEqual([[1, [0]], [2, [0]]]);
  });
});

describe('linkVerseTags', () => {
  const unit = { book: 'GEN', chapter: 1, verse: 1, segment: '' };
  const hub = (...words: [string, string, HubWord['kind']?][]): HubWord[] =>
    words.map(([owId, strongs, kind]) => ({ source: 'oshb', owId, kind: kind ?? 'word', strongs: strongs ? [strongs] : [] }));
  const tag = (wordIndexes: number[], ...strongs: string[]): WordTag => ({ ...unit, wordIndexes, strongs });
  const newStats = (): TagStats => ({ tags: 0, passed: 0, unmapped: 0 });

  // WLC GEN 1:1: בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ
  const gen = hub(['01a', 'H7225'], ['01b', 'H1254'], ['01c', 'H430'], ['01d', 'H853'], ['01e', 'H8064'], ['01f', 'H853'], ['01g', 'H776']);

  it('links a tag to the word with its number, and drops leading zeros', () => {
    const stats = newStats();
    const rows = linkVerseTags(unit, 10, [tag([3], 'H0430')], gen, stats);
    expect(rows).toEqual([{ ...unit, wordIndex: 3, seq: 0, source: 'oshb', owId: '01c', strongs: ['H430'] }]);
    expect(stats).toEqual({ tags: 1, passed: 1, unmapped: 0 });
  });

  it('takes the word nearest its place when the verse has more words with the number (GEN 1:1 "and")', () => {
    const rows = linkVerseTags(unit, 10, [tag([7], 'H0853')], gen, newStats());
    expect(rows.map((r) => r.owId)).toEqual(['01f']);
  });

  it('takes the words in order when the counts match', () => {
    const twice = hub(['a', 'H430'], ['b', 'H1'], ['c', 'H430']);
    const rows = linkVerseTags(unit, 4, [tag([3], 'H0430'), tag([0], 'H0430')], twice, newStats());
    expect(rows.map((r) => [r.wordIndex, r.owId])).toEqual([[3, 'a'], [0, 'c']]);
  });

  it('gives every word of a tag the row', () => {
    const rows = linkVerseTags(unit, 3, [tag([1, 2], 'G5023')], hub(['g', 'G5023']), newStats());
    expect(rows.map((r) => r.wordIndex)).toEqual([1, 2]);
  });

  it('stores nothing for a tag whose number no word of the verse has', () => {
    const stats = newStats();
    expect(linkVerseTags(unit, 10, [tag([5], 'H0582')], gen, stats)).toEqual([]);
    expect(stats).toEqual({ tags: 1, passed: 0, unmapped: 0 });
  });

  it('prefers the qere to its ketiv, and takes the ketiv when it alone has the number', () => {
    const kq = hub(['k', 'H5', 'ketiv'], ['q', 'H5', 'qere'], ['k2', 'H6', 'ketiv']);
    expect(linkVerseTags(unit, 2, [tag([0], 'H5'), tag([1], 'H6')], kq, newStats()).map((r) => r.owId)).toEqual(['q', 'k2']);
  });

  it('counts the tags of a verse that maps to no hub verse apart', () => {
    const stats = newStats();
    expect(linkVerseTags(unit, 1, [tag([0], 'G1')], [], stats)).toEqual([]);
    expect(stats).toEqual({ tags: 1, passed: 0, unmapped: 1 });
  });

  it('rejects a tag that is not a Strong\'s number', () => {
    expect(() => normalStrongs('H12a')).toThrow(/not a Strong's number/);
  });
});

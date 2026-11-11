import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ChapterDoc, Token } from '../model/corpus';
import { normalizeChapters, splitChapters, type RawChapterDoc, type RawUsjElement, type RawUsjNode, type UsjDoc } from './normalize';

/**
 * The stored truth is one USJ document per chapter (ADR-0001 amendment, plan
 * step 7). fixtures/chapter-doc.usfm holds a footnote, a cross-reference,
 * \add, \nd, \sc, \wj, \va and \vp, a stanza break, a verse printed with no
 * words and a skipped verse. parse.test.ts checks the committed USJ against a
 * fresh parse.
 */
const usj = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'chapter-doc.usj.json'), 'utf8')) as UsjDoc;
const { docs, blocks, tokens, verses } = normalizeChapters(splitChapters(usj));

const elements = (nodes: readonly RawUsjNode[]): RawUsjElement[] =>
  nodes.flatMap((n) => (typeof n === 'string' ? [] : [n, ...elements(n.content ?? [])]));
const strings = (nodes: readonly RawUsjNode[]): string[] =>
  nodes.flatMap((n) => (typeof n === 'string' ? [n] : strings(n.content ?? [])));
const doc = (chapter: number) => docs.find((d) => d.chapter === chapter)!;
const words = (chapter: number, verse: number) =>
  tokens.filter((t) => t.chapter === chapter && t.verse === verse).map((t: Token) => t.text);

describe('splitChapters: one document per chapter, unchanged', () => {
  it('splits at each \\c, with front matter as chapter 0, and loses no node', () => {
    expect(docs.map((d) => d.chapter)).toEqual([0, 1, 2]);
    expect(doc(0).content.map((n) => (typeof n === 'string' ? n : n.marker))).toEqual(['id', 'h', 'mt1']);
    expect(docs.flatMap((d) => d.content)).toEqual(usj.content);
  });

  it('keeps the published chapter and verse numbers', () => {
    expect(doc(1).content[0]).toMatchObject({ type: 'chapter', number: '1', pubnumber: 'A' });
    expect(elements(doc(1).content).find((e) => e.type === 'verse' && e.number === '2')).toMatchObject({
      altnumber: '3',
      pubnumber: '2a',
    });
  });

  it('keeps the footnote and the cross-reference with their parts', () => {
    const notes = elements(doc(1).content).filter((e) => e.type === 'note');
    expect(notes.map((n) => [n.marker, n.caller])).toEqual([['f', '+'], ['x', '-'], ['f', '+']]);
    expect(strings(notes[0].content!)).toEqual([' ', '1:1 ', 'Or ', 'the Master']);
    expect(elements(notes[1].content!).map((e) => e.marker)).toEqual(['xo', 'xt']);
    expect(strings(notes[1].content!)).toEqual(['1:2 ', 'Gen 1:1']);
  });

  it('keeps the character styles, the stanza break and the whitespace', () => {
    const styles = elements(docs.flatMap((d) => d.content)).filter((e) => e.type === 'char' && !/^[fx]/.test(e.marker!));
    expect(styles.map((e) => [e.marker, strings(e.content!).join('')])).toEqual([
      ['nd', 'Lord'],
      ['add', 'servant'],
      ['sc', 'small caps'],
      ['wj', 'Words of Jesus'],
    ]);
    expect(elements(doc(2).content).filter((e) => e.type === 'para').map((e) => e.marker)).toEqual([
      'd', 'q1', 'b', 'q2', 'li2', 's2', 'p',
    ]);
    expect(strings(doc(1).content)).toContain(' heard.\n');
  });

  it('drops the word attributes of the source, which nothing checks (ADR-0003), and keeps the text', () => {
    const w = { type: 'char', marker: 'w', strong: 'H7225', 'x-morph': 'HNcfsa', content: ['beginning'] };
    const [d] = splitChapters({ type: 'USJ', version: '3.1', content: [{ type: 'chapter', marker: 'c', number: '1' }, { type: 'para', marker: 'p', content: [w] }] });
    expect(d.content[1]).toEqual({ type: 'para', marker: 'p', content: [{ type: 'char', marker: 'w', content: ['beginning'] }] });
  });

  it('a document that went through JSON derives the same rows', () => {
    const stored = JSON.parse(JSON.stringify(docs)) as ChapterDoc[];
    expect(normalizeChapters(stored)).toEqual(normalizeChapters(docs));
  });
});

describe('derived rows', () => {
  it('styled text becomes tokens, note text never does', () => {
    expect(words(1, 1)).toEqual(['The', 'Lord', 'spoke', ',', 'and', 'his', 'servant', 'heard', '.']);
    expect(words(1, 2)).toEqual(['A', 'cross-reference', 'in', 'small', 'caps', '.']);
    expect(words(1, 5)).toEqual(['Words', 'of', 'Jesus', 'after', 'a', 'skipped', 'verse', '.']);
    expect(tokens.some((t) => /Master|manuscripts|Gen/.test(t.text))).toBe(false);
  });

  it('a block keeps its USFM marker and level', () => {
    expect(blocks.map((b) => [b.chapter, b.marker, b.genre])).toEqual([
      [0, 'mt1', 'heading'],
      [1, 's1', 'heading'],
      [1, 'p', 'prose'],
      [1, 'pi2', 'prose'],
      [2, 'd', 'heading'],
      [2, 'q1', 'poetry'],
      [2, 'q2', 'poetry'], // the stanza break \b makes no block
      [2, 'li2', 'prose'],
      [2, 's2', 'heading'],
      [2, 'p', 'prose'],
    ]);
  });

  it('verse text: one row per verse marker, empty for a verse printed with no words, none for a skipped verse', () => {
    expect(verses.map((v) => [v.chapter, v.verse, v.segment, v.text])).toEqual([
      [1, 1, '', 'The Lord spoke, and his servant heard.'],
      [1, 2, '', 'A cross-reference in small caps.'],
      [1, 3, '', ''],
      [1, 5, '', 'Words of Jesus after a skipped verse.'],
      [2, 1, '', 'The first stanza ends here;'],
      [2, 2, '', 'the second stanza begins. A list item at level two.'],
      [2, 3, '', 'The last verse.'],
    ]);
    expect(words(1, 3)).toEqual([]);
    expect(words(1, 4)).toEqual([]);
  });
});

describe('only the supported markers (ADR-0001 amendment)', () => {
  const verse = (...content: RawUsjNode[]): RawChapterDoc[] => [
    { chapter: 1, content: [{ type: 'chapter', marker: 'c', number: '1' }, { type: 'para', marker: 'p', content: [{ type: 'verse', marker: 'v', number: '1' }, ...content] }] },
  ];

  it('stops on a paragraph, character style, note part or node type outside the list', () => {
    expect(() => normalizeChapters([{ chapter: 1, content: [{ type: 'chapter', marker: 'c', number: '1' }, { type: 'para', marker: 'cd', content: ['x'] }] }])).toThrow(/"\\cd"/);
    expect(() => normalizeChapters(verse({ type: 'char', marker: 'em', content: ['x'] }))).toThrow(/"\\em"/);
    expect(() => normalizeChapters(verse({ type: 'note', marker: 'fe', content: [] }))).toThrow(/"\\fe"/);
    expect(() => normalizeChapters(verse({ type: 'note', marker: 'f', content: [{ type: 'char', marker: 'fv', content: ['1'] }] }))).toThrow(/"\\fv"/);
    expect(() => normalizeChapters(verse({ type: 'ms', marker: 'qt-s' }))).toThrow(/"\\qt-s"/);
    expect(() => normalizeChapters(verse({ type: 'figure', marker: 'fig' }))).toThrow(/"\\fig"/);
    expect(() => normalizeChapters(verse({ type: 'char', marker: 'nd', content: [{ type: 'char', marker: 'em', content: ['x'] }] }))).toThrow(/"\\em"/);
  });

  it('stops when a document does not start with its own chapter', () => {
    expect(() => normalizeChapters([{ chapter: 2, content: [{ type: 'chapter', marker: 'c', number: '1' }] }])).toThrow(/chapter/);
  });
});

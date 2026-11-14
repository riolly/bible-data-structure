import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { chapterStamp } from '../ingest/edition';
import { normalizeChapters, type RawUsjElement, type RawUsjNode } from '../ingest/normalize';
import { adaptApiBibleChapter, readApiBibleChapter, type ApiBibleChapter, type ApiBibleNode } from './api-bible';

/**
 * fixtures/api-bible-kjv-*.json are API.Bible's KJV (`de4e12af7f28f599-02`,
 * public domain) as fetched on 2026-11-12, with the per-request `meta` left
 * out. research/api-bible.md has the request.
 */
const fixture = (name: string) =>
  (JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8')) as { data: ApiBibleChapter }).data;

const elements = (nodes: readonly RawUsjNode[]): RawUsjElement[] =>
  nodes.flatMap((n) => (typeof n === 'string' ? [] : [n, ...elements(n.content ?? [])]));

const text = (s: string): ApiBibleNode => ({ type: 'text', text: s });
const tag = (name: string, attrs: Record<string, string>, items: ApiBibleNode[] = []): ApiBibleNode => ({
  type: 'tag',
  name,
  attrs,
  items,
});
const chapterOf = (content: ApiBibleNode[]): ApiBibleChapter => ({
  id: 'NUM.1',
  bibleId: 'test',
  bookId: 'NUM',
  number: '1',
  reference: 'Numbers 1',
  copyright: '',
  content: [tag('chapter', { number: '1', style: 'c', sid: 'NUM 1' }, [text('1')]), ...content],
});

describe('adaptApiBibleChapter: API.Bible JSON to the step 7 chapter document', () => {
  it('converts KJV John 3 into a document the ingest checks accept, verse for verse', () => {
    const { doc, unsupported } = adaptApiBibleChapter(fixture('api-bible-kjv-JHN.3.json'));
    expect(unsupported).toEqual({});
    expect(doc.content[0]).toEqual({ type: 'chapter', marker: 'c', number: '3', sid: 'JHN 3' });
    const { verses, tokens, stats } = normalizeChapters([doc]);
    expect(verses.map((v) => v.verse)).toEqual(Array.from({ length: 36 }, (_, i) => i + 1));
    // API.Bible's KJV prints the pilcrow, as ebible's does: the verse text leaves it out and the token stays (ADR-0001 amendment, 2026-11-14)
    expect(verses.find((v) => v.verse === 16)!.text).toBe(
      'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
    );
    expect(tokens.filter((t) => t.verse === 16).slice(0, 2).map((t) => [t.kind, t.text, t.wordIndex])).toEqual([
      ['punct', '¶', null],
      ['word', 'For', 0],
    ]);
    expect(stats.wordsOfJesus).toBeGreaterThan(0);
  });

  it('keeps Psalm 3 as poetry, with its title, stanza break and footnote', () => {
    const { doc, unsupported } = adaptApiBibleChapter(fixture('api-bible-kjv-PSA.3.json'));
    expect(unsupported).toEqual({});
    const paras = elements(doc.content).filter((e) => e.type === 'para').map((e) => e.marker);
    expect(paras).toEqual(['d', 'q1', 'q1', 'q1', 'b', 'q1', 'q1', 'q1', 'q1', 'q1']);
    const note = elements(doc.content).find((e) => e.type === 'note')!;
    expect(note).toMatchObject({ marker: 'f', caller: '+' });
    expect(elements(note.content!).map((e) => e.marker)).toEqual(['fr', 'ft']);
    const { verses, blocks } = normalizeChapters([doc]);
    expect(verses).toHaveLength(8);
    expect(blocks[0]).toMatchObject({ genre: 'heading', marker: 'd' });
  });

  it('gives a verse bridge one unit with its range', () => {
    const { doc } = adaptApiBibleChapter(
      chapterOf([tag('para', { style: 'p' }, [tag('verse', { number: '20-21', style: 'v', sid: 'NUM 1:20-21' }, [text('20-21')]), text('Both verses.')])]),
    );
    expect(normalizeChapters([doc]).verses).toEqual([{ chapter: 1, verse: 20, lastVerse: 21, segment: '', text: 'Both verses.' }]);
  });

  it('keeps the text of an unsupported marker and counts it, instead of stopping', () => {
    const { doc, unsupported } = adaptApiBibleChapter(
      chapterOf([
        tag('para', { style: 'qm1' }, [
          tag('verse', { number: '1', style: 'v' }),
          tag('char', { style: 'bdit' }, [text('Bold')]),
          text(' words'),
          tag('note', { style: 'fe', caller: '+' }, [tag('char', { style: 'fk' }, [text('Endnote')])]),
        ]),
        tag('verse', { number: '2', style: 'v' }),
        text('Loose text.'),
      ]),
    );
    expect(unsupported).toEqual({ 'para:qm1': 1, 'char:bdit': 1, 'note:fe': 1, 'char:fk': 1, 'top:verse': 1, 'top:text': 1 });
    const { verses } = normalizeChapters([doc]);
    expect(verses).toEqual([
      { chapter: 1, verse: 1, lastVerse: 1, segment: '', text: 'Bold words' },
      { chapter: 1, verse: 2, lastVerse: 2, segment: '', text: 'Loose text.' },
    ]);
    expect(elements(doc.content).find((e) => e.type === 'note')).toEqual({
      type: 'note',
      marker: 'f',
      caller: '+',
      content: ['Endnote'],
    });
  });

  it('unwraps the verse spans API.Bible adds with include-verse-spans', () => {
    const span = (items: ApiBibleNode[]) => tag('verse-span', { class: 'verse-span', verseId: 'NUM.1.1' }, items);
    const { doc, unsupported } = adaptApiBibleChapter(
      chapterOf([tag('para', { style: 'p' }, [span([tag('verse', { number: '1', style: 'v' })]), span([text('In the wilderness.')])])]),
    );
    expect(unsupported).toEqual({});
    expect(doc.content[1]).toEqual({ type: 'para', marker: 'p', content: [{ type: 'verse', marker: 'v', number: '1' }, 'In the wilderness.'] });
  });

  it('refuses a response that is not a numbered chapter', () => {
    expect(() => adaptApiBibleChapter({ ...chapterOf([]), id: 'NUM.intro', number: 'intro' })).toThrow(/not a numbered chapter/);
  });
});

describe('readApiBibleChapter: a fetched chapter as the contract reads it', () => {
  it('stamps the chapter with the same bytes and hash as the ingest', async () => {
    const read = await readApiBibleChapter(fixture('api-bible-kjv-JHN.3.json'));
    expect(read.verses).toHaveLength(36);
    expect(read.stamp).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(read.stamp).toBe(chapterStamp(JSON.stringify(read.doc.content), read.verses));
  });

  it('changes the stamp when one character of the text changes', async () => {
    const data = fixture('api-bible-kjv-JHN.3.json');
    const edited = JSON.parse(JSON.stringify(data).replace('everlasting life', 'everlasting Life')) as ApiBibleChapter;
    expect((await readApiBibleChapter(edited)).stamp).not.toBe((await readApiBibleChapter(data)).stamp);
  });
});

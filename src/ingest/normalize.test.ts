import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { verseUnitOf, type Block, type Token } from '../model/corpus';
import { blockGenre, normalizeUsj, splitChapters, type UsjDoc } from './normalize';

/**
 * GOLDEN FIXTURE (ADR-0001/ADR-0004): committed USJ in → expected Token
 * stream + Block overlays. The USJ is generated from fixtures/adversarial.usfm
 * by usfm-grammar and committed so this test stays pure TS; parse.test.ts guards
 * USFM→USJ drift where the native parser is available.
 */
const usj = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'adversarial.usj.json'), 'utf8'),
) as UsjDoc;

const { blocks, tokens, verses, stats } = normalizeUsj(usj);

const blockTokens = (b: Block) => tokens.filter((t) => t.blockId === b.id);
const verseTokens = (chapter: number, verse: number) =>
  tokens.filter((t) => t.chapter === chapter && t.verse === verse);
const brief = (t: Token) => `${t.kind === 'word' ? t.wordIndex : 'p'}:${t.text}`;

describe('corpus invariants (CONTEXT.md)', () => {
  it('blocks PARTITION the token stream — every token in exactly one existing block, no empty blocks', () => {
    const ids = new Set(blocks.map((b) => b.id));
    const used = new Set<number>();
    for (const t of tokens) {
      expect(ids.has(t.blockId)).toBe(true);
      used.add(t.blockId);
    }
    expect(used.size).toBe(blocks.length);
    // tokens of a block are contiguous in render order
    for (const b of blocks) {
      const seqs = blockTokens(b).map((t) => t.seq);
      expect(seqs).toEqual(
        Array.from({ length: seqs.length }, (_, i) => seqs[0] + i),
      );
    }
  });

  it('whitespace is never a token', () => {
    for (const t of tokens) {
      expect(t.text).not.toMatch(/\s/);
      expect(t.text.length).toBeGreaterThan(0);
    }
  });

  it('a \\d title is verse 0 with word indexes only where the scheme numbers that chapter title (ADR-0001 amendment)', () => {
    const titled = normalizeUsj(usj, { titleChapters: new Set([2]) }).tokens;
    const title = titled.filter((t) => t.chapter === 2 && t.verse === 0);
    expect(title.map(brief)).toEqual(['0:A', '1:Psalm', '2:of', '3:the', '4:fixture', 'p:.']);
    expect(title.every((t) => !t.verseStart)).toBe(true); // a title prints no verse number
    // chapter 1's \s1 heading stays unversed: only a \d title before verse 1 is numbered
    expect(normalizeUsj(usj, { titleChapters: new Set([1, 2]) }).tokens.filter((t) => t.verse === 0)).toEqual(title);
  });

  it('EVERY heading token carries verse=NULL (never 0) and wordIndex=NULL without titleChapters', () => {
    const headingBlocks = blocks.filter((b) => b.genre === 'heading');
    expect(headingBlocks.length).toBe(5); // mt1, s1 ×2, d, qa
    for (const b of headingBlocks) {
      const ts = blockTokens(b);
      expect(ts.length).toBeGreaterThan(0);
      for (const t of ts) {
        expect(t.verse).toBeNull();
        expect(t.wordIndex).toBeNull();
        expect(t.verseStart).toBe(false);
      }
    }
    for (const t of tokens) expect(t.verse).not.toBe(0);
  });

  it('a MID-CHAPTER section heading does not inherit the preceding verse', () => {
    // ch1: \s1 between v3 and v4
    const mid = blocks.find(
      (b) => b.chapter === 1 && b.genre === 'heading' && blockTokens(b)[0]?.text === 'A',
    )!;
    expect(blockTokens(mid).map((t) => t.text)).toEqual(['A', 'Mid-Chapter', 'Heading']);
    expect(blockTokens(mid).every((t) => t.verse === null)).toBe(true);
    // ch2: \qa ALEPH sits between verse-2 and verse-2 content
    const qa = blocks.find((b) => b.marker === 'qa')!;
    expect(blockTokens(qa).map(brief)).toEqual(['null:ALEPH']);
  });

  it('word_index counts words only and CONTINUES across block boundaries within a verse', () => {
    // v1:3 spans a paragraph break
    expect(verseTokens(1, 3).map(brief)).toEqual([
      '0:A', '1:verse', '2:that', '3:spans', '4:a', '5:paragraph', '6:break', 'p:,',
      '7:continuing', '8:in', '9:the', '10:next', '11:paragraph', 'p:.',
    ]);
    // v2:1 spans \q1 → \q2 poetry lines
    expect(verseTokens(2, 1).map(brief)).toEqual([
      '0:The', '1:first', '2:poetry', '3:line', '4:goes', '5:here', 'p:,',
      '6:the', '7:second', '8:sits', '9:deeper', '10:still', 'p:;',
    ]);
  });
});

describe('adversarial tokenization inside the pipeline (ADR-0004)', () => {
  it('possessive, elided, hyphenated and quoted words in a real verse', () => {
    expect(verseTokens(1, 1).map(brief)).toEqual([
      '0:In', '1:the', '2:beginning', '3:was', '4:the', '5:LORD’s', '6:Word', 'p:,',
      '7:and', '8:Jesus', 'p:’', '9:father-in-law', '10:said', 'p:,', 'p:“',
      '11:Behold', 'p:!”',
    ]);
  });

  it('elision + numbers + em-dash; verse_start lands on the first WORD, not a leading punct', () => {
    expect(verseTokens(1, 2).map(brief)).toEqual([
      'p:’', '0:Twas', '1:the', '2:40th', '3:year', 'p:,', '4:and', '5:144,000',
      '6:stood', '7:by', '8:the', '9:riverside', 'p:—', '10:watching', 'p:.',
    ]);
    const twas = verseTokens(1, 2).find((t) => t.text === 'Twas')!;
    expect(twas.verseStart).toBe(true);
    const apostrophe = verseTokens(1, 2)[0];
    expect(apostrophe.kind).toBe('punct');
    expect(apostrophe.verseStart).toBe(false);
    // v4 similarly: “Quoted start” — verseStart on the word after the quote
    const v4 = verseTokens(1, 4);
    expect(v4.map(brief)).toEqual(['p:“', '0:Quoted', '1:start', 'p:”', '2:with', '3:punctuation', 'p:.']);
    expect(v4.find((t) => t.text === 'Quoted')!.verseStart).toBe(true);
  });

  it('a verse BRIDGE (\\v 5-6) is one unit: both numbers resolve to it, words count within it (ADR-0004 v1.5)', () => {
    const bridge = verseTokens(1, 5);
    expect(bridge.map(brief)).toEqual([
      '0:A', '1:bridged', '2:verse', '3:collapses', '4:to', '5:its', '6:first', '7:number', 'p:.',
    ]);
    expect(bridge[0].verseStart).toBe(true);
    // the tokens carry the first number; the unit holds the range
    expect(verseTokens(1, 6)).toEqual([]);
    const unit = { chapter: 1, verse: 5, lastVerse: 6, segment: '', text: 'A bridged verse collapses to its first number.' };
    expect(verses.find((v) => v.chapter === 1 && v.verse === 5)).toEqual(unit);
    expect(verseUnitOf(verses, 1, 5)).toEqual(unit);
    expect(verseUnitOf(verses, 1, 6)).toEqual(unit);
    expect(verseUnitOf(verses, 1, 7)).toBeUndefined();
    // a single verse is a unit whose first and last verse are the same
    expect(verseUnitOf(verses, 1, 4)).toMatchObject({ verse: 4, lastVerse: 4 });
  });

  it('a word split across a \\w char boundary is joined before tokenizing', () => {
    // \w LORD\w*’s → LORD’s, one word, verse-start of 2:2
    const v = verseTokens(2, 2);
    expect(v.slice(0, 4).map(brief)).toEqual(['0:LORD’s', '1:wrapped', '2:word', '3:awaits']);
    expect(v[0].verseStart).toBe(true);
  });

  it('dropped footnote/xref content never leaks tokens; kept char text (\\qs, \\wj) does', () => {
    expect(verseTokens(2, 2).map((t) => t.text)).toEqual([
      'LORD’s', 'wrapped', 'word', 'awaits', 'the', 'end', 'now', 'Selah',
      // \qr refrain continues verse 2:
      'And', 'all', 'the', 'people', 'say', ',', '“', 'Amen', '!”',
      // \pc, \pmo, \li1, \m, \pi, \nb prose still verse 2:
      'HOLY', 'TO', 'THE', 'LORD', '.',
      'And', 'there', 'was', 'evening', '—', 'day', 'one', '.',
      'the', 'first', 'list', 'item',
      'A', 'margin', 'paragraph', '.',
      'An', 'indented', 'paragraph', '.',
      'A', 'no-break', 'paragraph', '.',
    ]);
    expect(verseTokens(2, 3).map(brief)).toEqual([
      '0:Words', '1:of', '2:Jesus', '3:here', '4:remain', 'p:.',
    ]);
  });
});

describe('block overlays: genre and USFM marker', () => {
  it('emits the expected block sequence', () => {
    expect(blocks.map((b) => [b.chapter, b.genre, b.marker])).toEqual([
      [0, 'heading', 'mt1'], // front-matter chapter 0
      [1, 'heading', 's1'],
      [1, 'prose', 'p'], // v1–v2
      [1, 'prose', 'p'], // v3 start
      [1, 'prose', 'p'], // v3 continuation
      [1, 'heading', 's1'], // mid-chapter
      [1, 'prose', 'p'], // v4
      [1, 'prose', 'p'], // v5-6 bridge
      [2, 'heading', 'd'],
      [2, 'poetry', 'q1'],
      [2, 'poetry', 'q2'],
      [2, 'poetry', 'q1'], // after \b — no block for \b
      [2, 'poetry', 'qr'],
      [2, 'heading', 'qa'],
      [2, 'prose', 'pc'],
      [2, 'prose', 'pmo'],
      [2, 'prose', 'li1'],
      [2, 'prose', 'm'],
      [2, 'prose', 'pi'],
      [2, 'prose', 'nb'],
    ]);
  });

  it('block.seq equals the seq of its first token; seq is per-chapter and dense', () => {
    for (const b of blocks) expect(b.seq).toBe(blockTokens(b)[0].seq);
    for (const chapter of [0, 1, 2]) {
      const seqs = tokens.filter((t) => t.chapter === chapter).map((t) => t.seq);
      expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i));
    }
  });

  it('heading ordinals per chapter are deterministic (the deferred heading-anchor key)', () => {
    const ordinals = new Map<number, string[]>();
    for (const b of blocks) {
      if (b.genre !== 'heading') continue;
      const list = ordinals.get(b.chapter) ?? [];
      list.push(blockTokens(b).map((t) => t.text).join(' '));
      ordinals.set(b.chapter, list);
    }
    expect(ordinals.get(0)).toEqual(['The Adversarial Fixture']);
    expect(ordinals.get(1)).toEqual(['The Word’s Beginning', 'A Mid-Chapter Heading']);
    expect(ordinals.get(2)).toEqual(['A Psalm of the fixture .', 'ALEPH']);
  });
});

describe('stats bag — what the documents hold beyond the tokens is counted', () => {
  it('counts notes, styles and paragraphs with no block exactly', () => {
    expect(stats).toEqual({
      footnotes: 1,
      xrefs: 1,
      wordsOfJesus: 1,
      selah: 1,
      wWrapped: 1,
      preVerseWordTokens: 15, // mt1(3) + s1(3) + s1(3) + d(5) + qa(1)
      sectionRefs: 1, // \r
      altVerseNumbers: 0,
      altChapterNumbers: 0,
      verseBridges: 1, // \v 5-6
      metadataParas: { h: 1, toc1: 1 },
    });
  });
});

describe('Unicode NFC normalization at ingest', () => {
  const doc = (content: UsjDoc['content']): UsjDoc => ({ type: 'USJ', version: '3.1', content });
  const verse = (text: string): UsjDoc =>
    doc([
      { type: 'chapter', marker: 'c', number: '1' },
      { type: 'para', marker: 'p', content: [{ type: 'verse', marker: 'v', number: '1' }, text] },
    ]);

  it('stores decomposed Greek as one NFC word token (a combining mark never leaks as punct)', () => {
    // NFD input: base ο + combining acute U+0301, base ι + combining varia U+0300
    const nfd = 'λόγος'.normalize('NFD');
    expect(nfd).not.toBe('λόγος'); // guard: the fixture really is decomposed
    const { tokens } = normalizeUsj(verse(nfd));
    // one WORD token, NFC-composed — no combining mark split into a punct token
    expect(tokens.map((t) => [t.kind, t.text])).toEqual([['word', 'λόγος'.normalize('NFC')]]);
    expect(tokens[0].text).toBe('λόγος'.normalize('NFC'));
  });

  it('keeps a pointed Hebrew word as ONE word token (combining points never split it)', () => {
    // Hebrew vowel points are category M with NO canonical precomposed form, so
    // NFC is a no-op here — the word survives only if the tokenizer treats a
    // combining mark as part of its base word (not as a punct run).
    const word = 'בְּרֵאשִׁית'; // "in the beginning" — consonants + points
    const { tokens } = normalizeUsj(verse(word));
    expect(tokens.map((t) => t.kind)).toEqual(['word']);
    expect(tokens[0].text).toBe(word.normalize('NFC'));
  });

  it('is idempotent — already-NFC text is stored verbatim', () => {
    const nfc = 'λόγος'.normalize('NFC');
    const { tokens } = normalizeUsj(verse(nfc));
    expect(tokens[0].text).toBe(nfc);
  });
});

describe('normalize guards', () => {
  const doc = (content: UsjDoc['content']): UsjDoc => ({ type: 'USJ', version: '3.1', content });

  it('throws LOUDLY on an unsupported para marker', () => {
    expect(() =>
      normalizeUsj(doc([{ type: 'para', marker: 'cd', content: ['zap'] }])),
    ).toThrow(/unsupported paragraph "\\cd"/);
  });

  it('throws on unsupported top-level and inline node types', () => {
    expect(() => normalizeUsj(doc([{ type: 'table' }]))).toThrow(/unsupported top-level/);
    expect(() =>
      normalizeUsj(doc([{ type: 'para', marker: 'p', content: [{ type: 'sidebar' }] }])),
    ).toThrow(/unsupported inline/);
  });

  it('throws on text outside a paragraph', () => {
    expect(() => normalizeUsj(doc(['loose text']))).toThrow(/outside a paragraph/);
  });

  it('a VERSIFIED title (\\d containing an explicit \\v — BSB Zech 12) keeps its verse', () => {
    const r = normalizeUsj(
      doc([
        { type: 'chapter', marker: 'c', number: '12' },
        { type: 'para', marker: 's1', content: ['The Coming Deliverance'] },
        {
          type: 'para',
          marker: 'd',
          content: [
            { type: 'verse', marker: 'v', number: '1' },
            'This is the burden of the word.',
          ],
        },
        { type: 'para', marker: 'p', content: ['Thus declares the LORD.'] },
      ]),
    );
    // the \s1 heading stays unversed…
    const s1 = r.tokens.filter((t) => t.blockId === 0);
    expect(s1.every((t) => t.verse === null && t.wordIndex === null)).toBe(true);
    // …but the \d tokens carry the EXPLICIT verse 1 with word indexes
    const d = r.tokens.filter((t) => t.blockId === 1);
    expect(d.map((t) => [t.text, t.verse, t.wordIndex])).toEqual([
      ['This', 1, 0], ['is', 1, 1], ['the', 1, 2], ['burden', 1, 3], ['of', 1, 4],
      ['the', 1, 5], ['word', 1, 6], ['.', 1, null],
    ]);
    expect(d[0].verseStart).toBe(true);
    // the verse CONTINUES into the following prose (word indexes go on)
    const p = r.tokens.filter((t) => t.blockId === 2);
    expect(p.map((t) => [t.text, t.verse, t.wordIndex])).toEqual([
      ['Thus', 1, 7], ['declares', 1, 8], ['the', 1, 9], ['LORD', 1, 10], ['.', 1, null],
    ]);
  });

  it('leaves the pilcrow out of the verse text and keeps its token (ADR-0001 amendment, 2026-11-14)', () => {
    // KJV MRK 16:9, as ebible prints it
    const r = normalizeUsj(
      doc([
        { type: 'chapter', marker: 'c', number: '16' },
        { type: 'para', marker: 'p', content: [{ type: 'verse', marker: 'v', number: '9' }, '¶ Now when Jesus was risen'] },
      ]),
    );
    expect(r.verses).toEqual([{ chapter: 16, verse: 9, lastVerse: 9, segment: '', text: 'Now when Jesus was risen' }]);
    // the token stream is the document's: the mark stays, and no word index moves
    expect(r.tokens.map((t) => [t.text, t.kind, t.wordIndex]).slice(0, 3)).toEqual([
      ['¶', 'punct', null], ['Now', 'word', 0], ['when', 'word', 1],
    ]);
  });

  it('counts bridged verses; the tokens carry the first number and the unit the range', () => {
    const r = normalizeUsj(
      doc([
        { type: 'chapter', marker: 'c', number: '1' },
        {
          type: 'para',
          marker: 'p',
          content: [{ type: 'verse', marker: 'v', number: '17-18' }, 'bridged'],
        },
      ]),
    );
    expect(r.stats.verseBridges).toBe(1);
    expect(r.tokens[0].verse).toBe(17);
    expect(r.verses).toEqual([{ chapter: 1, verse: 17, lastVerse: 18, segment: '', text: 'bridged' }]);
  });

  describe('each unit has one number or one unbroken range, rising within its chapter (ADR-0004 v1.5 rule 6a)', () => {
    const chapter = (...numbers: string[]) =>
      doc([
        { type: 'chapter', marker: 'c', number: '1' },
        { type: 'para', marker: 'p', content: numbers.flatMap((n) => [{ type: 'verse', marker: 'v', number: n }, 'word ']) },
      ]);

    it('accepts single verses, ranges and lettered segments in rising order', () => {
      expect(normalizeUsj(chapter('1', '2-4', '5', '5a', '5b', '6-7')).verses.map((v) => [v.verse, v.lastVerse, v.segment])).toEqual([
        [1, 1, ''], [2, 4, ''], [5, 5, ''], [5, 5, 'a'], [5, 5, 'b'], [6, 7, ''],
      ]);
    });

    it('stops on a range that falls or holds one number', () => {
      expect(() => normalizeUsj(chapter('6-5'))).toThrow(/range/);
      expect(() => normalizeUsj(chapter('5-5'))).toThrow(/range/);
    });

    it('stops on a lettered range', () => {
      expect(() => normalizeUsj(chapter('3a-4'))).toThrow(/verse number/);
      expect(() => normalizeUsj(chapter('3-4a'))).toThrow(/verse number/);
    });

    it('stops on a unit that overlaps or does not rise', () => {
      expect(() => normalizeUsj(chapter('4-6', '5'))).toThrow(/does not rise/);
      expect(() => normalizeUsj(chapter('4', '3'))).toThrow(/does not rise/);
      expect(() => normalizeUsj(chapter('4', '4'))).toThrow(/does not rise/);
      expect(() => normalizeUsj(chapter('4a', '4'))).toThrow(/does not rise/);
      expect(() => normalizeUsj(chapter('4-5', '5a'))).toThrow(/does not rise/);
    });

    it('starts again in each chapter', () => {
      const two = doc([
        { type: 'chapter', marker: 'c', number: '1' },
        { type: 'para', marker: 'p', content: [{ type: 'verse', marker: 'v', number: '5' }, 'a'] },
        { type: 'chapter', marker: 'c', number: '2' },
        { type: 'para', marker: 'p', content: [{ type: 'verse', marker: 'v', number: '1' }, 'b'] },
      ]);
      expect(normalizeUsj(two).verses.map((v) => [v.chapter, v.verse])).toEqual([[1, 5], [2, 1]]);
    });
  });
});

describe('chapter and verse keys (PR #6 review)', () => {
  const doc = (content: UsjDoc['content']): UsjDoc => ({ type: 'USJ', version: '3.1', content });
  const c = (number: string) => ({ type: 'chapter', marker: 'c', number });
  const v = (number: string) => ({ type: 'verse', marker: 'v', number });

  it('rejects a chapter with no number, chapter 0, and a chapter printed twice', () => {
    expect(() => splitChapters(doc([c('')]))).toThrow(/unparseable chapter number ""/);
    expect(() => splitChapters(doc([c('0')]))).toThrow(/unparseable chapter number "0"/);
    expect(() => splitChapters(doc([c('5'), c('5')]))).toThrow(/chapter 5 printed twice/);
  });

  it('names a verse printed twice instead of failing on the database key', () => {
    expect(() =>
      normalizeUsj(doc([c('1'), { type: 'para', marker: 'p', content: [v('5'), 'one', v('5'), 'two'] }])),
    ).toThrow(/chapter 1: verse 5 does not rise after 5/);
  });

  it('a title in two \\d paragraphs is one verse 0, and its word indexes run on', () => {
    const r = normalizeUsj(
      doc([
        c('3'),
        { type: 'para', marker: 'd', content: ['A Psalm of David,'] },
        { type: 'para', marker: 'd', content: ['when he fled.'] },
        { type: 'para', marker: 'q1', content: [v('1'), 'LORD, how many'] },
      ]),
      { titleChapters: new Set([3]) },
    );
    expect(r.verses.filter((x) => x.verse === 0)).toEqual([
      { chapter: 3, verse: 0, lastVerse: 0, segment: '', text: 'A Psalm of David, when he fled.' },
    ]);
    expect(r.tokens.filter((t) => t.verse === 0 && t.kind === 'word').map((t) => t.wordIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('drops an empty verse marker the scheme lacks, and lists it, in the same derivation', () => {
    const content = [
      c('16'),
      { type: 'para', marker: 'p', content: [v('24'), 'Amen.', v('25'), { type: 'note', marker: 'f', content: ['TR puts 16:25-27 here.'] }] },
    ];
    const r = normalizeUsj(doc(content), { hasVerse: (_ch, verse) => verse <= 24 });
    expect(r.verses.map((x) => x.verse)).toEqual([24]);
    expect(r.droppedVerses).toEqual([{ chapter: 16, verse: 25 }]);
    // without the scheme, every marker keeps its row
    expect(normalizeUsj(doc(content)).verses.map((x) => x.verse)).toEqual([24, 25]);
  });

  it('cuts an empty bridge back to the numbers its scheme has', () => {
    const bridge = (n: string) => [c('16'), { type: 'para', marker: 'p', content: [v('24'), 'Amen.', v(n), { type: 'note', marker: 'f', content: ['f'] }] }];
    const cut = normalizeUsj(doc(bridge('25-27')), { hasVerse: (_ch, verse) => verse <= 26 });
    expect(cut.verses.map((x) => [x.verse, x.lastVerse])).toEqual([[24, 24], [25, 26]]);
    expect(cut.droppedVerses).toEqual([{ chapter: 16, verse: 27 }]);
    // every number outside: the unit goes, and each number is reported
    const gone = normalizeUsj(doc(bridge('25-27')), { hasVerse: (_ch, verse) => verse <= 24 });
    expect(gone.verses.map((x) => x.verse)).toEqual([24]);
    expect(gone.droppedVerses.map((x) => x.verse)).toEqual([25, 26, 27]);
  });

  it('counts published and alternate chapter numbers', () => {
    const r = normalizeUsj(doc([{ ...c('1'), pubnumber: 'A' }, { type: 'para', marker: 'p', content: [v('1'), 'x'] }]));
    expect(r.stats.altChapterNumbers).toBe(1);
  });
});

describe('the genre of every supported block marker (ADR-0001 table)', () => {
  const genres = {
    heading: ['mt', 'mt1', 'mt2', 'ms', 'ms1', 's', 's1', 's2', 's4', 'is', 'is1', 'd', 'qa', 'sp'],
    prose: ['p', 'm', 'nb', 'mi', 'pc', 'pmo', 'pi', 'pi1', 'pi2', 'li', 'li1', 'li2', 'ip'],
    poetry: ['q', 'q1', 'q2', 'q3', 'q4', 'qr'],
  } as const;
  for (const [genre, markers] of Object.entries(genres)) {
    it(`${genre}: ${markers.join(' ')}`, () => {
      for (const m of markers) expect(blockGenre(m), m).toBe(genre);
    });
  }
  it('no genre for unsupported or out-of-range markers', () => {
    for (const m of ['s5', 'q5', 'ipi', 'im', 'rem', 'cd', 'b']) expect(blockGenre(m), m).toBeNull();
  });
});

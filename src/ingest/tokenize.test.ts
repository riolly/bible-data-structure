import { describe, expect, it } from 'vitest';

import { tokenize, verseWords } from './tokenize';

/**
 * ADVERSARIAL policy tests (ADR-0004). These pin the REGISTERED tokenization
 * rules — the meaning of every anchor word_index. A failure here is not a
 * broken test to update: it is an ANCHOR MIGRATION to stop and think about.
 */
describe('registered tokenization policy (ADR-0004)', () => {
  const words = (s: string) => tokenize(s).filter((t) => t.kind === 'word').map((t) => t.text);
  const texts = (s: string) => tokenize(s).map((t) => `${t.kind === 'word' ? 'w' : 'p'}:${t.text}`);

  it('possessives are ONE word', () => {
    expect(texts("the LORD's hand")).toEqual(['w:the', "w:LORD's", 'w:hand']);
    expect(texts('the LORD’s hand')).toEqual(['w:the', 'w:LORD’s', 'w:hand']);
  });

  it('hyphenated compounds are ONE word', () => {
    expect(texts('his father-in-law said')).toEqual(['w:his', 'w:father-in-law', 'w:said']);
  });

  it('a trailing bare apostrophe (plural possessive) is PUNCT', () => {
    expect(texts('the disciples’ feet')).toEqual(['w:the', 'w:disciples', 'p:’', 'w:feet']);
  });

  it('a leading elision apostrophe is PUNCT; the elided body is the word', () => {
    expect(texts('’Twas so')).toEqual(['p:’', 'w:Twas', 'w:so']);
  });

  it('grouped numbers are ONE word; ordinals too', () => {
    expect(texts('all 144,000 stood')).toEqual(['w:all', 'w:144,000', 'w:stood']);
    expect(words('the 40th year')).toEqual(['the', '40th', 'year']);
    expect(words('about 3.5 measures')).toEqual(['about', '3.5', 'measures']);
    expect(words('Saul killed 1,000')).toEqual(['Saul', 'killed', '1,000']);
  });

  it('mixed punctuation runs collapse into a SINGLE punct token', () => {
    expect(texts('said, “Behold!”')).toEqual(['w:said', 'p:,', 'p:“', 'w:Behold', 'p:!”']);
    expect(texts('riverside—watching.')).toEqual(['w:riverside', 'p:—', 'w:watching', 'p:.']);
  });

  it('whitespace is NEVER a token', () => {
    for (const t of tokenize('  In \t the\n beginning  ')) {
      expect(t.text).not.toMatch(/\s/);
      expect(t.text.length).toBeGreaterThan(0);
    }
    expect(tokenize('   \n\t ')).toEqual([]);
  });

  it('a word must begin and end alphanumeric', () => {
    // no leading/trailing separators ever leak into a word token
    for (const s of ["'round", 'end-', "o'", '-dash', 'Beth-el’s']) {
      for (const t of tokenize(s)) {
        if (t.kind === 'word') expect(t.text).toMatch(/^[\p{L}\p{N}].*[\p{L}\p{N}]$|^[\p{L}\p{N}]$/u);
      }
    }
    expect(texts('Beth-el’s altar')).toEqual(['w:Beth-el’s', 'w:altar']);
  });

  it('combining marks bind to their base word, never split off as punct (ADR-0004 v1.1)', () => {
    // Greek polytonic (NFC-composed by ingest before this runs) — precomposed,
    // one word regardless.
    expect(texts('ἐν ἀρχῇ ἦν'.normalize('NFC'))).toEqual(['w:ἐν', 'w:ἀρχῇ', 'w:ἦν']);
    // A raw base + combining mark (tokenize itself does NOT normalize) stays
    // ONE word — proves the mark binds rather than splitting into punct.
    const raw = 'a\u0300b'; // a + combining grave + b
    expect(tokenize(raw)).toEqual([{ kind: 'word', text: raw }]);
    // Hebrew vowel points (category M, no canonical composition) — the whole
    // pointed word is ONE token, points intact.
    const heb = 'בְּרֵאשִׁית'.normalize('NFC');
    expect(tokenize(heb)).toEqual([{ kind: 'word', text: heb }]);
    expect(texts(`${heb} בָּרָא`.normalize('NFC'))).toEqual([`w:${heb}`, 'w:בָּרָא'.normalize('NFC')]);
  });

  it('an ORPHAN combining mark (no base before it) falls to punct, never vanishes', () => {
    // A mark with no preceding base matches neither the word branch (needs an
    // alphanumeric start) nor a space — it must land as punct so the token
    // stream still COVERS every non-space character (no silent, uncounted drop).
    expect(tokenize('́abc')).toEqual([
      { kind: 'punct', text: '́' }, // leading mark
      { kind: 'word', text: 'abc' },
    ]);
    expect(tokenize('.́x')).toEqual([
      { kind: 'punct', text: '.́' }, // mark after punct joins the punct run
      { kind: 'word', text: 'x' },
    ]);
    expect(tokenize('ְְ')).toEqual([{ kind: 'punct', text: 'ְְ' }]); // lone marks
    // coverage: concatenated token text == input minus whitespace
    for (const s of ['́abc', '.́x', 'word ְhere', 'àb']) {
      const covered = tokenize(s)
        .map((t) => t.text)
        .join('');
      expect(covered).toBe(s.replace(/\s+/g, ''));
    }
  });

  // ADR-0004 v1.2: WLC and SBLGNT go through the same rules. Text from the
  // pinned sources (WLC GEN 1, SBLGNT ROM 14-16, MRK 16, JHN 7).
  it('Hebrew: maqaf, sof pasuq and paseq are punct; points and accents stay in the word (v1.2)', () => {
    expect(texts('וַיִּקְרָ֨א אֱלֹהִ֤ים ׀ לָאוֹר֙')).toEqual(['w:וַיִּקְרָ֨א', 'w:אֱלֹהִ֤ים', 'p:׀', 'w:לָאוֹר֙']);
    expect(texts('וַֽיְהִי־ עֶ֥רֶב')).toEqual(['w:וַֽיְהִי', 'p:־', 'w:עֶ֥רֶב']);
    // a maqaf inside one OSHB \w still splits: a word index is not an OSHB word number
    expect(texts('זַרְעוֹ־ב֖וֹ')).toEqual(['w:זַרְעוֹ', 'p:־', 'w:ב֖וֹ']);
    // without the verse-text option (headings), a standalone פ is a word
    expect(texts('אֶחָֽד׃ פ')).toEqual(['w:אֶחָֽד', 'p:׃', 'w:פ']);
  });

  it('Hebrew: in verse text a standalone פ or ס is a paragraph mark, punct (v1.3)', () => {
    const verse = (s: string) => tokenize(s, { paragraphMarks: true }).map((t) => `${t.kind[0]}:${t.text}`);
    expect(verse('אֶחָֽד׃ פ')).toEqual(['w:אֶחָֽד', 'p:׃', 'p:פ']);
    // GEN 35:22: the mark sits mid-verse, so the words after it keep their index
    expect(verse('יִשְׂרָאֵ֑ל פ וַיִּֽהְי֥וּ')).toEqual(['w:יִשְׂרָאֵ֑ל', 'p:פ', 'w:וַיִּֽהְי֥וּ']);
    expect(verse('עָשָֽׂר׃ ס')).toEqual(['w:עָשָֽׂר', 'p:׃', 'p:ס']);
    // the letters inside a word, or pointed, stay words
    expect(verse('פֶּה סֵ֖פֶר')).toEqual(['w:פֶּה', 'w:סֵ֖פֶר']);
    expect(verse('ס SAMECH')).toEqual(['p:ס', 'w:SAMECH']);
  });

  it('Greek: elision with ʼ (a letter) stays in the word, with ’ it is punct (v1.2)', () => {
    expect(texts('κατʼ ἐπιταγὴν')).toEqual(['w:κατʼ', 'w:ἐπιταγὴν']);
    expect(texts('δι’ αὐτοῦ')).toEqual(['w:δι', 'p:’', 'w:αὐτοῦ']);
  });

  it('Greek: ano teleia, question mark and critical signs are punct (v1.2)', () => {
    expect(texts('ἐσθίοντι· πάντα')).toEqual(['w:ἐσθίοντι', 'p:·', 'w:πάντα']);
    expect(texts('ἐστίν\u037E'.normalize('NFC'))).toEqual(['w:ἐστίν', 'p:;']);
    expect(texts('καὶ ⸂ὅλης ἐκκλησίας⸃.')).toEqual(['w:καὶ', 'p:⸂', 'w:ὅλης', 'w:ἐκκλησίας', 'p:⸃.']);
    expect(texts('⟦ καὶ ἐπορεύθη')).toEqual(['p:⟦', 'w:καὶ', 'w:ἐπορεύθη']);
  });
});

describe('verseWords (ADR-0004, step 13 amendment)', () => {
  it("gives a verse text's words in word order, with a paragraph mark as punctuation", () => {
    expect(verseWords('the LORD’s house, father-in-law; 144,000.')).toEqual(['the', 'LORD’s', 'house', 'father-in-law', '144,000']);
    expect(verseWords('וַיִּשְׁמַע יִשְׂרָאֵל פ וַיִּהְיוּ')).toEqual(['וַיִּשְׁמַע', 'יִשְׂרָאֵל', 'וַיִּהְיוּ']);
  });
});

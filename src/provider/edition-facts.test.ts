import { describe, expect, it } from 'vitest';

import { LICENSED_EDITIONS } from '../contract/rights';
import type { ApiBibleNode } from './api-bible';
import { editionFacts, factsText } from './edition-facts';

const text = (s: string): ApiBibleNode => ({ type: 'text', text: s });
const tag = (name: string, attrs: Record<string, string>, items: ApiBibleNode[] = []): ApiBibleNode => ({ type: 'tag', name, attrs, items });
const chapter = (n: number) => tag('chapter', { number: String(n), style: 'c' });
const verse = (n: string) => tag('verse', { number: n, style: 'v' });
const para = (style: string, items: ApiBibleNode[]) => tag('para', { style }, items);

/** A TVTMS row whose word test names NUM 1:21 and PSA 3:1, and whose title test names PSA 3. */
const tvtms = [
  { tests: 'Num.1:21>Psa.3:1 & Psa.3:TextBeforeV1=Exist' },
] as unknown as Parameters<typeof editionFacts>[3];
const meta = { edition: 'T', bibleId: 'x', fetched: '2026-11-12', tvtms: 'sha' };

describe('editionFacts: counts, never text', () => {
  // Numbers 1 arrives in two passages, the second starting mid-paragraph at verse 22.
  const num = [
    chapter(1),
    para('p', [verse('1'), text('One two.'), verse('20-21'), text('Three four five six.')]),
    para('p', [verse('22'), text('Seven.'), verse('24'), text('Eight.')]),
    chapter(2),
    para('p', [verse('1'), text('Nine.')]),
  ];
  const psa = [
    chapter(1),
    para('q1', [verse('1'), text('Zero.')]),
    chapter(2),
    para('ms', [text('BOOK 1')]),
    para('ms', [text('PSALM 2')]),
    para('q1', [verse('1'), text('Zero.')]),
    chapter(3),
    para('ms', [text('PSALM 3')]),
    para('s', [text('An editor heading')]),
    para('ms', [text('A Psalm of David.')]),
    para('q1', [verse('1'), text('Ten eleven.')]),
  ];
  const books = [
    { book: 'NUM', content: num },
    { book: 'PSA', content: psa },
  ];

  it('gives each chapter its last verse, bridges and numbers no unit holds', () => {
    const facts = editionFacts(meta, undefined, books, tvtms);
    expect(facts.lastVerses).toEqual({ NUM: [24, 1], PSA: [1, 1, 1] });
    expect(facts.bridges).toEqual(['NUM 1:20-21']);
    expect(facts.missing).toEqual(['NUM 1:2', 'NUM 1:3', 'NUM 1:4', 'NUM 1:5', 'NUM 1:6', 'NUM 1:7', 'NUM 1:8', 'NUM 1:9', 'NUM 1:10', 'NUM 1:11', 'NUM 1:12', 'NUM 1:13', 'NUM 1:14', 'NUM 1:15', 'NUM 1:16', 'NUM 1:17', 'NUM 1:18', 'NUM 1:19', 'NUM 1:23']);
    expect(facts.parts).toEqual([]);
    expect(JSON.stringify(facts)).not.toMatch(/Three|Psalm of David/);
  });

  it("keeps only the tested verses' word counts, with a bridge's count under its later number", () => {
    const facts = editionFacts(meta, undefined, books, tvtms);
    expect(facts.words).toEqual({ 'NUM 1:21': 4, 'PSA 3:1': 2 });
    expect(factsText(facts).words.get('NUM 1:21')).toBe(4);
    expect([...factsText(facts).unitOf!]).toEqual([['NUM 1:21', 'NUM 1:20']]);
  });

  it("finds a title only by the edition's own test: NASB's \\ms under its PSALM line", () => {
    expect(editionFacts(meta, undefined, books, tvtms).titled).toEqual([]);
    const nasb = LICENSED_EDITIONS.get('NASB95')!.isTitle;
    expect(editionFacts(meta, nasb, books, tvtms).titled).toEqual(['PSA 3']);
  });
});

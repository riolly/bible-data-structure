/**
 * Upstream SBLGNT XML (github.com/LogosBible/SBLGNT, `data/sblgnt/xml`) to
 * USFM, so the text goes through the same parse and normalize steps as every
 * other edition. ebible.org's USFM copy lost words and punctuation where it
 * turned the apparatus marks into footnotes (research/licensing.md).
 *
 * The XML is a flat list per paragraph: `<verse-number id="Mark 1:1">`,
 * then `<prefix>`, `<w>` and `<suffix>` runs. Words and punctuation are kept
 * as they are; only the markup changes:
 *
 *   <title>        → \mt1
 *   <p>            → \p (an empty `<p />` is skipped)
 *   a new chapter  → \c, then \nb when the paragraph runs on across it
 *   <verse-number> → \v
 */

/** Upstream file name (without `.xml`) → USFM book code. */
export const SBLGNT_BOOKS: Readonly<Record<string, string>> = {
  Matt: 'MAT', Mark: 'MRK', Luke: 'LUK', John: 'JHN', Acts: 'ACT', Rom: 'ROM', '1Cor': '1CO', '2Cor': '2CO',
  Gal: 'GAL', Eph: 'EPH', Phil: 'PHP', Col: 'COL', '1Thess': '1TH', '2Thess': '2TH', '1Tim': '1TI', '2Tim': '2TI',
  Titus: 'TIT', Phlm: 'PHM', Heb: 'HEB', Jas: 'JAS', '1Pet': '1PE', '2Pet': '2PE', '1John': '1JN', '2John': '2JN',
  '3John': '3JN', Jude: 'JUD', Rev: 'REV',
};

const ELEMENT = /<(title|w|prefix|suffix)>([^<]*)<\/\1>|<verse-number id="[^"]*?(\d+):(\d+)">[^<]*<\/verse-number>|<(p|\/p|p \/|book [^>]*|\/book|\?xml[^>]*)>|(\S)/g;

const decode = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e]!);

export function sblgntXmlToUsfm(xml: string, code: string): string {
  const out: string[] = [`\\id ${code} SBL Greek New Testament, from the upstream XML`];
  let line = '';
  let chapter = 0;
  let paraOpen = false; // a <p> is open and has emitted its \p
  let pendingPara = false; // a <p> opened and has not emitted \p yet
  const flush = () => {
    if (line.trim()) out.push(line.trimEnd());
    line = '';
  };
  const startPara = () => {
    if (!pendingPara) return;
    flush();
    out.push('\\p');
    pendingPara = false;
    paraOpen = true;
  };
  for (const m of xml.replace(/^\uFEFF/, '').matchAll(ELEMENT)) {
    const [, name, text, c, v, tag, stray] = m;
    if (stray) throw new Error(`${code}: text outside an element near "${xml.slice(m.index, m.index + 40)}"`);
    if (name === 'title') {
      flush();
      out.push(`\\mt1 ${decode(text)}`);
    } else if (name) {
      startPara();
      line += decode(text) + (name === 'suffix' ? ' ' : ''); // every <w> has a <suffix>
    } else if (c) {
      if (Number(c) !== chapter) {
        chapter = Number(c);
        flush();
        out.push(`\\c ${chapter}`);
        if (paraOpen && !pendingPara) out.push('\\nb'); // the paragraph runs on into the new chapter
      }
      startPara();
      flush();
      line = `\\v ${Number(v)} `;
    } else if (tag === 'p') {
      pendingPara = true;
      paraOpen = false;
    } else if (tag === '/p') {
      paraOpen = false;
    }
  }
  flush();
  return out.join('\n') + '\n';
}

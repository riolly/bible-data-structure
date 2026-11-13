/**
 * Paratext `.vrs` versification files (ADR-0006), read the way libpalaso's
 * Versification.cs reads them (commit b4f7a6d, lines 603-1062). A file holds:
 *
 *     GEN 1:31 2:25 ...            verse counts, one line per book
 *     -GEN 31:51                   a verse the scheme leaves out
 *     *JOS 9:2,-,a,b               the segments a verse is divided into
 *     JOL 3:1-5 = JOL 2:28-32      a mapping: this scheme = org
 *     &ACT 19:40-41 = ACT 19:40    a mapping of a range onto one verse
 *     #! <any of the above>        a Paratext 7.3 line hidden in a comment
 *
 * Mapping lines may cross books, carry segments, and repeat a left side to map
 * one verse to several. Paratext reads a standard line's right side by its
 * start only and counts up from it; lines where the two sides differ in length
 * are read the same way and reported in `warnings`, never fixed.
 */

/** A verse or part of one, in one book. `segment` is `''` for the whole verse. */
export interface VrsRef {
  readonly book: string;
  readonly chapter: number;
  readonly verse: number;
  readonly segment: string;
}

/** One expanded mapping pair: `from` in the file's scheme, `to` in org. */
export interface VrsMapping {
  readonly from: VrsRef;
  readonly to: VrsRef;
  /** 1-based line number in the file. */
  readonly line: number;
}

export interface VrsFile extends VrsCounts {
  /** `BOOK C:V` → segment ids in order, `''` for the unmarked first part. */
  readonly segments: Map<string, string[]>;
  readonly mappings: VrsMapping[];
  readonly warnings: string[];
}

interface Side {
  readonly start: VrsRef;
  /** Last verse of a range in the same chapter; equals start.verse for one verse. */
  readonly endVerse: number;
  readonly isRange: boolean;
}

const SIDE_RE = /^([0-9A-Z]{3}) (\d+):(\d+)([a-z]?)(?:-(\d+)([a-z]?))?$/;

function parseSide(text: string, line: number): Side {
  const m = SIDE_RE.exec(text.trim());
  if (!m) throw new Error(`vrs: unreadable reference "${text.trim()}" (line ${line})`);
  const [, book, c, v, seg, end, endSeg] = m;
  if (end !== undefined && (seg !== '' || endSeg !== '')) {
    throw new Error(`vrs: a range with segments is not supported (line ${line})`);
  }
  const start = { book, chapter: Number(c), verse: Number(v), segment: seg };
  return { start, endVerse: end === undefined ? start.verse : Number(end), isRange: end !== undefined };
}

function expand(side: Side): VrsRef[] {
  const out: VrsRef[] = [];
  for (let v = side.start.verse; v <= side.endVerse; v++) out.push({ ...side.start, verse: v });
  return out.length > 0 ? out : [side.start];
}

/** Parse a whole `.vrs` file: counts, excluded verses, segments and mappings. */
export function parseVrs(text: string): VrsFile {
  const { verseCounts, excluded } = parseVrsCounts(text);
  const segments = new Map<string, string[]>();
  const mappings: VrsMapping[] = [];
  const warnings: string[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const line = vrsLine(lines[i]);
    if (line.startsWith('*')) {
      const m = /^\*([0-9A-Z]{3}) (\d+):(\d+),(.*)$/.exec(line.replace(/(:.*)/, (t) => t.replace(/\s+/g, '')));
      if (!m) throw new Error(`vrs: unreadable segment line ${n}: "${line}"`);
      segments.set(
        `${m[1]} ${Number(m[2])}:${Number(m[3])}`,
        m[4].split(',').filter((x) => x !== '').map((x) => (x === '-' ? '' : x)),
      );
      continue;
    }
    if (!line.includes('=')) continue;
    const manyToOne = line.startsWith('&');
    const parts = (manyToOne ? line.slice(1) : line).split('=');
    if (parts.length !== 2) throw new Error(`vrs: unreadable mapping line ${n}: "${line}"`);
    const left = parseSide(parts[0], n);
    const right = parseSide(parts[1], n);

    if (manyToOne) {
      const froms = expand(left);
      const tos = expand(right);
      if (froms.length !== 1 && tos.length !== 1) {
        throw new Error(`vrs: an & line must have one verse on one side (line ${n})`);
      }
      for (const from of froms) for (const to of tos) mappings.push({ from, to, line: n });
      continue;
    }

    const leftLen = left.endVerse - left.start.verse;
    if (leftLen < 0 || (right.isRange && right.endVerse - right.start.verse !== leftLen)) {
      warnings.push(`line ${n}: "${line}" has sides of different lengths; read by the right side's start, as Paratext does`);
    }
    let from = left.start;
    let to = right.start;
    for (;;) {
      mappings.push({ from, to, line: n });
      if (from.verse >= left.endVerse) break;
      from = { ...from, verse: from.verse + 1 };
      to = { ...to, verse: to.verse + 1 };
    }
  }
  return { verseCounts, excluded, segments, mappings, warnings };
}

/** The verse-count part of a `.vrs` file: count lines and `-` excluded-verse lines. */
export interface VrsCounts {
  /** Book code → last verse of chapter 1, 2, ... */
  readonly verseCounts: Map<string, number[]>;
  /** Excluded verses as `BOOK C:V`. */
  readonly excluded: Set<string>;
}

/**
 * Strip a comment, keeping a Paratext 7.3+ `#!` line as a real line, the way
 * libpalaso's Versification.ParseLine does.
 */
function vrsLine(raw: string): string {
  const line = raw.trim();
  if (line.startsWith('#!')) return line.slice(2).trim();
  return line.replace(/#.*$/, '').trim();
}

/**
 * Read only the lines that define a scheme's verses, following libpalaso's
 * ParseChapterVerseLine and ParseExcludedVerseLine:
 *
 *     GEN 1:31 2:25 ...   last verse per chapter; chapter numbers are explicit,
 *                         skipped chapters get 1 verse, `END` truncates, and a
 *                         repeated book line updates the earlier one
 *     -GEN 31:51          a verse inside the range the scheme leaves out
 *
 * Mapping (`=`) and segment (`*`) lines are skipped here.
 */
export function parseVrsCounts(text: string): VrsCounts {
  const verseCounts = new Map<string, number[]>();
  const excluded = new Set<string>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = vrsLine(lines[i]);
    if (line === '' || line.includes('=') || line.startsWith('*')) continue;
    const ex = /^-([0-9A-Z]{3}) (\d+):(\d+)$/.exec(line);
    if (ex) {
      const key = `${ex[1]} ${Number(ex[2])}:${Number(ex[3])}`;
      if (excluded.has(key)) throw new Error(`vrs: ${key} excluded twice (line ${i + 1})`);
      excluded.add(key);
      continue;
    }
    const [code, ...parts] = line.split(/\s+/);
    if (!/^[0-9A-Z]{3}$/.test(code)) throw new Error(`vrs: unreadable line ${i + 1}: "${line}"`);
    const counts = [...(verseCounts.get(code) ?? [])];
    let chapter = 0;
    for (const part of parts) {
      if (part === 'END') {
        counts.length = Math.min(counts.length, chapter);
        break;
      }
      const m = /^(\d+):(\d+)$/.exec(part);
      if (!m || Number(m[1]) < 1) throw new Error(`vrs: bad count "${part}" for ${code} (line ${i + 1})`);
      chapter = Number(m[1]);
      while (counts.length < chapter) counts.push(1);
      counts[chapter - 1] = Number(m[2]);
    }
    verseCounts.set(code, counts);
  }
  return { verseCounts, excluded };
}

/**
 * Parse standard `.vrs` versification mapping data → sparse `versification_map`
 * rows (ADR-0001). A `.vrs` mapping line reconciles a translation's NATIVE
 * numbering to the av11n CANONICAL numbering:
 *
 *     # comment
 *     JOL 3:1-5 = JOL 2:28-32      # native (left) = canonical (right)
 *     MAL 3:19-24 = MAL 4:1-6
 *     REV 12:18 = REV 13:1
 *
 * Each side is `CODE chapter:verse` or `CODE chapter:vStart-vEnd` (a verse range
 * within one chapter). Ranges expand to one row per verse and MUST be
 * equal-length on both sides. Book codes are USFM codes (ADR-0002).
 *
 * Only DIVERGENT lines appear in a `.vrs`; an av11n translation's file has none
 * (or no file), so its map is empty and every address is identity — which is the
 * whole point of the sparse table.
 */

import { BOOK_BY_CODE } from '../model/books';
import type { VersificationRow } from '../model/versification';

interface Ref {
  readonly code: string;
  readonly chapter: number;
  readonly verses: readonly number[]; // one or more (expanded range), in order
}

/** Parse one `CODE C:V` or `CODE C:Va-Vb` side. */
function parseRef(text: string, line: number): Ref {
  const m = text.trim().match(/^([0-9A-Z]{3})\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!m) throw new Error(`vrs: unparseable reference "${text}" (line ${line})`);
  const [, code, chapterStr, startStr, endStr] = m;
  if (!BOOK_BY_CODE.has(code)) throw new Error(`vrs: unknown book code "${code}" (line ${line})`);
  const chapter = parseInt(chapterStr, 10);
  const start = parseInt(startStr, 10);
  const end = endStr ? parseInt(endStr, 10) : start;
  if (end < start) throw new Error(`vrs: descending verse range "${text}" (line ${line})`);
  const verses: number[] = [];
  for (let v = start; v <= end; v++) verses.push(v);
  return { code, chapter, verses };
}

/**
 * Parse `.vrs` mapping text → sparse rows. Non-mapping content (comments, blank
 * lines, and any leading non-mapping directives) is ignored; a malformed mapping
 * line throws so a bad file fails the build, not the reader.
 */
export function parseVrs(text: string): VersificationRow[] {
  const rows: VersificationRow[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/#.*$/, '').trim(); // strip trailing comment
    if (raw === '') continue;
    if (!raw.includes('=')) continue; // not a mapping line (a scheme directive, etc.)
    const [srcText, canonText, ...extra] = raw.split('=');
    if (extra.length > 0) throw new Error(`vrs: multiple "=" on line ${i + 1}`);
    const src = parseRef(srcText, i + 1);
    const canon = parseRef(canonText, i + 1);
    if (src.verses.length !== canon.verses.length) {
      throw new Error(`vrs: mismatched range lengths on line ${i + 1} ("${raw}")`);
    }
    if (src.code !== canon.code) {
      // A row is book-scoped; cross-book renumbering is not modelled in P1.
      throw new Error(`vrs: cross-book mapping ${src.code}→${canon.code} on line ${i + 1}`);
    }
    for (let k = 0; k < src.verses.length; k++) {
      rows.push({
        book: src.code,
        srcChapter: src.chapter,
        srcVerse: src.verses[k],
        canonChapter: canon.chapter,
        canonVerse: canon.verses[k],
      });
    }
  }
  return rows;
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
export function vrsLine(raw: string): string {
  const line = raw.trim();
  if (line.startsWith('#!')) return line.slice(2).trim();
  return line.replace(/#.*$/, '').trim();
}

/**
 * Read the lines that define a scheme, following libpalaso's
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

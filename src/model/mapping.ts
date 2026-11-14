/**
 * Scheme mappings through the pivot (ADR-0006).
 *
 * A mapping row moves a verse (or part of one) in a real scheme to a verse
 * (or part of one) in the pivot. Rows may be many-to-many, cross chapters and
 * books, and mark a verse `absent` (`to: null`) where the pivot has no
 * counterpart. The table is sparse: a verse with no row maps to the same
 * reference in the pivot. Where an edition prints a verse as an unlettered
 * first part and lettered parts (Brenton's 1KI 2:35, then 35a to 35o), the
 * address without a letter names the unlettered part alone, and each part
 * maps by its own row or keeps its number (#69). A part letter no row uses
 * follows its whole verse when rows divide that verse into other parts (#71).
 *
 * Moving an address from scheme A to scheme B goes A → pivot → B. There is no
 * one-to-one or bijection requirement; a lookup returns a list.
 *
 * No Node-only import here.
 */

import type { Scheme } from './scheme';
import { hasVerse } from './scheme';

/** The synthetic, extend-only pivot scheme's id. Stored addresses never use it. */
export const PIVOT = 'pivot';

/** A verse or part of one. `segment` is `''` for the whole verse. */
export interface Ref {
  readonly book: string;
  readonly chapter: number;
  readonly verse: number;
  readonly segment: string;
}

export interface MappingRow {
  readonly scheme: string;
  readonly from: Ref;
  /** `null` marks the verse absent from the pivot. */
  readonly to: Ref | null;
  /** How the verse moves: a TVTMS action, or how a `.vrs` line read. */
  readonly kind: string;
  /** Which witness the row came from (ADR-0006): `tvtms` or `vrs`. */
  readonly source?: 'tvtms' | 'vrs';
}

/** A reference from its parts, with no segment unless one is given. */
export const ref = (book: string, chapter: number, verse: number, segment = ''): Ref => ({ book, chapter, verse, segment });

/**
 * A unique string for a reference. A one-letter segment is appended as in an
 * address (`REV 13:1a`); a longer pivot subverse id is set off by `!`
 * (`2ES 7:35!aa`), so no segment can read as more verse digits.
 */
export const refKey = (r: Ref): string =>
  `${r.book} ${r.chapter}:${r.verse}${/^[a-z]?$/.test(r.segment) ? r.segment : `!${r.segment}`}`;

/** The inverse of `refKey`. */
export function parseRefKey(key: string): Ref {
  const m = /^(\S+) (\d+):(\d+)(?:([a-z])|!([a-z0-9]+))?$/.exec(key);
  if (!m) throw new Error(`not a reference key: "${key}"`);
  return { book: m[1], chapter: Number(m[2]), verse: Number(m[3]), segment: m[4] ?? m[5] ?? '' };
}
const verseOf = (r: Ref): string => `${r.book} ${r.chapter}:${r.verse}`;
const whole = (r: Ref): Ref => ({ ...r, segment: '' });

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

function dedupe(refs: Ref[]): Ref[] {
  const seen = new Set<string>();
  return refs.filter((r) => !seen.has(refKey(r)) && seen.add(refKey(r)));
}

/**
 * Drops a whole verse when one of its own parts is also in the list. TVTMS
 * often gives both a whole-verse row (`Concatenation`) and per-part rows for
 * the same verse, and the part is the precise answer.
 */
function dropCoveredWholes(refs: Ref[]): Ref[] {
  const split = new Set(refs.filter((r) => r.segment !== '').map(verseOf));
  return refs.filter((r) => r.segment !== '' || !split.has(verseOf(r)));
}

/**
 * `BOOK C:V` of the verses a scheme prints as an unlettered first part and
 * then lettered parts: its segment list has `''` beside letters.
 */
export function unletteredFirstParts(s: Scheme): Set<string> {
  const out = new Set<string>();
  for (const [k, segs] of s.segments) if (segs.length > 1 && segs.includes('')) out.add(k);
  return out;
}

/**
 * One direction-agnostic relation from a scheme's references to another
 * scheme's, with identity wherever no row speaks.
 *
 * `firstParts` holds the `from` side's verses printed as an unlettered first
 * part and lettered parts (`unletteredFirstParts`). There a row at the whole
 * verse is the first part's row (TVTMS `!0`, Brenton ESG 3:13 to Hebrew
 * EST 3:13), and without one the first part keeps its number. The lettered
 * parts are sibling units: they don't follow the first part, and it doesn't
 * go where they go.
 */
export class Relation {
  private readonly byFrom = new Map<string, (Ref | null)[]>();
  /** `BOOK C:V` → from-keys of rows whose `from` is that verse or a part of it. */
  private readonly fromParts = new Map<string, string[]>();
  private readonly byTo = new Map<string, Ref[]>();
  /** `BOOK C:V` → to-keys of rows whose `to` is that verse or a part of it. */
  private readonly toParts = new Map<string, string[]>();

  constructor(
    rows: readonly { from: Ref; to: Ref | null }[],
    private readonly firstParts: ReadonlySet<string> = new Set(),
  ) {
    for (const { from, to } of rows) {
      const fk = refKey(from);
      if (!this.byFrom.has(fk)) push(this.fromParts, verseOf(from), fk);
      push(this.byFrom, fk, to);
      if (to) {
        const tk = refKey(to);
        if (!this.byTo.has(tk)) push(this.toParts, verseOf(to), tk);
        push(this.byTo, tk, from);
      }
    }
  }

  /** The row at a part's whole verse, unless that row is an unlettered first part's. */
  private wholeRow(r: Ref): (Ref | null)[] | undefined {
    return this.firstParts.has(verseOf(r)) ? undefined : this.byFrom.get(refKey(whole(r)));
  }

  /**
   * Whether any row starts at this reference, its whole verse or one of its
   * parts. An unlettered first part speaks only through its own row (#69).
   */
  private speaksFor(r: Ref): boolean {
    if (this.byFrom.has(refKey(r))) return true;
    if (this.firstParts.has(verseOf(r))) return false;
    return this.wholeRow(r) !== undefined || (r.segment === '' && this.fromParts.has(verseOf(r)));
  }

  /**
   * Whether a part has no row of its own or at its whole verse while rows
   * divide its verse into other parts (#71). It then follows the whole verse.
   * The lettered parts of a verse printed with an unlettered first part are
   * units beside it, so they never follow it (#69).
   */
  followsWhole(r: Ref): boolean {
    return r.segment !== '' && !this.firstParts.has(verseOf(r)) && !this.byFrom.has(refKey(r)) &&
      this.wholeRow(r) === undefined && this.fromParts.has(verseOf(r));
  }

  /**
   * Where `r` goes. Empty means absent. A whole verse goes wherever its own
   * rows and its parts' rows send it. An unlettered first part goes where its
   * own row sends it, or keeps its number: its lettered parts are other units
   * (#69). A part with no row of its own takes the row at its whole verse, or
   * follows the whole verse when other parts have rows, or keeps its number.
   */
  forward(r: Ref): Ref[] {
    const real = (list: (Ref | null)[]) => list.filter((t): t is Ref => t !== null);
    if (r.segment !== '') {
      const own = this.byFrom.get(refKey(r)) ?? this.wholeRow(r);
      if (own) return dedupe(real(own));
      return this.followsWhole(r) ? this.forward(whole(r)) : [r];
    }
    if (this.firstParts.has(verseOf(r))) {
      const own = this.byFrom.get(refKey(r));
      return own ? dedupe(real(own)) : [r];
    }
    const keys = this.fromParts.get(verseOf(r));
    if (!keys) return [r];
    return dedupe(real(keys.flatMap((k) => this.byFrom.get(k)!)));
  }

  /**
   * What comes to `r`: the sources of rows landing on it (or on its whole verse,
   * or on its parts), plus `r` itself when no row moves it away and
   * `exists(r)` holds in the source scheme.
   */
  backward(r: Ref, exists: (r: Ref) => boolean): Ref[] {
    const out: Ref[] = [...(this.byTo.get(refKey(r)) ?? [])];
    if (r.segment !== '') out.push(...(this.byTo.get(refKey(whole(r))) ?? []));
    else for (const k of this.toParts.get(verseOf(r)) ?? []) if (k !== refKey(r)) out.push(...this.byTo.get(k)!);
    if (this.speaksFor(r) || !exists(r)) return dropCoveredWholes(dedupe(out));
    // an unlettered first part is a unit of its own, which its lettered parts don't cover (#69)
    if (r.segment === '' && this.firstParts.has(verseOf(r))) return dedupe([...dropCoveredWholes(dedupe(out)), r]);
    return dropCoveredWholes(dedupe([...out, r]));
  }
}

/**
 * Whether a reference exists in a scheme. Verse 0 exists where the scheme has
 * a title. Any segment of an existing verse exists, except in the pivot, whose
 * segments are listed.
 */
export function refExists(s: Scheme, r: Ref): boolean {
  if (r.verse === 0) return r.segment === '' && s.titles.has(`${r.book} ${r.chapter}`);
  if (!hasVerse(s, r.book, r.chapter, r.verse)) return false;
  if (r.segment === '') return true;
  const segs = s.segments.get(`${r.book} ${r.chapter}:${r.verse}`);
  return segs === undefined ? s.id !== PIVOT : segs.includes(r.segment);
}

/** All mappings, indexed per scheme. */
export class Mappings {
  private readonly relations = new Map<string, Relation>();

  constructor(
    rows: readonly MappingRow[],
    private readonly schemes: ReadonlyMap<string, Scheme>,
  ) {
    const byScheme = new Map<string, MappingRow[]>();
    for (const r of rows) push(byScheme, r.scheme, r);
    for (const [id, s] of schemes) this.relations.set(id, new Relation(byScheme.get(id) ?? [], unletteredFirstParts(s)));
  }

  /** Whether the pivot divides `t`'s verse into parts and none has `t`'s letter. */
  private pivotLacksPart(t: Ref): boolean {
    const segs = t.segment === '' ? undefined : this.schemes.get(PIVOT)?.segments.get(verseOf(t));
    return segs !== undefined && !segs.includes(t.segment);
  }

  private scheme(id: string): Scheme {
    const s = this.schemes.get(id);
    if (!s) throw new Error(`unknown scheme "${id}"`);
    return s;
  }

  /** Where `r` goes in the pivot. A part letter the pivot doesn't divide its verse into follows the whole verse (#71). */
  toPivot(scheme: string, r: Ref): Ref[] {
    this.scheme(scheme);
    return dedupe(this.relations.get(scheme)!.forward(r).map((t) => (this.pivotLacksPart(t) ? whole(t) : t)));
  }

  /**
   * Whether `r` is a part with no counterpart of its own, so it goes where its
   * whole verse goes and holds only some of each target (#71): no row has its
   * letter while rows or the pivot divide its verse into other parts.
   */
  followsWhole(scheme: string, r: Ref): boolean {
    this.scheme(scheme);
    const rel = this.relations.get(scheme)!;
    return rel.followsWhole(r) || (r.segment !== '' && rel.forward(r).some((t) => this.pivotLacksPart(t)));
  }

  fromPivot(scheme: string, r: Ref): Ref[] {
    const s = this.scheme(scheme);
    return this.relations.get(scheme)!.backward(r, (x) => refExists(s, x));
  }

  /** Move a reference from one scheme to another through the pivot. */
  map(from: string, to: string, r: Ref): Ref[] {
    return dedupe(this.toPivot(from, r).flatMap((p) => this.fromPivot(to, p)));
  }
}

/**
 * The ADR-0006 replacement for the bijection check: every verse in a scheme's
 * count table maps to references the pivot has, or is marked absent. Returns
 * the problems.
 */
export function checkCoverage(scheme: Scheme, pivot: Scheme, rows: readonly MappingRow[]): string[] {
  const own = rows.filter((r) => r.scheme === scheme.id);
  const rel = new Relation(own, unletteredFirstParts(scheme));
  // A verse counts as marked absent when every row starting in it is absent.
  const rowsOfVerse = new Map<string, MappingRow[]>();
  for (const r of own) push(rowsOfVerse, verseOf(r.from), r);
  const allAbsent = (ref: Ref) => rowsOfVerse.get(verseOf(ref))?.every((r) => r.to === null) ?? false;
  const problems: string[] = [];
  for (const [book, counts] of scheme.verseCounts) {
    counts.forEach((last, i) => {
      for (let v = 1; v <= last; v++) {
        if (!hasVerse(scheme, book, i + 1, v)) continue;
        const ref = { book, chapter: i + 1, verse: v, segment: '' };
        const targets = rel.forward(ref);
        if (targets.length === 0 && !allAbsent(ref)) problems.push(`${refKey(ref)} maps nowhere`);
        for (const t of targets) {
          if (!refExists(pivot, t)) problems.push(`${refKey(ref)} maps to ${refKey(t)}, which the pivot lacks`);
        }
      }
    });
  }
  return problems;
}

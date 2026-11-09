/**
 * Scheme mappings through the pivot (ADR-0006).
 *
 * A mapping row moves a verse (or part of one) in a real scheme to a verse
 * (or part of one) in the pivot. Rows may be many-to-many, cross chapters and
 * books, and mark a verse `absent` (`to: null`) where the pivot has no
 * counterpart. The table is sparse: a verse with no row maps to the same
 * reference in the pivot.
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

export const refKey = (r: Ref): string => `${r.book} ${r.chapter}:${r.verse}${r.segment}`;
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
 * One direction-agnostic relation from a scheme's references to another
 * scheme's, with identity wherever no row speaks.
 */
export class Relation {
  private readonly byFrom = new Map<string, (Ref | null)[]>();
  /** `BOOK C:V` → from-keys of rows whose `from` is that verse or a part of it. */
  private readonly fromParts = new Map<string, string[]>();
  private readonly byTo = new Map<string, Ref[]>();
  /** `BOOK C:V` → to-keys of rows whose `to` is that verse or a part of it. */
  private readonly toParts = new Map<string, string[]>();

  constructor(rows: readonly { from: Ref; to: Ref | null }[]) {
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

  /** Whether any row starts at this reference, its whole verse or one of its parts. */
  private speaksFor(r: Ref): boolean {
    return this.byFrom.has(refKey(r)) || this.byFrom.has(refKey(whole(r))) ||
      (r.segment === '' && this.fromParts.has(verseOf(r)));
  }

  /** Where `r` goes. Empty means absent. */
  forward(r: Ref): Ref[] {
    const exact = this.byFrom.get(refKey(r));
    if (exact) return dedupe(exact.filter((t): t is Ref => t !== null));
    if (r.segment !== '') {
      const w = this.byFrom.get(refKey(whole(r)));
      if (w) return dedupe(w.filter((t): t is Ref => t !== null));
    } else {
      const parts = this.fromParts.get(verseOf(r));
      if (parts) return dedupe(parts.flatMap((k) => this.byFrom.get(k)!).filter((t): t is Ref => t !== null));
    }
    return [r];
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
    if (!this.speaksFor(r) && exists(r)) out.push(r);
    return dedupe(out);
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
    for (const id of schemes.keys()) this.relations.set(id, new Relation(byScheme.get(id) ?? []));
  }

  private scheme(id: string): Scheme {
    const s = this.schemes.get(id);
    if (!s) throw new Error(`unknown scheme "${id}"`);
    return s;
  }

  toPivot(scheme: string, r: Ref): Ref[] {
    this.scheme(scheme);
    return this.relations.get(scheme)!.forward(r);
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
  const rel = new Relation(own);
  const absent = new Set(own.filter((r) => r.to === null).map((r) => refKey(r.from)));
  const problems: string[] = [];
  for (const [book, counts] of scheme.verseCounts) {
    counts.forEach((last, i) => {
      for (let v = 1; v <= last; v++) {
        if (!hasVerse(scheme, book, i + 1, v)) continue;
        const ref = { book, chapter: i + 1, verse: v, segment: '' };
        const targets = rel.forward(ref);
        if (targets.length === 0 && !absent.has(refKey(ref))) problems.push(`${refKey(ref)} maps nowhere`);
        for (const t of targets) {
          if (!refExists(pivot, t)) problems.push(`${refKey(ref)} maps to ${refKey(t)}, which the pivot lacks`);
        }
      }
    });
  }
  return problems;
}

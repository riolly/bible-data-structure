/**
 * The pivot scheme and the mapping rows compiled from Paratext `.vrs` files
 * (ADR-0006).
 *
 * The pivot is TVTMS's Standard numbering: KJV numbers, with subverses where
 * other Bibles split a KJV verse, titles as verse 0, and the extra books. It
 * is built from `kjv` (the 66 books), from where eng's verses land for the
 * other books eng has, and from Paratext counts for books eng lacks; tvtms.ts
 * then adds every Standard reference. It only grows: the ingest compares it
 * with fixtures/pivot.json, the previous build.
 *
 * `.vrs` mapping lines read `scheme = org`. A scheme's rows to the pivot are
 * composed as scheme → org (its own lines, then org.vrs's own lines) → eng
 * (eng.vrs read backwards) → pivot (ENG_TO_PIVOT, or TVTMS's eng rows when
 * given). A book eng lacks goes from org straight to the pivot. org is only a
 * step in Paratext's own data here, never the pivot.
 */

import { PIVOT, Relation, parseRefKey, refExists, refKey, type MappingRow, type Ref } from '../model/mapping';
import type { Scheme } from '../model/scheme';
import { PROTESTANT, canonBookCodes } from '../model/canon';
import { DERIVED_SCHEMES, PARATEXT_SCHEMES, readParatextVrs } from './schemes';
import { TVTMS } from './sources';
import { parseVrs, type VrsMapping } from './vrs';

const ref = (book: string, chapter: number, verse: number, segment = ''): Ref => ({ book, chapter, verse, segment });

/**
 * Where `eng` (NRSV-style) differs from the pivot: the TVTMS condensed table
 * "Comparing NRSV=KJV" gives Rev.12:18=13:1a and 3Jn.1:15=3Jn.1:14b.
 */
export const ENG_TO_PIVOT: readonly { from: Ref; to: Ref }[] = [
  { from: ref('REV', 12, 18), to: ref('REV', 13, 1, 'a') },
  { from: ref('REV', 13, 1), to: ref('REV', 13, 1, 'b') },
  { from: ref('3JN', 1, 14), to: ref('3JN', 1, 14, 'a') },
  { from: ref('3JN', 1, 15), to: ref('3JN', 1, 14, 'b') },
];

/**
 * Build the pivot: kjv's 66 books; eng's other books where `engToPivotRows`
 * sends eng's verses (identity by default, TVTMS's eng rows once compiled);
 * any book eng lacks numbered as the first Paratext scheme that has it (org
 * first); subverses from ENG_TO_PIVOT; and the kjv and eng titles.
 */
export function buildPivot(
  schemes: ReadonlyMap<string, Scheme>,
  engToPivotRows: readonly { from: Ref; to: Ref | null }[] = ENG_TO_PIVOT,
): Scheme {
  const kjv = schemes.get('kjv')!;
  const eng = schemes.get('eng')!;
  const protestant = new Set(canonBookCodes(PROTESTANT));
  const verseCounts = new Map<string, number[]>();
  const segments = new Map<string, string[]>();
  const titles = new Set([...kjv.titles, ...eng.titles]);
  const addSegment = (r: Ref) => {
    if (r.segment === '') return;
    const k = `${r.book} ${r.chapter}:${r.verse}`;
    const segs = segments.get(k) ?? segments.set(k, []).get(k)!;
    if (!segs.includes(r.segment)) segs.push(r.segment);
  };
  for (const [book, counts] of kjv.verseCounts) verseCounts.set(book, [...counts]);
  const engToPivot = new Relation(engToPivotRows);
  for (const [book, counts] of eng.verseCounts) {
    if (protestant.has(book)) continue;
    counts.forEach((last, i) => {
      for (let v = 1; v <= last; v++) {
        for (const t of engToPivot.forward(ref(book, i + 1, v))) {
          const c = verseCounts.get(t.book) ?? verseCounts.set(t.book, []).get(t.book)!;
          while (c.length < t.chapter) c.push(0);
          if (t.verse === 0) titles.add(`${t.book} ${t.chapter}`);
          else c[t.chapter - 1] = Math.max(c[t.chapter - 1], t.verse);
          addSegment(t);
        }
      }
    });
  }
  for (const { id } of PARATEXT_SCHEMES) {
    for (const [book, counts] of schemes.get(id)!.verseCounts) {
      if (!verseCounts.has(book)) verseCounts.set(book, [...counts]);
    }
  }
  for (const { to } of ENG_TO_PIVOT) addSegment(to);
  return {
    id: PIVOT,
    name: 'Pivot',
    sourceUrl: TVTMS.url,
    note: 'Synthetic, extend-only (ADR-0006). TVTMS Standard numbering: KJV numbers, subverses, titles as verse 0, extra books.',
    verseCounts,
    excluded: new Set(),
    segments,
    titles,
  };
}

/** Every reference a scheme has: each counted verse, plus every `from` of its mapping lines (titles, segments). */
function domain(s: Scheme, extra: readonly Ref[]): Ref[] {
  const out: Ref[] = [];
  for (const [book, counts] of s.verseCounts) {
    counts.forEach((last, i) => {
      for (let v = 1; v <= last; v++) {
        if (!s.excluded.has(`${book} ${i + 1}:${v}`)) out.push(ref(book, i + 1, v));
      }
    });
  }
  const seen = new Set(out.map(refKey));
  for (const r of extra) {
    const k = refKey(r);
    if (!seen.has(k)) out.push(r), seen.add(k);
  }
  return out;
}

const same = (a: readonly Ref[], b: Ref) =>
  a.length === 1 && a[0].book === b.book && a[0].chapter === b.chapter && a[0].verse === b.verse && a[0].segment === b.segment;

const parsed = new Map<string, VrsMapping[]>();
const relations = new Map<string, Relation>();
function vrsMappings(id: string): VrsMapping[] {
  if (!parsed.has(id)) parsed.set(id, parseVrs(readParatextVrs(id)).mappings);
  return parsed.get(id)!;
}
function relation(id: string): Relation {
  if (!relations.has(id)) relations.set(id, new Relation(vrsMappings(id)));
  return relations.get(id)!;
}

/**
 * Compile one Paratext scheme's `.vrs` mapping lines into sparse rows to the
 * pivot. A verse that lands on itself gets no row. `kind` says how the line
 * read: `renumber` (one to one), `split` (one to several), `merge` (several to
 * one), or `absent` (no counterpart).
 */
export function vrsPivotRows(
  schemeId: string,
  schemes: ReadonlyMap<string, Scheme>,
  engToPivotRows: readonly { from: Ref; to: Ref | null }[] = ENG_TO_PIVOT,
): MappingRow[] {
  const scheme = schemes.get(schemeId)!;
  const eng = schemes.get('eng')!;
  const own = vrsMappings(schemeId);
  const toOrg = new Relation(own);
  const engToOrg = relation('eng');
  // org.vrs maps org's own S3Y onto DAG; Paratext applies it inside the standard.
  const inOrg = relation('org');
  const engToPivot = new Relation(engToPivotRows);
  const engHas = (r: Ref) => refExists(eng, r);

  const targetsOf = new Map<string, Ref[]>();
  for (const r of domain(scheme, own.map((m) => m.from))) {
    // A book eng lacks keeps its org numbering in the pivot.
    const viaEng =
      schemeId === 'eng'
        ? [r]
        : toOrg
            .forward(r)
            .flatMap((o) => (schemeId === 'org' ? [o] : inOrg.forward(o)))
            .flatMap((o) => (eng.verseCounts.has(o.book) ? engToOrg.backward(o, engHas) : [o]));
    const targets = viaEng.flatMap((e) => engToPivot.forward(e));
    if (!same(targets, r)) targetsOf.set(refKey(r), targets);
  }

  const sourcesPerTarget = new Map<string, number>();
  for (const targets of targetsOf.values()) {
    for (const t of targets) {
      const k = refKey(t);
      sourcesPerTarget.set(k, (sourcesPerTarget.get(k) ?? 0) + 1);
    }
  }
  const rows: MappingRow[] = [];
  for (const [key, targets] of targetsOf) {
    const from = parseRefKey(key);
    if (targets.length === 0) {
      rows.push({ scheme: schemeId, from, to: null, kind: 'absent' });
      continue;
    }
    for (const to of targets) {
      const merged = (sourcesPerTarget.get(refKey(to)) ?? 0) > 1;
      const kind = targets.length > 1 ? 'split' : merged ? 'merge' : 'renumber';
      rows.push({ scheme: schemeId, from, to, kind });
    }
  }
  return rows;
}

/**
 * Rows for every Paratext scheme, and the rows derived schemes take from
 * them. `kjv` is the pivot's own numbering and needs none. `engToPivotRows` is how eng reaches the pivot: ENG_TO_PIVOT by default,
 * or TVTMS's eng rows once compiled (tvtms.ts `engToPivotRows`), so both
 * witnesses give pivot ids the same meaning.
 */
export function allVrsPivotRows(
  schemes: ReadonlyMap<string, Scheme>,
  engToPivotRows: readonly { from: Ref; to: Ref | null }[] = ENG_TO_PIVOT,
): MappingRow[] {
  const paratext = PARATEXT_SCHEMES.flatMap((s) => vrsPivotRows(s.id, schemes, engToPivotRows));
  return [...paratext, ...derivedVrsPivotRows(paratext)];
}

/**
 * A derived scheme (ADR-0002 amendment) numbers every chapter it leaves
 * unchanged as its base does, so there it takes its base's `.vrs` rows, and
 * for the books it copies, the rows of the scheme it copies them from. Rows
 * from a chapter it changes are left out. With `kjv` or `eng` as the source
 * there are no rows to take; TVTMS alone maps those schemes.
 */
export function derivedVrsPivotRows(paratextRows: readonly MappingRow[]): MappingRow[] {
  const byScheme = new Map<string, MappingRow[]>();
  for (const r of paratextRows) (byScheme.get(r.scheme) ?? byScheme.set(r.scheme, []).get(r.scheme)!).push(r);
  const out: MappingRow[] = [];
  for (const def of DERIVED_SCHEMES) {
    const changed = new Set(def.lastVerses.map(([book, chapter]) => `${book} ${chapter}`));
    const added = new Set(def.addBooks?.books ?? []);
    const inherited = [
      ...(byScheme.get(def.base) ?? []).filter((r) => !added.has(r.from.book)),
      ...(def.addBooks ? (byScheme.get(def.addBooks.from) ?? []).filter((r) => added.has(r.from.book)) : []),
    ];
    const rows = inherited
      .filter((r) => !changed.has(`${r.from.book} ${r.from.chapter}`))
      .map((r) => ({ ...r, scheme: def.id }));
    byScheme.set(def.id, rows);
    out.push(...rows);
  }
  return out;
}

/** The pivot as committed in fixtures/pivot.json: the previous build. */
export interface PivotSnapshot {
  readonly books: Record<string, number[]>;
  readonly segments: Record<string, string[]>;
  readonly titles: string[];
}

export function pivotSnapshot(p: Scheme): PivotSnapshot {
  return {
    books: Object.fromEntries([...p.verseCounts].map(([b, c]) => [b, [...c]])),
    segments: Object.fromEntries([...p.segments].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v]])),
    titles: [...p.titles].sort(),
  };
}

/**
 * Two of SWORD's three invariants for the pivot (ADR-0006): no id is removed
 * and no count decreases. A book, chapter, verse, segment or title in `prev`
 * must still be in `next`, and segments may only be appended, so an existing
 * letter keeps its position. The third, that no id changes meaning, can't be
 * checked from ids; review the witness diff for it. Returns the violations.
 */
export function checkExtendOnly(prev: PivotSnapshot, next: PivotSnapshot): string[] {
  const out: string[] = [];
  for (const [book, counts] of Object.entries(prev.books)) {
    const now = next.books[book];
    if (!now) {
      out.push(`book ${book} removed`);
      continue;
    }
    counts.forEach((c, i) => {
      if ((now[i] ?? 0) < c) out.push(`${book} ${i + 1} shrank from ${c} to ${now[i] ?? 0} verses`);
    });
  }
  for (const [key, segs] of Object.entries(prev.segments)) {
    const now = next.segments[key] ?? [];
    if (segs.some((s, i) => now[i] !== s)) out.push(`segments of ${key} changed from ${segs.join(',')} to ${now.join(',')}`);
  }
  const titles = new Set(next.titles);
  for (const t of prev.titles) if (!titles.has(t)) out.push(`title ${t} removed`);
  return out;
}

/** The snapshot as written to fixtures/pivot.json: one book or segment list per line. */
export function formatPivotSnapshot(s: PivotSnapshot): string {
  const lines = (o: Record<string, unknown>) =>
    Object.entries(o)
      .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
      .join(',\n');
  return `{\n  "books": {\n${lines(s.books)}\n  },\n  "segments": {\n${lines(s.segments)}\n  },\n  "titles": ${JSON.stringify(s.titles)}\n}\n`;
}

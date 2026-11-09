/**
 * The pivot scheme and the mapping rows compiled from Paratext `.vrs` files
 * (ADR-0006).
 *
 * The pivot is TVTMS's Standard numbering: KJV numbers, with subverses where
 * other English Bibles split a KJV verse, titles as verse 0, and the extra
 * books. It is seeded here from `kjv` (the 66 books) and `eng` (the other
 * books), and only grows: pivot.test.ts compares it with the committed
 * snapshot in fixtures/pivot.json, the previous build.
 *
 * `.vrs` mapping lines read `scheme = org`. A scheme's rows to the pivot are
 * composed as scheme → org (its own lines, then org.vrs's own lines) → eng (eng.vrs read backwards) →
 * pivot (ENG_TO_PIVOT, or TVTMS's eng rows when given). A book eng lacks goes
 * from org straight to the pivot.
 * org is only a step in Paratext's own data here, never the pivot.
 */

import { PIVOT, Relation, refExists, type MappingRow, type Ref } from '../model/mapping';
import type { Scheme } from '../model/scheme';
import { PROTESTANT, canonBookCodes } from '../model/canon';
import { PARATEXT_SCHEMES, readParatextVrs } from './schemes';
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
 * Build the pivot from the registry: kjv's 66 books, eng's other books, and
 * any book eng lacks numbered as the first Paratext scheme that has it (org
 * first), with ENG_TO_PIVOT's subverses.
 */
export function buildPivot(schemes: ReadonlyMap<string, Scheme>): Scheme {
  const kjv = schemes.get('kjv')!;
  const eng = schemes.get('eng')!;
  const protestant = new Set(canonBookCodes(PROTESTANT));
  const verseCounts = new Map<string, number[]>();
  for (const [book, counts] of kjv.verseCounts) verseCounts.set(book, [...counts]);
  for (const [book, counts] of eng.verseCounts) if (!protestant.has(book)) verseCounts.set(book, [...counts]);
  for (const { id } of PARATEXT_SCHEMES) {
    for (const [book, counts] of schemes.get(id)!.verseCounts) {
      if (!verseCounts.has(book)) verseCounts.set(book, [...counts]);
    }
  }
  const segments = new Map<string, string[]>();
  for (const { to } of ENG_TO_PIVOT) {
    if (to.segment === '') continue;
    const k = `${to.book} ${to.chapter}:${to.verse}`;
    segments.set(k, [...(segments.get(k) ?? []), to.segment]);
  }
  return {
    id: PIVOT,
    name: 'Pivot',
    sourceUrl: 'https://github.com/STEPBible/STEPBible-Data/tree/5de0a47f35f0fc13dfe1430d104e5db8a4285f9c/Versification',
    note: 'Synthetic, extend-only (ADR-0006). TVTMS Standard numbering: KJV numbers, subverses, titles as verse 0, extra books.',
    verseCounts,
    excluded: new Set(),
    segments,
    titles: new Set(eng.titles),
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
  const seen = new Set(out.map((r) => `${r.book} ${r.chapter}:${r.verse}${r.segment}`));
  for (const r of extra) {
    const k = `${r.book} ${r.chapter}:${r.verse}${r.segment}`;
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
    if (!same(targets, r)) targetsOf.set(`${r.book} ${r.chapter}:${r.verse}${r.segment}`, targets);
  }

  const sourcesPerTarget = new Map<string, number>();
  for (const targets of targetsOf.values()) {
    for (const t of targets) {
      const k = `${t.book} ${t.chapter}:${t.verse}${t.segment}`;
      sourcesPerTarget.set(k, (sourcesPerTarget.get(k) ?? 0) + 1);
    }
  }
  const rows: MappingRow[] = [];
  for (const [key, targets] of targetsOf) {
    const m = /^(\S+) (\d+):(\d+)([a-z]?)$/.exec(key)!;
    const from = ref(m[1], Number(m[2]), Number(m[3]), m[4]);
    if (targets.length === 0) {
      rows.push({ scheme: schemeId, from, to: null, kind: 'absent' });
      continue;
    }
    for (const to of targets) {
      const merged = (sourcesPerTarget.get(`${to.book} ${to.chapter}:${to.verse}${to.segment}`) ?? 0) > 1;
      const kind = targets.length > 1 ? 'split' : merged ? 'merge' : 'renumber';
      rows.push({ scheme: schemeId, from, to, kind });
    }
  }
  return rows;
}

/**
 * Rows for every Paratext scheme. `kjv` is the pivot's own numbering and needs
 * none. `engToPivotRows` is how eng reaches the pivot: ENG_TO_PIVOT by default,
 * or TVTMS's eng rows once compiled (tvtms.ts `engToPivotRows`), so both
 * witnesses give pivot ids the same meaning.
 */
export function allVrsPivotRows(
  schemes: ReadonlyMap<string, Scheme>,
  engToPivotRows: readonly { from: Ref; to: Ref | null }[] = ENG_TO_PIVOT,
): MappingRow[] {
  return PARATEXT_SCHEMES.flatMap((s) => vrsPivotRows(s.id, schemes, engToPivotRows));
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
 * SWORD's invariants for the pivot (ADR-0006): no id is removed, no count
 * decreases, and no meaning is reassigned. A book, chapter, verse, segment or
 * title in `prev` must still be in `next`; segments may only be appended, so
 * an existing letter keeps its position. Returns the violations.
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

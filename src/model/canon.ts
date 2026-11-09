/**
 * Canons as data (ADR-0002 "Canon shape"). A canon is a named list of entries
 * in its own order, grouped by a tree of sections. Order and grouping belong to
 * the canon, never to the book.
 *
 * Array order is the ordinal: `sections` and `entries` are listed in canon
 * order, and an entry's `books` in their order inside the entry.
 */

export type EntryStatus = 'canonical' | 'readable' | 'appendix';

export interface CanonSection {
  readonly id: string;
  readonly parent: string | null;
  readonly labelKey: string;
}

export interface CanonEntry {
  readonly id: string;
  readonly section: string;
  readonly status: EntryStatus;
  /** Display key. `null` means "use the name of the entry's only book". */
  readonly labelKey: string | null;
  /** USFM codes. Tanakh "Samuel" would be `['1SA', '2SA']`. */
  readonly books: readonly string[];
}

export interface Canon {
  readonly id: string;
  readonly tradition: string;
  readonly sourceUrl: string;
  readonly note: string;
  readonly sections: readonly CanonSection[];
  readonly entries: readonly CanonEntry[];
}

/** A book's names in one language. `canonId` NULL is the default; a canon row overrides it. */
export interface BookName {
  readonly bookCode: string;
  /** BCP 47 tag. */
  readonly lang: string;
  readonly canonId: string | null;
  readonly long: string;
  readonly short: string;
  readonly abbr: string | null;
  readonly source: string;
}

/** Every book code in a canon, in canon order. */
export function canonBookCodes(canon: Canon): string[] {
  return canon.entries.flatMap((e) => e.books);
}

/** The book codes of one section and the sections under it, in canon order. */
export function sectionBookCodes(canon: Canon, section: string): string[] {
  if (!canon.sections.some((s) => s.id === section)) throw new Error(`${canon.id} has no section "${section}"`);
  const parent = new Map(canon.sections.map((s) => [s.id, s.parent]));
  const under = (id: string | null): boolean => id !== null && (id === section || under(parent.get(id) ?? null));
  return canon.entries.filter((e) => under(e.section)).flatMap((e) => e.books);
}

const one = (section: string) => (code: string): CanonEntry => ({
  id: code,
  section,
  status: 'canonical',
  labelKey: null,
  books: [code],
});

// prettier-ignore
const PROTESTANT_OT = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH',
  '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK',
  'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
];
// prettier-ignore
const NT = [
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH',
  '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV',
];

export const PROTESTANT: Canon = {
  id: 'protestant',
  tradition: 'protestant',
  sourceUrl:
    'https://git.crosswire.org/main/sword/-/blob/a376e42938580f446f53a4cb20e7161355fa9110/include/canon.h#L326-334',
  note: 'The 66-book order of the KJV and of SWORD\'s KJV scheme (research/canons.md, "Protestant (66)").',
  sections: [
    { id: 'ot', parent: null, labelKey: 'ot' },
    { id: 'nt', parent: null, labelKey: 'nt' },
  ],
  entries: [...PROTESTANT_OT.map(one('ot')), ...NT.map(one('nt'))],
};

export const CANONS: readonly Canon[] = [PROTESTANT];

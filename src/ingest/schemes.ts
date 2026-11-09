/**
 * The scheme registry (ADR-0002): `kjv` plus the six Paratext schemes.
 *
 * The Paratext schemes come from libpalaso's `.vrs` files (MIT, see
 * vrs/libpalaso/LICENSE), committed under vrs/libpalaso/ at the commit below
 * and checked by sha256 on every load. A changed file stops the load.
 *
 * `kjv` is SWORD's KJV numbering. SWORD is GPL-2.0 and never ships (ADR-0006),
 * and no libpalaso file is KJV numbering. So `kjv` takes eng's counts for the
 * 66 protestant books and changes Revelation 12 to end at verse 17 and 3 John
 * at verse 14. schemes.test.ts checks every verse of the KJV and BSB texts
 * against the result, and those two are the only places they differ.
 *
 * Psalm titles: KJV_TITLES lists the Psalms whose title KJV prints (a `\d`
 * line in the KJV and BSB sources; the test checks both). `kjv` and `eng` have
 * verse 0 there. A Paratext scheme also has verse 0 where its own mapping
 * lines number one.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROTESTANT, canonBookCodes } from '../model/canon';
import type { Scheme } from '../model/scheme';
import { parseVrs } from './vrs';

export const LIBPALASO_COMMIT = 'f1f70e93a79d55b1769a4e20fb36047f2fa08d99';
export const LIBPALASO_URL = `https://github.com/sillsdev/libpalaso/blob/${LIBPALASO_COMMIT}/SIL.Scripture/Resources`;
export const LIBPALASO_DIR = join(import.meta.dirname, 'vrs', 'libpalaso');

/**
 * Codes libpalaso's Canon.cs marks "*obsolete*" (Rahlfs variant texts, "now in
 * LXA text"). `eng`, `org` and `lxx` still list their counts, but no mapping
 * line uses them and the USFM spec has no such books, so they are dropped.
 */
export const OBSOLETE_CODES: ReadonlySet<string> = new Set(['JSA', 'JDB', 'TBS', 'SST', 'DNT', 'BLT']);

interface ParatextScheme {
  readonly id: string;
  readonly name: string;
  readonly sha256: string;
}

/** Each file is `<id>.vrs`, upstream `<id>.vrs.txt`. Names are the files' own headers. */
export const PARATEXT_SCHEMES: readonly ParatextScheme[] = [
  { id: 'org', name: 'Original', sha256: '1caee506dc4cc2947e45861c7d2ba5b5eeca9063ee263a37f2ca08f240e457ca' },
  { id: 'eng', name: 'English', sha256: '003981c7f43c69b73b60d40a3f35f72e7ee017a686a6fb206f19a1b721157541' },
  { id: 'lxx', name: 'Septuagint', sha256: 'f7c7bd6e0e5a536b6ec924bfb5f19596bc21af5bee268f97dd51d0845328cc1f' },
  { id: 'vul', name: 'Vulgate', sha256: 'f3312f4f0ffcbf48a43a20f88212a64b070b100b2764d912481c5e481a015c51' },
  { id: 'rso', name: 'Russian Orthodox', sha256: '36dd088244fc5b41fa8f3d0dcce58412e3b944c9bdc8bbce818abdfb03df3072' },
  { id: 'rsc', name: 'Russian Protestant', sha256: '10beba712a98f9175268b770c24193897a1e6cdc0e5f2bb413423a839781471a' },
];

export const SCHEME_IDS: readonly string[] = ['kjv', ...PARATEXT_SCHEMES.map((s) => s.id)];

// prettier-ignore
export const KJV_TITLES: readonly number[] = [
  3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
  30, 31, 32, 34, 35, 36, 37, 38, 39, 40, 41, 42, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
  57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82,
  83, 84, 85, 86, 87, 88, 89, 90, 92, 98, 100, 101, 102, 103, 108, 109, 110, 120, 121, 122, 123, 124,
  125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 138, 139, 140, 141, 142, 143, 144, 145,
];
const kjvTitles = KJV_TITLES.map((c) => `PSA ${c}`);

/** Where `kjv` differs from `eng` in the 66 protestant books: [book, chapter, last verse]. */
const KJV_FROM_ENG: readonly (readonly [string, number, number])[] = [
  ['REV', 12, 17],
  ['3JN', 1, 14],
];

/** Read one pinned libpalaso file, failing on a checksum mismatch. */
export function readParatextVrs(id: string): string {
  const def = PARATEXT_SCHEMES.find((s) => s.id === id);
  if (!def) throw new Error(`no Paratext scheme "${id}"`);
  const buf = readFileSync(join(LIBPALASO_DIR, `${id}.vrs`));
  const digest = createHash('sha256').update(buf).digest('hex');
  if (digest !== def.sha256) {
    throw new Error(`${id}.vrs: sha256 ${digest} does not match the pin ${def.sha256}`);
  }
  return buf.toString('utf8');
}

export function loadSchemes(): Map<string, Scheme> {
  const out = new Map<string, Scheme>();
  for (const def of PARATEXT_SCHEMES) {
    const { verseCounts, excluded, segments, mappings } = parseVrs(readParatextVrs(def.id));
    // A title is verse 0 where the scheme's own mapping lines number one.
    const titles = new Set(mappings.filter((m) => m.from.verse === 0).map((m) => `${m.from.book} ${m.from.chapter}`));
    if (def.id === 'eng') for (const t of kjvTitles) titles.add(t);
    for (const code of OBSOLETE_CODES) verseCounts.delete(code);
    out.set(def.id, {
      id: def.id,
      name: def.name,
      sourceUrl: `${LIBPALASO_URL}/${def.id}.vrs.txt`,
      note: 'Paratext versification, libpalaso (MIT).',
      verseCounts,
      excluded: new Set([...excluded].filter((k) => !OBSOLETE_CODES.has(k.slice(0, 3)))),
      segments,
      titles,
    });
  }

  const eng = out.get('eng')!;
  const kjvCounts = new Map<string, number[]>();
  for (const code of canonBookCodes(PROTESTANT)) kjvCounts.set(code, [...eng.verseCounts.get(code)!]);
  for (const [book, chapter, last] of KJV_FROM_ENG) kjvCounts.get(book)![chapter - 1] = last;
  out.set('kjv', {
    id: 'kjv',
    name: 'King James',
    sourceUrl: `${LIBPALASO_URL}/eng.vrs.txt`,
    note: 'SWORD KJV numbering: eng counts for the 66 protestant books, with REV 12 ending at 17 and 3JN at 14; KJV Psalm titles.',
    verseCounts: kjvCounts,
    excluded: new Set(),
    segments: new Map(),
    titles: new Set(kjvTitles),
  });
  return out;
}

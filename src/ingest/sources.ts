/**
 * Pinned upstream USFM sources. Full corpora are NOT committed — the download
 * script fetches these zips into src/ingest/sources/ (gitignored) and
 * verifies the pinned sha256. If upstream re-publishes (ebible.org refreshes
 * zips when a text is revised), the checksum fails LOUDLY: updating the pin is
 * a conscious act that produces a new `translation.edition` (ADR-0005) and
 * triggers the quote-witness reconciliation story downstream.
 *
 * KJV and BSB pinned 2026-11-09 (README.md Editions), the others the same day
 * in step 3. Licensing verdicts: research/licensing.md.
 */

import { PROTESTANT, canonBookCodes, sectionBookCodes } from '../model/canon';
import type { TranslationMeta } from './write-db';

/**
 * An exact string replaced in a source before parsing, for a conversion error
 * upstream does not have. `count` is how many times it must occur across the
 * source; any other count stops the ingest. The edition stamp is computed from
 * the unfixed files, so it still names the upstream text.
 */
export interface TextFix {
  readonly find: string;
  readonly replace: string;
  readonly count: number;
  readonly why: string;
}

export interface SourceDef {
  readonly meta: TranslationMeta & { edition: '' }; // edition computed at ingest (edition.ts)
  readonly url: string;
  readonly sha256: string;
  /** Directory under src/ingest/sources/ the zip unpacks into. */
  readonly dir: string;
  /**
   * The books to ingest, in order. The source must have every one; its other
   * files (front matter, glossary, books outside the list) are skipped.
   */
  readonly books: readonly string[];
  readonly textFixes?: readonly TextFix[];
  /**
   * Opt-in to the versified-\d → \qd grammar-gap rewrite (parse.ts). Only set
   * after eyeballing the source's \d+\v constructs — parse fails loudly when
   * the construct appears without this flag, so a new translation never gets
   * markers silently rewritten.
   */
  readonly rewriteVersifiedD: boolean;
}

export const SOURCES: readonly SourceDef[] = [
  {
    meta: {
      name: 'King James Version',
      abbrev: 'KJV',
      language: 'english',
      year: 1769,
      license: 'Public Domain',
      scheme: 'kjv',
      edition: '',
    },
    url: 'https://ebible.org/Scriptures/eng-kjv_usfm.zip',
    sha256: 'c7ba60db8ac93191192fb7cef05be13f174f756f08584c98cdfccdacfe621aaf',
    dir: 'kjv',
    books: canonBookCodes(PROTESTANT),
    rewriteVersifiedD: false,
  },
  {
    meta: {
      name: 'Berean Standard Bible',
      abbrev: 'BSB',
      language: 'english',
      year: 2023,
      license: 'Public Domain',
      scheme: 'kjv',
      edition: '',
    },
    url: 'https://ebible.org/Scriptures/engbsb_usfm.zip',
    sha256: '75ca91d5a5c69ca4cbdeabdb03ea1a458db20cf3966abe15d86df086acf7fbc4',
    dir: 'bsb',
    books: canonBookCodes(PROTESTANT),
    rewriteVersifiedD: true, // BSB Zech 12 versified \d (grammar gap, parse.ts)
  },
  {
    meta: {
      name: 'Westminster Leningrad Codex',
      abbrev: 'WLC',
      language: 'hebrew',
      year: null,
      license: 'Public Domain',
      scheme: 'org',
      edition: '',
    },
    // OSHB's WLC. Its \w strong and x-morph attributes (OSHB data, CC BY 4.0)
    // are counted and dropped by normalize.ts, so only the text is stored.
    url: 'https://ebible.org/Scriptures/hboWLC_usfm.zip',
    sha256: '464225e119973cb7e12a30777c2d5e7f543f083529b00b909d620c617dbd1df7',
    dir: 'wlc',
    books: sectionBookCodes(PROTESTANT, 'ot'),
    rewriteVersifiedD: false,
  },
  {
    meta: {
      name: 'SBL Greek New Testament',
      abbrev: 'SBLGNT',
      language: 'greek',
      year: 2010,
      license: 'CC BY 4.0, © 2010 Society of Biblical Literature and Logos Bible Software; changed: see textFixes',
      scheme: 'org',
      edition: '',
    },
    url: 'https://ebible.org/Scriptures/grcsbl_usfm.zip',
    sha256: '04c5c536b8ef977e30de3f37e2ec16300e8452173322dc2e8c25b1a02bb10a73',
    dir: 'sblgnt',
    books: sectionBookCodes(PROTESTANT, 'nt'),
    rewriteVersifiedD: false,
    textFixes: [
      {
        find: ' ‘p /’ ‘/book’',
        replace: '',
        count: 26,
        why: 'ebible.org left XML tags as text after the last verse of every book but Revelation; upstream SBLGNT has none',
      },
    ],
  },
];

/**
 * STEPBible TVTMS, the primary scheme-mapping data (ADR-0006). CC BY 4.0 by
 * Tyndale House and STEPBible.org. STEPBible asks that the raw file not be
 * re-posted, so it is pinned here and downloaded to sources/tvtms/, never
 * committed. Updating the pin can change mapping rows; diff before and after.
 */
export const TVTMS = {
  url:
    'https://raw.githubusercontent.com/STEPBible/STEPBible-Data/5de0a47f35f0fc13dfe1430d104e5db8a4285f9c/Versification/' +
    'TVTMS%20-%20Translators%20Versification%20Traditions%20with%20Methodology%20for%20Standardisation%20for%20Eng%2BHeb%2BLat%2BGrk%2BOthers%20-%20STEPBible.org%20CC%20BY.txt',
  sha256: 'c42cdfec1ae82d3e0c7e2f6a89d73bbed28ede4cf3fe18d5582626881e8d5c78',
  /** Under src/ingest/sources/. */
  file: 'tvtms/tvtms.txt',
  attribution:
    'Versification mappings from TVTMS by Tyndale House and STEPBible.org (CC BY 4.0), https://STEPBible.github.io/STEPBible-Data',
} as const;

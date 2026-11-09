/**
 * Pinned upstream USFM sources. Full corpora are NOT committed — the download
 * script fetches these zips into scripts/ingest/sources/ (gitignored) and
 * verifies the pinned sha256. If upstream re-publishes (ebible.org refreshes
 * zips when a text is revised), the checksum fails LOUDLY: updating the pin is
 * a conscious act that produces a new `translation.edition` (ADR-0005) and
 * triggers the quote-witness reconciliation story downstream.
 *
 * Pinned 2026-07-04.
 */

import type { TranslationMeta } from './write-db';

export interface SourceDef {
  readonly meta: TranslationMeta & { edition: '' }; // edition computed at ingest (edition.ts)
  readonly url: string;
  readonly sha256: string;
  /** Directory under scripts/ingest/sources/ the zip unpacks into. */
  readonly dir: string;
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
    rewriteVersifiedD: true, // BSB Zech 12 versified \d (grammar gap, parse.ts)
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

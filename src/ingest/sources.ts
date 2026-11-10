/**
 * Pinned upstream sources. Full corpora are not committed: the download script
 * fetches these zips into src/ingest/sources/ (gitignored) and checks that the
 * unpacked text gives the pinned edition stamp (ADR-0005 amendment, step 6).
 * A rebuilt zip with the same text passes. A changed stamp stops the download,
 * and updating `edition` here is a new edition (README.md Editions).
 *
 * When upstream no longer gives the pinned stamp, the download falls back to
 * our own copy, `mirrorLabel(src)`. Licensing verdicts: research/licensing.md.
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
  /**
   * The pinned edition stamp (`computeEdition` in edition.ts over the listed
   * books' upstream files). The download and the ingest stop on any other.
   */
  readonly edition: string;
  /** Directory under src/ingest/sources/ the zip unpacks into. */
  readonly dir: string;
  /**
   * The books to ingest, in order. The source must have every one; its other
   * files (front matter, glossary, books outside the list) are skipped.
   */
  readonly books: readonly string[];
  readonly textFixes?: readonly TextFix[];
  /**
   * How to read the unpacked source. Absent: its `.usfm` files. `sblgnt-xml`:
   * upstream SBLGNT's per-book XML under `path`, converted by sblgnt-xml.ts.
   * `oshb-xml`: upstream OSHB's per-book OSIS under `path`, converted with its
   * qere readings by oshb-xml.ts.
   */
  readonly format?: { readonly kind: 'sblgnt-xml' | 'oshb-xml'; readonly path: string };
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
    edition: 'sha256:7ead3d28b2b34c9b',
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
      scheme: 'bsb',
      edition: '',
    },
    url: 'https://ebible.org/Scriptures/engbsb_usfm.zip',
    edition: 'sha256:3b0004861fcf2481',
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
    // Upstream OSHB, not ebible's hboWLC: ebible's copy dropped every qere and
    // leaked markup into 11 words (ADR-0007). The converter keeps the text and
    // the qere words' ids, and drops OSHB's lemma and morphology (CC BY 4.0).
    url: 'https://github.com/openscriptures/morphhb/archive/3d15126fb1ef74867fc1434be1942e837932691f.zip',
    edition: 'sha256:b15b041bc282f9b8',
    dir: 'wlc-oshb',
    format: { kind: 'oshb-xml', path: 'morphhb-3d15126fb1ef74867fc1434be1942e837932691f/wlc' },
    books: sectionBookCodes(PROTESTANT, 'ot'),
    rewriteVersifiedD: false,
  },
  {
    meta: {
      name: 'SBL Greek New Testament',
      abbrev: 'SBLGNT',
      language: 'greek',
      year: 2010,
      license:
        'CC BY 4.0, © 2010 Society of Biblical Literature and Logos Bible Software; ' +
        'changed: converted from the upstream XML to USFM, words and punctuation unchanged',
      scheme: 'org',
      edition: '',
    },
    // Upstream, not ebible's grcsbl: ebible's USFM lost words and punctuation in
    // 2,299 verses where it turned apparatus marks into footnotes (research/licensing.md).
    url: 'https://github.com/LogosBible/SBLGNT/archive/d7f35adca9ec410e1d1499c63b4dd989d76c8d4d.zip',
    edition: 'sha256:33876ae1d14e3756',
    dir: 'sblgnt-logos',
    format: { kind: 'sblgnt-xml', path: 'SBLGNT-d7f35adca9ec410e1d1499c63b4dd989d76c8d4d/data/sblgnt/xml' },
    books: sectionBookCodes(PROTESTANT, 'nt'),
    rewriteVersifiedD: false,
  },
  {
    meta: {
      name: 'Robinson-Pierpont Byzantine Text 2018',
      abbrev: 'RP',
      language: 'greek',
      year: 2018,
      license: 'Public Domain',
      scheme: 'rp',
      edition: '',
    },
    url: 'https://ebible.org/Scriptures/grcmt_usfm.zip',
    edition: 'sha256:1defb25636d232d6',
    dir: 'rp',
    books: sectionBookCodes(PROTESTANT, 'nt'),
    rewriteVersifiedD: false,
  },
  {
    meta: {
      name: 'World English Bible Classic',
      abbrev: 'WEB',
      language: 'english',
      year: 2020,
      license: 'Public Domain',
      scheme: 'web',
      edition: '',
    },
    url: 'https://ebible.org/Scriptures/eng-web_usfm.zip',
    edition: 'sha256:5f722b4d8f3f4e8e',
    dir: 'web',
    // ebible's file order: the 39, the deuterocanon, the 27
    books: [
      ...sectionBookCodes(PROTESTANT, 'ot'),
      ...['TOB', 'JDT', 'ESG', 'WIS', 'SIR', 'BAR', '1MA', '2MA', '1ES', 'MAN', 'PS2', '3MA', '2ES', '4MA', 'DAG'],
      ...sectionBookCodes(PROTESTANT, 'nt'),
    ],
    rewriteVersifiedD: false,
    textFixes: [
      {
        // tree-sitter-usfm3 rejects a \+w with attributes inside \qs, and the
        // lenient retry then drops the word (PSA, HAB 3:3). The unwrap keeps
        // the text; normalize.ts drops strong attributes anyway.
        find: '\\qs \\+w Selah|strong="H5542"\\+w*.\\qs*',
        replace: '\\qs Selah.\\qs*',
        count: 17,
        why: 'grammar gap: nested \\+w inside \\qs',
      },
      // A footnote stands where the space between two words should be, so the
      // words ran together ("hellwill", "willheap"). Only whitespace is added;
      // no other source has a note between two letters.
      {
        find: '\\fqa Gehenna. \\f*will be shown',
        replace: '\\fqa Gehenna. \\f* will be shown',
        count: 1,
        why: 'missing space after a footnote, 2ES 7:36',
      },
      {
        find: '\\fqa set in order.\\f*heap up',
        replace: '\\fqa set in order.\\f* heap up',
        count: 1,
        why: 'missing space after a footnote, 2ES 12:32',
      },
    ],
  },
  {
    meta: {
      name: 'Brenton Greek Septuagint',
      abbrev: 'Brenton',
      language: 'greek',
      year: 1851,
      license: 'Public Domain',
      scheme: 'brenton',
      edition: '',
    },
    url: 'https://ebible.org/Scriptures/grcbrent_usfm.zip',
    edition: 'sha256:3db40d92c53c8d1d',
    dir: 'brenton',
    // ebible's file order. EZR is 2 Esdras (Ezra and Nehemiah), as in lxx;
    // Esther and Daniel are the Greek books ESG and DAG.
    // prettier-ignore
    books: [
      'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH',
      'EZR', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'HOS', 'JOL', 'AMO', 'OBA',
      'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'TOB', 'JDT', 'ESG', 'WIS', 'SIR', 'BAR',
      'LJE', 'SUS', 'BEL', '1MA', '2MA', '1ES', 'MAN', '3MA', '4MA', 'DAG',
    ],
    rewriteVersifiedD: true, // 150 Psalm titles are \d holding \v 1, as lxx numbers them (parse.ts)
  },
];

/**
 * Where we keep our own copy of each pinned source: a GitHub release on this
 * repo, one zip per edition stamp. A person uploads them (README.md, steps
 * only a person can do). TVTMS has no copy: STEPBible asks that the raw file
 * not be re-posted.
 */
export const MIRROR = { repo: 'riolly/bible-data-structure', tag: 'sources' } as const;

/** The file name of a source's copy in the mirror release. */
export const mirrorAsset = (src: SourceDef) => `${src.dir}-${src.edition.replace('sha256:', '')}.zip`;

/**
 * Where the download finds a source's copy, for logs. The repo is private, so
 * the asset's https URL fails without a login; this names the `gh` route.
 */
export const mirrorLabel = (src: SourceDef) =>
  `gh release download ${MIRROR.tag} --repo ${MIRROR.repo} --pattern ${mirrorAsset(src)}`;

/**
 * The OSHB pin, for the data_source row of the qere word ids it supplies
 * (ADR-0007). The commit in the URL pins it, and the source is checked by
 * edition stamp, so there is no file hash.
 */
const wlc = SOURCES.find((s) => s.meta.abbrev === 'WLC')!;
export const OSHB = {
  url: wlc.url,
  sha256: null,
  attribution: 'Original work of the Open Scriptures Hebrew Bible available at https://github.com/openscriptures/morphhb (CC BY 4.0)',
} as const;

/**
 * STEPBible TVTMS, the primary scheme-mapping data (ADR-0006). CC BY 4.0 by
 * Tyndale House and STEPBible.org. STEPBible asks that the raw file not be
 * re-posted, so it is pinned here and downloaded to sources/tvtms/, never
 * committed or mirrored. It is one file at a git commit, so its bytes can't
 * change and it keeps a file hash. Updating the pin can change mapping rows;
 * diff before and after.
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

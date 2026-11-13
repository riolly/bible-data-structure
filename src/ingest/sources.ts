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
import type { TranslationMeta } from './edition-writer';

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
  /** The license comes from the edition's rights record (src/contract/rights.ts), its one home. */
  readonly meta: Omit<TranslationMeta, 'license'> & { edition: '' }; // edition computed at ingest (edition.ts)
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
   * upstream SBLGNT's per-book XML under `path`. `oshb-xml`: upstream OSHB's
   * per-book OSIS under `path`. Each kind's adapter is in source-formats.ts.
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
      scheme: 'org',
      edition: '',
    },
    // Upstream OSHB, not ebible's hboWLC: ebible's copy dropped every qere and
    // leaked markup into 11 words (ADR-0007). The converter keeps the text and
    // returns each word's OSHB id, lemma and morphology beside it (CC BY 4.0).
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

/** A data file pinned by its URL at a git commit and its sha256, like TVTMS. */
export interface PinnedFile {
  readonly id: string;
  readonly url: string;
  readonly sha256: string;
  /** Under src/ingest/sources/. */
  readonly file: string;
  readonly license: string;
  readonly attribution: string;
}

/**
 * MACULA Hebrew's word table (Clear Bible, CC BY 4.0), for the glosses of the
 * WLC words (plan step 11). One row per morpheme of the read text: a qere
 * stands in place of its ketiv. Only its `ref`, `text`, `gloss` and `english`
 * columns are read; the gloss columns are Cherith's glosses (CC BY 4.0). The
 * SDBH domains, used by MACULA with permission, are never read
 * (research/licensing.md). The file is in Git LFS, so the URL is GitHub's
 * media host.
 */
export const MACULA_HEBREW: PinnedFile = {
  id: 'macula-hebrew',
  url: 'https://media.githubusercontent.com/media/Clear-Bible/macula-hebrew/47db250bd55d0d8577f2a94fba114ef16c35b23c/WLC/tsv/macula-hebrew.tsv',
  sha256: '965cb0599beed2fe31283b615bcc369178141c0e718a66d97518d94309cfc124',
  file: 'macula/macula-hebrew.tsv',
  license: 'CC BY 4.0',
  attribution:
    'Glosses from MACULA Hebrew Linguistic Datasets, © 2022-2024 Biblica, Inc., CC BY 4.0, ' +
    'https://github.com/Clear-Bible/macula-hebrew, with Cherith Glosses for the Hebrew Old Testament ' +
    'by Andi Wu, © 2022 Cherith Analytics, CC BY 4.0',
};

/**
 * MACULA Greek's SBLGNT word table (Clear Bible, CC BY 4.0): the Strong's
 * number, lemma, morphology and gloss of each SBLGNT word (plan step 11). Its
 * `gloss` column is the Berean Interlinear Bible's (public domain), and its
 * `english` column Cherith's glosses (CC BY 4.0). The Louw-Nida domains (UBS
 * MARBLE, used with permission) are never read (research/licensing.md).
 */
export const MACULA_GREEK: PinnedFile = {
  id: 'macula-greek',
  url: 'https://raw.githubusercontent.com/Clear-Bible/macula-greek/8423afe47b9e8f24b7772e808af45c7159a6fe7e/SBLGNT/tsv/macula-greek-SBLGNT.tsv',
  sha256: '7f71504fdee8659bdd9f85342e4103d645864c2851b8205915bb298f0c004cc5',
  file: 'macula/macula-greek-SBLGNT.tsv',
  license: 'CC BY 4.0',
  attribution:
    'Strong\'s numbers, lemmas, morphology and word ids from MACULA Greek Linguistic Datasets, © 2022-2024 ' +
    'Biblica, Inc., CC BY 4.0, https://github.com/Clear-Bible/macula-greek, with glosses from the Berean ' +
    'Interlinear Bible (public domain) and Cherith Glosses for the Greek New Testament by Andi Wu, ' +
    '© 2023 Cherith Analytics, CC BY 4.0',
};

const CLEAR_ALIGNMENTS = 'https://raw.githubusercontent.com/Clear-Bible/Alignments/c99bd0ae6946775f932517656308ca19fc706921/data';

export const CLEAR_BSB_ATTRIBUTION =
  'BSB word alignments from Bible Word Alignments, © 2022 Clear Bible, Inc., CC BY 4.0, ' +
  'https://github.com/Clear-Bible/Alignments';

const clearFile = (id: string, path: string, sha256: string): PinnedFile => ({
  id,
  url: `${CLEAR_ALIGNMENTS}/${path}`,
  sha256,
  file: `clear/${path.split('/').pop()}`,
  license: 'CC BY 4.0',
  attribution: CLEAR_BSB_ATTRIBUTION,
});

/**
 * Clear Bible's manual alignments of the BSB (CC BY 4.0, plan step 12): which
 * SBLGNT words and WLC morphemes each BSB word translates, with Clear's own
 * tokens of the BSB they point at (research/word-tags.md).
 */
export const CLEAR_BSB = {
  id: 'clear-bsb',
  url: 'https://github.com/Clear-Bible/Alignments/tree/c99bd0ae6946775f932517656308ca19fc706921/data/eng/alignments/BSB',
  attribution: CLEAR_BSB_ATTRIBUTION,
  greek: clearFile('clear-bsb-greek', 'eng/alignments/BSB/SBLGNT-BSB-manual.json', '5c94608d672d89c25057c6339176be13e3946634afe125e1539e8c87f2dcb164'),
  hebrew: clearFile('clear-bsb-hebrew', 'eng/alignments/BSB/WLCM-BSB-manual.json', '3a7619681cebe2d0768681215456e9ee4701aef72a82af5fc851b31148aa3c1f'),
  ntWords: clearFile('clear-bsb-nt', 'eng/targets/BSB/nt_BSB.tsv', 'd388c73f52361968eb96761098e983699fdd0dd37272b1d701efebd61a5a36df'),
  otWords: clearFile('clear-bsb-ot', 'eng/targets/BSB/ot_BSB.tsv', 'f06c76205f30e3e4a95f884a013c2e65a6df2e0acea3435ad3f2d77f71d003da'),
} as const;

/**
 * The KJV's own `\w strong=` tags in ebible's `eng-kjv` (public domain, as the
 * text), checked against the original words and stored as alignment rows
 * (ADR-0003, KJV amendment, plan step 12). Pinned with the KJV's edition.
 */
export const KJV_TAGS = {
  id: 'kjv-strongs',
  edition: 'KJV',
  url: 'https://ebible.org/Scriptures/eng-kjv_usfm.zip',
  attribution: "Strong's numbers from the King James Version's word tags in eBible.org's eng-kjv, courtesy of the Crosswire Bible Society and eBible.org (public domain)",
} as const;

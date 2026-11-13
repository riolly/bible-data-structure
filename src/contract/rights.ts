/**
 * Rights records (ADR-0008, CONTEXT.md "Rights record"): what each edition's
 * license lets an app do. The verdicts and their sources are in
 * research/licensing.md, and this file is their machine form. The licensed
 * editions are read through API.Bible (plan step 10, src/provider/provider.ts),
 * and `LICENSED_EDITIONS` holds everything the provider needs about each.
 *
 * No Node-only import here.
 */

import type { RawUsjElement, RawUsjNode } from '../ingest/normalize';
import { CLEAR_BSB_ATTRIBUTION, MACULA_GREEK, MACULA_HEBREW } from '../ingest/sources';

/** Where an app gets the edition's text at read time. */
export type Route =
  /** Our own files: `build/corpus.db` now, a pack from step 13. */
  | 'local'
  /** API.Bible, under its terms (research/licensing.md, closed-license translations). */
  | 'api.bible';

/**
 * How much of the edition an app may keep on a device:
 *
 * - `none`: fetch each time, keep nothing.
 * - `cache`: keep fetched chapters, refreshed within `refreshDays`.
 * - `full`: keep the whole edition.
 */
export type Offline = 'none' | 'cache' | 'full';

/**
 * What AI features may do with the text:
 *
 * - `allowed`: no license limit.
 * - `no-training`: AI features may read it, and nothing may be trained on it
 *   (API.Bible terms, section 9.2).
 * - `none`: no AI features in an app that shows it (Biblica's NIV terms).
 */
export type AiUse = 'allowed' | 'no-training' | 'none';

export interface RightsRecord {
  /** The edition's abbreviation: `KJV`. */
  readonly edition: string;
  /** The license as its holder names it: `Public Domain`, `CC BY 4.0`. */
  readonly license: string;
  /** The page that states the license. */
  readonly licenseUrl: string;
  readonly route: Route;
  readonly offline: Offline;
  /**
   * Days within which a kept copy must be checked for updates. Null when no
   * license asks. 0 keeps no copy: every read fetches (src/provider/licensed-chapters.ts).
   */
  readonly refreshDays: number | null;
  /** The most verses an app may let a reader copy, share or print at once. Null for no limit. */
  readonly copyLimit: number | null;
  /**
   * The most verses of the edition that may be kept at once. Null for no
   * limit. The provider counts the chapters it holds in memory as kept
   * (src/provider/licensed-chapters.ts) until API.Bible answers whether they
   * are (research/licensing.md, open questions). An app that keeps chapters
   * on a device counts those the same way.
   */
  readonly keepLimit: number | null;
  readonly aiUse: AiUse;
  /** The credit an app must show with the text. Null when none is required. */
  readonly attribution: string | null;
  /** Other conditions an app must keep, in plain words. */
  readonly conditions: readonly string[];
}

const publicDomain = (edition: string, licenseUrl: string, conditions: string[] = []): RightsRecord => ({
  edition,
  license: 'Public Domain',
  licenseUrl,
  route: 'local',
  offline: 'full',
  refreshDays: null,
  copyLimit: null,
  keepLimit: null,
  aiUse: 'allowed',
  attribution: null,
  conditions,
});

const API_BIBLE_TERMS = 'https://api.bible/terms-and-conditions';

/** An edition read a chapter at a time from a licensed API. */
export interface LicensedEdition {
  /** The edition's scheme (src/ingest/schemes.ts): every address it returns names it. The DB must hold it. */
  readonly scheme: string;
  /** The edition's test for a Psalm title paragraph, when it isn't `\d` (`NormalizeOptions.isTitle`). */
  readonly isTitle?: (para: RawUsjElement) => boolean;
  /** Its route, and the refresh days for which the cache and the provider both keep a chapter. */
  readonly rights: RightsRecord;
}

/** A licensed edition read through API.Bible. research/api-bible.md lists what the key reaches. */
export interface ApiBibleEdition extends LicensedEdition {
  /** API.Bible's id for the edition. */
  readonly bibleId: string;
}

/** An edition read through API.Bible, under its terms (research/licensing.md, closed-license translations). */
const apiBible = (
  api: Omit<ApiBibleEdition, 'rights'>,
  edition: string,
  license: string,
  aiUse: AiUse,
  attribution: string,
  conditions: string[],
  keepLimit: number | null = null,
): ApiBibleEdition => ({
  ...api,
  rights: {
    edition,
    license,
    licenseUrl: API_BIBLE_TERMS,
    route: 'api.bible',
    // section 11: content kept offline is checked for updates at least every 30 days
    offline: 'cache',
    refreshDays: 30,
    // section 12: no printing of more than 100 verses
    copyLimit: 100,
    keepLimit,
    aiUse,
    attribution,
    conditions: [
      ...conditions,
      'Show the text unchanged in structure and content (API.Bible terms, section 4.1).',
      'Protect kept chapters with DRM (section 12), and delete them within 72 hours if the API.Bible license ends (section 10.2).',
      'A web app reports usage through FUMS (section 3.3).',
    ],
  },
});

const plainText = (nodes: readonly RawUsjNode[]): string =>
  nodes.map((n) => (typeof n === 'string' ? n : plainText(n.content ?? []))).join('');

/**
 * NASB 1995 prints a Psalm's title as `\ms` under its `\ms PSALM 3` line, with
 * `\ms BOOK 2` above Psalm 42 (research/api-bible.md). Its 116 titles fall on
 * the Psalms where KJV prints one.
 */
const nasbTitle = (para: RawUsjElement) =>
  para.marker === 'ms' && !/^(PSALM|BOOK) \d+$/.test(plainText(para.content ?? []).trim());

/** The seven editions we hold as files. */
const LOCAL: readonly RightsRecord[] = [
  publicDomain('KJV', 'https://ebible.org/eng-kjv/copyright.htm', [
    'Printing in the UK, or importing printed copies into it, needs the Crown\'s permission. An app is not printing.',
  ]),
  publicDomain('BSB', 'https://berean.bible/licensing.htm', [
    `Strong's numbers and original words from \`words\` need the credit "${CLEAR_BSB_ATTRIBUTION}".`,
  ]),
  {
    ...publicDomain('WLC', 'https://github.com/openscriptures/morphhb/blob/3d15126fb1ef74867fc1434be1942e837932691f/LICENSE.md'),
    license: 'Public Domain (text), CC BY 4.0 (OSHB word ids, lemmas and morphology)',
    // the corpus keeps OSHB's word ids, lemmas and morphology (ADR-0003, ADR-0007), which need the credit
    attribution:
      'Original work of the Open Scriptures Hebrew Bible available at https://github.com/openscriptures/morphhb',
    conditions: [`Glosses from \`words\` need the credit "${MACULA_HEBREW.attribution}".`],
  },
  {
    ...publicDomain('SBLGNT', 'https://github.com/LogosBible/SBLGNT/blob/d7f35adca9ec410e1d1499c63b4dd989d76c8d4d/LICENSE'),
    license: 'CC BY 4.0',
    attribution: 'SBL Greek New Testament, © 2010 Society of Biblical Literature and Logos Bible Software, CC BY 4.0',
    conditions: [
      'Say that the text was converted from XML to USFM, with words and punctuation unchanged (CC BY 4.0, section 3(a)(1)(B)).',
      `Strong's numbers, lemmas, morphology and glosses from \`words\` need the credit "${MACULA_GREEK.attribution}".`,
    ],
  },
  publicDomain('RP', 'https://ebible.org/grcmt/copyright.htm'),
  publicDomain('WEB', 'https://ebible.org/eng-web/copyright.htm', [
    '"World English Bible" is a trademark. A changed text must not be called "World English Bible".',
  ]),
  publicDomain('Brenton', 'https://ebible.org/grcbrent/copyright.htm'),
];

/**
 * The licensed editions, keyed by our abbreviation, each with API.Bible's id.
 * Adding one is one entry here, plus its facts (`bun run api-bible:facts`)
 * and its derived scheme.
 */
export const LICENSED_EDITIONS: ReadonlyMap<string, ApiBibleEdition> = new Map(
  [
    apiBible(
      { bibleId: 'b8ee27bcd1cae43a-01', scheme: 'nasb95', isTitle: nasbTitle },
      'NASB95',
      'API.Bible standard license',
      'no-training',
      'NEW AMERICAN STANDARD BIBLE® NASB® Copyright © 1960,1962,1963,1968,1971,1972,1973,1975,1977,1995 by The Lockman Foundation A Corporation Not for Profit La Habra, CA All Rights Reserved www.lockman.org',
      [
        'Without a direct Lockman license, at most 1,000 verses may be quoted or stored in an electronic retrieval system, never a whole book and at most half of the work they appear in (https://www.lockman.org/permission-to-quote-copyright-trademark-information/). Keep a device\'s kept NASB chapters under that.',
      ],
      // the 1,000 verses of that condition. Its whole-book and half-of-the-work parts are not counted here
      1000,
    ),
    apiBible(
      { bibleId: 'd6e14a625393b4da-01', scheme: 'nlt' },
      'NLT',
      'API.Bible license',
      'no-training',
      'Holy Bible, New Living Translation, copyright © 1996, 2004, 2015 by Tyndale House Foundation. All rights reserved. Used by permission of Tyndale House Publishers, Carol Stream, Illinois 60188. All rights reserved.',
      ['Quote the text exactly, punctuation and capitalization included (Tyndale).'],
    ),
    apiBible(
      { bibleId: '78a9f6124f344018-01', scheme: 'niv' },
      'NIV',
      'Biblica express license through API.Bible',
      // Biblica: no AI features in an app that shows the NIV
      'none',
      'The Holy Bible, New International Version® NIV® Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.® Used by Permission of Biblica, Inc.® All rights reserved worldwide.',
      ['Non-commercial use only, and no unrestricted download (Biblica).'],
    ),
  ].map((e) => [e.rights.edition, e]),
);

/** The seven editions we hold as files and the licensed ones, keyed by abbreviation. */
export const RIGHTS: ReadonlyMap<string, RightsRecord> = new Map(
  [...LOCAL, ...[...LICENSED_EDITIONS.values()].map((e) => e.rights)].map((r) => [r.edition, r]),
);

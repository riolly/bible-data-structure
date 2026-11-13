/**
 * Rights records (ADR-0008, CONTEXT.md "Rights record"): what each edition's
 * license lets an app do. The verdicts and their sources are in
 * research/licensing.md, and this file is their machine form. Step 10 adds the
 * licensed editions and the API.Bible route.
 *
 * No Node-only import here.
 */

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
  /** Days within which a kept copy must be checked for updates. Null when no license asks. */
  readonly refreshDays: number | null;
  /** The most verses an app may let a reader copy, share or print at once. Null for no limit. */
  readonly copyLimit: number | null;
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
  aiUse: 'allowed',
  attribution: null,
  conditions,
});

/** The seven editions we hold as files, keyed by abbreviation. */
export const RIGHTS: ReadonlyMap<string, RightsRecord> = new Map(
  [
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
  ].map((r) => [r.edition, r]),
);

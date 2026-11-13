/**
 * Build-time corpus ingest (ADR-0001, ADR-0002, ADR-0006): USFM, the scheme
 * registry and TVTMS → SQLite.
 *
 *   bun run ingest:download   # once: fetch + verify pinned sources and TVTMS
 *   bun run ingest            # → build/corpus.db, build/mapping-diff.tsv, build/pivot.json
 *
 * Translation-agnostic: every SOURCES entry runs through the same
 * parse (usfm-grammar → USJ) → normalize → write pipeline. The outputs in
 * build/ are generated and gitignored.
 */

import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IngestStats, WordTag } from './normalize';
import { PIVOT, checkCoverage } from '../model/mapping';
import type { Scheme } from '../model/scheme';
import { loadSchemes } from './schemes';
import { checkBook } from './book-check';
import type { ParseOutcome } from './parse';
import { createParsePool, type ParsePool } from './parse-pool';
import { CLEAR_BSB, KJV_TAGS, MACULA_GREEK, MACULA_HEBREW, SOURCES, type PinnedFile, type SourceDef } from './sources';
import { alignWords, readClearAlignment, readClearWords } from './alignment';
import { linkVerseTags, type HubWord, type TagStats } from './kjv-tags';
import { loadMappings } from '../db/corpus-read';
import { SOURCES_ROOT, readSource } from './source-files';
import { checkReadings } from './oshb-xml';
import {
  GREEK_EXCEPTIONS,
  checkExceptionsUsed,
  greekWords,
  hebrewWords,
  readMacula,
  type HubPart,
  type MaculaWord,
} from './original-words';
import { textStamp, wordsStamp } from './edition';
import { RIGHTS } from '../contract/rights';
import { factsText, loadEditionFacts } from '../provider/edition-facts';
import { checkExtendOnly, formatPivotSnapshot, pivotSnapshot, type PivotSnapshot } from './pivot';
import {
  TVTMS_PATH,
  addBookText,
  compileMappings,
  compilePivot,
  editionText,
  editionTextSnapshot,
  readTvtms,
  type EditionText,
  type TvtmsRow,
} from './tvtms';
import {
  createCorpusDb,
  createIndexes,
  type CorpusDb,
  insertBookRows,
  insertOriginalWords,
  insertReadings,
  insertTranslation,
  insertMappings,
  insertWordAlignments,
  setStamps,
  seedBooksAndCanons,
  seedSchemes,
} from './write-db';

const OUT_DIR = join(import.meta.dirname, '..', '..', 'build');
const OUT_PATH = join(OUT_DIR, 'corpus.db');
const PIVOT_SNAPSHOT = join(import.meta.dirname, 'fixtures', 'pivot.json');
const EDITION_TEXT_SNAPSHOT = join(import.meta.dirname, 'fixtures', 'edition-text.json');

const addStats = (into: Record<string, number>, from: IngestStats) => {
  for (const [k, v] of Object.entries(from)) {
    if (typeof v === 'number') into[k] = (into[k] ?? 0) + v;
  }
};

async function main() {
  const mainStarted = performance.now();
  mkdirSync(OUT_DIR, { recursive: true });
  rmSync(OUT_PATH, { force: true });
  const { db, sqlite } = createCorpusDb(OUT_PATH, { deferIndexes: true });
  seedBooksAndCanons(db);
  const schemes = loadSchemes();
  const tvtms = readTvtmsOrExplain();
  // The pivot reads no edition text, so the scheme rows go in before the editions.
  const { pivot } = compilePivot(schemes, tvtms);
  checkPivotGrowth(pivot);
  seedSchemes(db, new Map(schemes).set(PIVOT, pivot));
  /** Each scheme's editions, for TVTMS's text tests (ADR-0006 amendment). */
  const texts = new Map<string, EditionText[]>();
  const editions: { scheme: string; text: EditionText }[] = [];
  /** Every MACULA morpheme and Greek word id, to the original word it is part of: what Clear's alignments point at. */
  const hubParts = new Map<string, HubPart>();
  /** The KJV's `\w strong=` tags by book, for `alignKjv`. */
  const kjvTags = new Map<string, WordTag[]>();

  // Parse one edition ahead: the workers parse the next edition's books while
  // this thread normalizes and writes the current one.
  const pool = createParsePool(join(OUT_DIR, 'usj-cache'));
  const prepared = new Map<number, ReturnType<typeof prepareSource>>();
  const prepare = (i: number) => {
    if (!prepared.has(i)) prepared.set(i, prepareSource(SOURCES[i], pool));
    return prepared.get(i)!;
  };
  try {
    for (const [i, src] of SOURCES.entries()) {
      const started = performance.now();
      const scheme = schemes.get(src.meta.scheme);
      if (!scheme) throw new Error(`${src.meta.abbrev}: unknown scheme "${src.meta.scheme}"`);
      const { edition, files, readings, oshbVerses, outcomes } = prepare(i);
      // A source that fails to prepare throws again when its turn comes, so errors keep source order.
      if (i + 1 < SOURCES.length) try { prepare(i + 1); } catch {}
      // The hub texts get their original words (plan step 11): OSHB's own for WLC, MACULA's for SBLGNT.
      const hub = src.format?.kind === 'oshb-xml' ? MACULA_HEBREW : src.format?.kind === 'sblgnt-xml' ? MACULA_GREEK : null;
      const macula = hub ? readMaculaOrExplain(hub) : null;
      const owTotals = { words: 0, noGloss: 0 };
      const greekUsed = new Set<string>();
      const rights = RIGHTS.get(src.meta.abbrev);
      if (!rights) throw new Error(`${src.meta.abbrev}: no rights record in src/contract/rights.ts`);
      const translationId = insertTranslation(db, { ...src.meta, license: rights.license, edition });
      const words = wordsStamp();
      const chapters = textStamp();
      const text = editionText(src.meta.abbrev);
      texts.set(scheme.id, [...(texts.get(scheme.id) ?? []), text]);
      editions.push({ scheme: scheme.id, text });
      console.log(`\n${src.meta.abbrev} — edition ${edition}`);
      for (const fix of src.textFixes ?? []) console.log(`  text fix ×${fix.count}: ${JSON.stringify(fix.find)} (${fix.why})`);

      const totals: Record<string, number> = {};
      let blockCount = 0;
      let tokenCount = 0;
      let chapterCount = 0;
      // One transaction per edition, held open across awaits: each book is
      // written as soon as it is parsed, in book order.
      sqlite.exec('BEGIN');
      try {
        for (const [j, file] of files.entries()) {
          const checked = checkBook(file.code, JSON.parse(await outcomes[j]) as ParseOutcome, scheme, {
            wordTags: src.meta.abbrev === KJV_TAGS.edition,
          });
          for (const w of checked.warnings) console.warn(`  ⚠ ${w.text}`);
          if (!checked.ok) throw checked.error;
          const { docs, blocks, tokens, verses, stats } = checked.rows;
          if (checked.rows.wordTags.length > 0) kjvTags.set(file.code, checked.rows.wordTags);
          chapters.add(file.code, insertBookRows(db, { translationId, book: file.code }, { docs, verses, blocks, tokens }));
          const bookReadings = readings.filter((r) => r.book === file.code);
          checkReadings(file.code, bookReadings, tokens);
          insertReadings(db, translationId, 'oshb', bookReadings);
          if (macula) {
            const { words: ow, stats, morphemes } =
              hub === MACULA_HEBREW
                ? hebrewWords(file.code, tokens, oshbVerses.filter((v) => v.book === file.code), bookReadings, macula)
                : { ...greekWords(file.code, tokens, macula, GREEK_EXCEPTIONS, greekUsed), morphemes: [] };
            for (const [id, part] of morphemes) hubParts.set(id, part);
            if (hub === MACULA_GREEK) {
              for (const w of ow) hubParts.set(w.owId, { source: 'macula-greek', owId: w.owId, strongs: w.strongs });
            }
            insertOriginalWords(db, translationId, hub === MACULA_HEBREW ? 'oshb' : MACULA_GREEK.id, ow);
            owTotals.words += ow.length;
            owTotals.noGloss += stats.noGloss;
          }
          addBookText(text, file.code, blocks, tokens, verses);
          words.add(file.code, tokens, verses);
          addStats(totals, stats);
          blockCount += blocks.length;
          tokenCount += tokens.length;
          chapterCount += docs.length;
        }
        if (hub === MACULA_GREEK) checkExceptionsUsed(GREEK_EXCEPTIONS, greekUsed);
        setStamps(db, translationId, { words: words.digest(), text: chapters.digest() });
        sqlite.exec('COMMIT');
        prepared.delete(i); // free this edition's parse results
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
      console.log(`  ${blockCount} blocks, ${tokenCount} tokens, words stamp ${words.digest()}, text stamp ${chapters.digest()}`);
      if (readings.length > 0) console.log(`  ${readings.length} qere readings (ADR-0007)`);
      if (hub) {
        console.log(`  ${owTotals.words} original words, glosses from ${hub.id}: ${owTotals.noGloss} read words have none`);
      }
      console.log(`  ${chapterCount} chapter documents; counted in them: ${JSON.stringify(totals)}`);
      console.log(`  ${seconds(started)}`);
    }
  } finally {
    await pool.close();
  }
  console.log(`\nparses: ${pool.counts.parsed} fresh, ${pool.counts.hits} from ${join(OUT_DIR, 'usj-cache')}`);

  alignBsb(db, sqlite, hubParts);

  // The licensed editions have no text here, only their committed facts (plan
  // step 10), which give TVTMS's text tests what they read.
  for (const { scheme, facts } of loadEditionFacts()) {
    if (!schemes.has(scheme)) throw new Error(`${facts.edition}: unknown scheme "${scheme}"`);
    const text = factsText(facts);
    texts.set(scheme, [...(texts.get(scheme) ?? []), text]);
    editions.push({ scheme, text });
  }

  // The snapshot first: when writeMappings stops on a conflict, it is what to look at.
  writeEditionTextSnapshot(editions, tvtms);
  writeMappings(db, schemes, tvtms, texts);
  alignKjv(db, sqlite, kjvTags);

  // No VACUUM: a database that was only inserted into has no free pages to reclaim.
  const finishStarted = performance.now();
  createIndexes(sqlite);
  sqlite.exec('ANALYZE;');
  sqlite.close();
  console.log(`indexes and ANALYZE ${seconds(finishStarted)}`);
  console.log(`\n✓ wrote ${OUT_PATH} in ${seconds(mainStarted)}`);
}

const seconds = (since: number) => `${((performance.now() - since) / 1000).toFixed(1)} s`;

/**
 * Read a source's files, stamp its edition, apply its text fixes and queue
 * its parses. A parse failure surfaces when its book's turn comes, so errors
 * still stop the ingest in book order.
 */
function prepareSource(src: SourceDef, pool: ParsePool) {
  const { edition, files, readings, oshbVerses } = readSource(src);
  if (edition !== src.edition) {
    throw new Error(`${src.meta.abbrev}: the files give edition ${edition}, not the pinned ${src.edition}; run bun run ingest:download`);
  }
  const outcomes = files.map((f) => pool.parse(f.usfm, { rewriteVersifiedD: src.rewriteVersifiedD }));
  for (const o of outcomes) o.catch(() => {}); // awaited later; keep an early rejection from counting as unhandled
  return { edition, files, readings, oshbVerses, outcomes };
}

/**
 * Compile the mappings with every edition's text (ADR-0006), stop if an
 * edition's own results disagree with its scheme's rows, and write them.
 */
function writeMappings(
  db: CorpusDb,
  schemes: ReadonlyMap<string, Scheme>,
  tvtms: readonly TvtmsRow[],
  texts: ReadonlyMap<string, readonly EditionText[]>,
) {
  const { pivot, rows: mappingRows, perScheme, diff, conflicts } = compileMappings(schemes, tvtms, texts);
  if (conflicts.size > 0) {
    const lines = [...conflicts].flatMap(([ed, ls]) => ls.slice(0, 10).map((l) => `${ed}: ${l}`));
    throw new Error(
      `an edition's text maps verses differently from its scheme; give it a derived scheme (ADR-0002):\n  ${lines.join('\n  ')}`,
    );
  }
  console.log('');
  insertMappings(db, mappingRows);
  console.log(`schemes: ${[...schemes.keys()].join(', ')} + ${PIVOT}`);
  for (const s of schemes.values()) {
    const c = perScheme.get(s.id)!;
    const own = mappingRows.filter((r) => r.scheme === s.id);
    const fromVrs = own.filter((r) => r.source === 'vrs').length;
    const lines = diff.get(s.id);
    const witness = lines ? `${lines.length} verses where the witnesses disagree` : 'no .vrs witness';
    console.log(
      `  ${s.id}: ${own.length - fromVrs} TVTMS rows, ${fromVrs} .vrs rows; ${c.needsText.length} TVTMS rows its editions' text can't decide; ${witness}`,
    );
    const problems = checkCoverage(s, pivot, mappingRows);
    if (problems.length > 0) console.warn(`  ⚠ ${s.id}: ${problems.length} verse(s) map outside the pivot: ${problems.slice(0, 3).join('; ')}`);
  }
  const diffPath = join(OUT_DIR, 'mapping-diff.tsv');
  writeFileSync(diffPath, [...diff].flatMap(([id, lines]) => lines.map((l) => `${id}\t${l}`)).join('\n') + '\n');
  console.log(`  witness diff → ${diffPath}`);
}

/**
 * The facts the text tests read, for the committed fixture tvtms.test.ts uses.
 * Copy build/edition-text.json over the fixture when an edition changes.
 */
function writeEditionTextSnapshot(editions: readonly { scheme: string; text: EditionText }[], tvtms: readonly TvtmsRow[]) {
  const json = JSON.stringify(editionTextSnapshot(editions, tvtms), null, 1) + '\n';
  const path = join(OUT_DIR, 'edition-text.json');
  writeFileSync(path, json);
  if (!existsSync(EDITION_TEXT_SNAPSHOT) || json !== readFileSync(EDITION_TEXT_SNAPSHOT, 'utf8')) {
    console.warn(`  ⚠ ${path} differs from ${EDITION_TEXT_SNAPSHOT}: copy it over to update the tests`);
  }
}

function readMaculaOrExplain(pin: PinnedFile): Map<string, MaculaWord[]> {
  const path = join(SOURCES_ROOT, pin.file);
  if (!existsSync(path)) throw new Error(`${path} is missing: run \`bun run ingest:download\` first`);
  return readMacula(path);
}

/**
 * The BSB's alignment to the step 11 words, from Clear Bible (plan step 12).
 * Runs after the hub texts, which come after the BSB in SOURCES.
 */
function alignBsb(db: CorpusDb, sqlite: ReturnType<typeof createCorpusDb>['sqlite'], hubParts: ReadonlyMap<string, HubPart>) {
  const started = performance.now();
  const files = [CLEAR_BSB.greek, CLEAR_BSB.hebrew, CLEAR_BSB.ntWords, CLEAR_BSB.otWords].map((f) => join(SOURCES_ROOT, f.file));
  for (const path of files) if (!existsSync(path)) throw new Error(`${path} is missing: run \`bun run ingest:download\` first`);
  const { id } = sqlite.prepare(`SELECT id FROM translation WHERE abbrev = 'BSB'`).get() as { id: number };
  const ours = new Map<string, string[]>();
  const tokens = sqlite
    .prepare(
      `SELECT book, chapter, verse, segment, text FROM token WHERE translation_id = ? AND word_index IS NOT NULL
       ORDER BY book, chapter, verse, segment, word_index`,
    )
    .all(id) as { book: string; chapter: number; verse: number; segment: string; text: string }[];
  for (const t of tokens) {
    const key = `${t.book} ${t.chapter}:${t.verse}${t.segment}`;
    (ours.get(key) ?? ours.set(key, []).get(key)!).push(t.text);
  }
  const { rows, stats } = alignWords(ours, readClearWords(files.slice(2)), readClearAlignment(files.slice(0, 2)), hubParts);
  sqlite.exec('BEGIN');
  insertWordAlignments(db, id, CLEAR_BSB.id, rows);
  sqlite.exec('COMMIT');
  console.log(
    `\nBSB alignment (${CLEAR_BSB.id}): ${stats.aligned} of ${stats.words} words aligned, ${rows.length} rows; ` +
      `${stats.unaligned} Clear leaves unaligned, ${stats.changed} not in Clear's revision, ` +
      `${stats.split} whose Clear group didn't join; ${seconds(started)}`,
  );
}

/**
 * The KJV's checked word tags (ADR-0003, KJV amendment): each tag links to an
 * original word of the WLC or SBLGNT verse its KJV verse maps to. Runs after
 * the mappings are written, since it reads them.
 */
function alignKjv(db: CorpusDb, sqlite: ReturnType<typeof createCorpusDb>['sqlite'], tagsByBook: ReadonlyMap<string, readonly WordTag[]>) {
  const started = performance.now();
  const kjv = sqlite.prepare(`SELECT id, scheme FROM translation WHERE abbrev = ?`).get(KJV_TAGS.edition) as { id: number; scheme: string };
  const hubs = sqlite.prepare(`SELECT DISTINCT scheme FROM translation WHERE abbrev IN ('WLC', 'SBLGNT')`).all() as { scheme: string }[];
  if (hubs.length !== 1) throw new Error(`KJV tags: WLC and SBLGNT must share one scheme, not ${hubs.map((h) => h.scheme).join(', ')}`);
  const hubScheme = hubs[0].scheme;
  const hubWords = new Map<string, HubWord[]>();
  const words = sqlite
    .prepare(
      `SELECT o.book, o.chapter, o.verse, o.source, o.ow_id AS owId, o.kind, o.strongs FROM original_word o
       JOIN translation t ON t.id = o.translation_id WHERE t.abbrev IN ('WLC', 'SBLGNT')
       ORDER BY o.book, o.chapter, o.verse, o.segment, o.seq`,
    )
    .all() as { book: string; chapter: number; verse: number; source: HubWord['source']; owId: string; kind: HubWord['kind']; strongs: string }[];
  for (const w of words) {
    const key = `${w.book} ${w.chapter}:${w.verse}`;
    const word: HubWord = { source: w.source, owId: w.owId, kind: w.kind, strongs: w.strongs ? w.strongs.split(' ') : [] };
    (hubWords.get(key) ?? hubWords.set(key, []).get(key)!).push(word);
  }
  const wordCounts = new Map(
    (
      sqlite
        .prepare(
          `SELECT book, chapter, verse, segment, count(*) AS n FROM token WHERE translation_id = ? AND word_index IS NOT NULL
           GROUP BY book, chapter, verse, segment`,
        )
        .all(kjv.id) as { book: string; chapter: number; verse: number; segment: string; n: number }[]
    ).map((r) => [`${r.book} ${r.chapter}:${r.verse}${r.segment}`, r.n]),
  );
  const mappings = loadMappings(db);
  const stats: TagStats = { tags: 0, passed: 0, unmapped: 0 };
  const rows = [];
  for (const [book, tags] of tagsByBook) {
    const units = new Map<string, WordTag[]>();
    for (const t of tags) {
      const key = `${t.chapter}:${t.verse}${t.segment}`;
      (units.get(key) ?? units.set(key, []).get(key)!).push(t);
    }
    for (const unitTags of units.values()) {
      const { chapter, verse, segment } = unitTags[0];
      const unit = { book, chapter, verse, segment };
      const targets = [...new Set(mappings.map(kjv.scheme, hubScheme, unit).map((r) => `${r.book} ${r.chapter}:${r.verse}`))];
      const wordCount = wordCounts.get(`${book} ${chapter}:${verse}${segment}`) ?? 0;
      rows.push(...linkVerseTags(unit, wordCount, unitTags, targets.flatMap((k) => hubWords.get(k) ?? []), stats));
    }
  }
  const failed = stats.tags - stats.passed - stats.unmapped;
  if (failed > MAX_TAG_FAILURES) {
    throw new Error(`KJV tags: ${failed} tags name no word of their mapped verse, more than ${MAX_TAG_FAILURES}. Check the KJV source and the mappings`);
  }
  sqlite.exec('BEGIN');
  insertWordAlignments(db, kjv.id, KJV_TAGS.id, rows);
  sqlite.exec('COMMIT');
  const tagged = new Set(rows.map((r) => `${r.book} ${r.chapter}:${r.verse}${r.segment}!${r.wordIndex}`)).size;
  console.log(
    `\nKJV tags (${KJV_TAGS.id}): ${stats.passed} of ${stats.tags} pass, ${failed} name no word of their mapped verse, ` +
      `${stats.unmapped} are in verses that map to none; ${rows.length} rows on ${tagged} words; ${seconds(started)}`,
  );
}

/** The ingest stops when more KJV tags than this fail the check: 6,039 failed on 2026-11-13. */
const MAX_TAG_FAILURES = 6500;

function readTvtmsOrExplain(): TvtmsRow[] {
  if (!existsSync(TVTMS_PATH)) throw new Error(`${TVTMS_PATH} is missing: run \`bun run ingest:download\` first`);
  return readTvtms();
}

/**
 * ADR-0006: the pivot only grows. Compare with the committed previous build
 * (fixtures/pivot.json) and stop on any removal. The new pivot is written to
 * build/pivot.json; copy it over the fixture to accept growth.
 */
function checkPivotGrowth(pivot: Scheme) {
  const next = pivotSnapshot(pivot);
  writeFileSync(join(OUT_DIR, 'pivot.json'), formatPivotSnapshot(next));
  const prev = JSON.parse(readFileSync(PIVOT_SNAPSHOT, 'utf8')) as PivotSnapshot;
  const violations = checkExtendOnly(prev, next);
  if (violations.length > 0) throw new Error(`the pivot shrank:\n  ${violations.slice(0, 10).join('\n  ')}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});

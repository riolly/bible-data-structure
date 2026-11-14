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
import { KJV_TAGS, SOURCES, type SourceDef } from './sources';
import { clearBsbAligner, kjvTagAligner, runAlignment, type Aligner } from './alignment-pass';
import { pinnedPath, readSource } from './source-files';
import type { HubIndex } from './source-formats';
import { writeEdition } from './edition-writer';
import { RIGHTS } from '../contract/rights';
import { factsText, loadEditionFacts } from '../provider/edition-facts';
import { checkExtendOnly, formatPivotSnapshot, pivotSnapshot, type PivotSnapshot } from './pivot';
import {
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
  insertMappings,
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
  const tvtms = readTvtms();
  // The pivot reads no edition text, so the scheme rows go in before the editions.
  const { pivot } = compilePivot(schemes, tvtms);
  checkPivotGrowth(pivot);
  seedSchemes(db, new Map(schemes).set(PIVOT, pivot));
  /** Each scheme's editions, for TVTMS's text tests (ADR-0006 amendment). */
  const texts = new Map<string, EditionText[]>();
  const editions: { scheme: string; text: EditionText }[] = [];
  /** What Clear's alignments point at, filled by the hub texts' format adapters. */
  const hubParts: HubIndex = new Map();
  /** The KJV's `\w strong=` tags by book, for its aligner. */
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
      const { edition, files, open, outcomes } = prepare(i);
      // A source that fails to prepare throws again when its turn comes, so errors keep source order.
      if (i + 1 < SOURCES.length) try { prepare(i + 1); } catch {}
      // The format's by-products: the hub texts' readings and original words (plan step 11).
      const extras = open(hubParts);
      let summary: string[] = [];
      const rights = RIGHTS.get(src.meta.abbrev);
      if (!rights) throw new Error(`${src.meta.abbrev}: no rights record in src/contract/rights.ts`);
      const text = editionText(src.meta.abbrev);
      texts.set(scheme.id, [...(texts.get(scheme.id) ?? []), text]);
      editions.push({ scheme: scheme.id, text });
      const totals: Record<string, number> = {};
      let blockCount = 0;
      let tokenCount = 0;
      let chapterCount = 0;
      // One transaction per edition, held open across awaits: each book is
      // written as soon as it is parsed, in book order.
      const meta = { ...src.meta, license: rights.license, edition };
      const stamps = await writeEdition(db, meta, files.map((f) => f.code), async (writer) => {
        console.log(`\n${src.meta.abbrev} — edition ${edition}`);
        for (const fix of src.textFixes ?? []) console.log(`  text fix ×${fix.count}: ${JSON.stringify(fix.find)} (${fix.why})`);
        for (const [j, file] of files.entries()) {
          const checked = checkBook(file.code, JSON.parse(await outcomes[j]) as ParseOutcome, scheme, {
            wordTags: src.meta.abbrev === KJV_TAGS.edition,
          });
          for (const w of checked.warnings) console.warn(`  ⚠ ${w.text}`);
          if (!checked.ok) throw checked.error;
          const { docs, blocks, tokens, verses, stats } = checked.rows;
          if (checked.rows.wordTags.length > 0) kjvTags.set(file.code, checked.rows.wordTags);
          extras.addBook(writer, file.code, checked.rows);
          addBookText(text, file.code, blocks, tokens, verses);
          addStats(totals, stats);
          blockCount += blocks.length;
          tokenCount += tokens.length;
          chapterCount += docs.length;
        }
        summary = extras.finish();
      });
      prepared.delete(i); // free this edition's parse results
      console.log(`  ${blockCount} blocks, ${tokenCount} tokens, words stamp ${stamps.words}, text stamp ${stamps.text}`);
      for (const line of summary) console.log(`  ${line}`);
      console.log(`  ${chapterCount} chapter documents; counted in them: ${JSON.stringify(totals)}`);
      console.log(`  ${seconds(started)}`);
    }
  } finally {
    await pool.close();
  }
  console.log(`\nparses: ${pool.counts.parsed} fresh, ${pool.counts.hits} from ${join(OUT_DIR, 'usj-cache')}`);

  // after every edition: the hub texts, which come after the BSB in SOURCES, have filled the hub index
  align(db, clearBsbAligner(hubParts, (pin) => pinnedPath(pin)));

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
  // after writeMappings: the KJV's tags meet the hub verses their verses map to
  align(db, kjvTagAligner(kjvTags));

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
  const { edition, files, open } = readSource(src);
  if (edition !== src.edition) {
    throw new Error(`${src.meta.abbrev}: the files give edition ${edition}, not the pinned ${src.edition}; run \`bun run ingest:download\``);
  }
  const outcomes = files.map((f) => pool.parse(f.usfm, { rewriteVersifiedD: src.rewriteVersifiedD }));
  for (const o of outcomes) o.catch(() => {}); // awaited later; keep an early rejection from counting as unhandled
  return { edition, files, open, outcomes };
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
  const { pivot, rows: mappingRows, dropped, perScheme, diff, conflicts } = compileMappings(schemes, tvtms, texts);
  if (conflicts.size > 0) {
    const lines = [...conflicts].flatMap(([ed, ls]) => ls.slice(0, 10).map((l) => `${ed}: ${l}`));
    throw new Error(
      `an edition's text maps verses differently from its scheme; give it a derived scheme (ADR-0002):\n  ${lines.join('\n  ')}`,
    );
  }
  console.log('');
  insertMappings(db, mappingRows);
  if (dropped.length > 0) {
    const verses = new Map<string, string>();
    for (const { row: r, reason } of dropped) verses.set(`${r.scheme} ${r.from.book} ${r.from.chapter}:${r.from.verse}`, reason);
    console.log(`  ${dropped.length} TVTMS rows name a part no edition prints, in ${verses.size} verses:`);
    for (const [verse, reason] of verses) console.log(`    ${verse}: ${reason}`);
  }
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

/** Align one edition (alignment-pass.ts) and log its summary. */
function align(db: CorpusDb, aligner: Aligner) {
  const started = performance.now();
  console.log(`\n${runAlignment(db, aligner)}; ${seconds(started)}`);
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

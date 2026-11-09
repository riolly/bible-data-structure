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

import { existsSync, readdirSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IngestStats } from './normalize';
import { PIVOT, checkCoverage } from '../model/mapping';
import { checkVerses, type Scheme } from '../model/scheme';
import { loadSchemes } from './schemes';
import { computeEdition, type SourceFile } from './edition';
import { normalizeUsj } from './normalize';
import { usjBookCode, type ParseOutcome } from './parse';
import { createParsePool, type ParsePool } from './parse-pool';
import { SOURCES, type SourceDef } from './sources';
import { applyTextFixes } from './text-fixes';
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
  insertTranslation,
  insertMappings,
  seedBooksAndCanons,
  seedSchemes,
} from './write-db';

const SOURCES_ROOT = join(import.meta.dirname, 'sources');
const OUT_DIR = join(import.meta.dirname, '..', '..', 'build');
const OUT_PATH = join(OUT_DIR, 'corpus.db');
const PIVOT_SNAPSHOT = join(import.meta.dirname, 'fixtures', 'pivot.json');
const EDITION_TEXT_SNAPSHOT = join(import.meta.dirname, 'fixtures', 'edition-text.json');

/** The source's listed books, in its order. Files for other books (FRT, GLO, …) are skipped. */
function readSourceFiles(src: SourceDef): SourceFile[] {
  const root = join(SOURCES_ROOT, src.dir);
  const wanted = new Set(src.books);
  const byCode = new Map<string, SourceFile>();
  for (const name of readdirSync(root)) {
    if (!name.toLowerCase().endsWith('.usfm')) continue;
    const usfm = readFileSync(join(root, name), 'utf8');
    const code = usfm.match(/^\\id (\w{3})/)?.[1];
    if (!code || !wanted.has(code)) continue;
    if (byCode.has(code)) throw new Error(`${src.dir}: two files for ${code}`);
    byCode.set(code, { code, usfm });
  }
  const missing = src.books.filter((c) => !byCode.has(c));
  if (missing.length > 0) throw new Error(`${src.dir}: no file for ${missing.join(', ')}`);
  return src.books.map((c) => byCode.get(c)!);
}

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
      const { edition, files, outcomes } = prepare(i);
      // A source that fails to prepare throws again when its turn comes, so errors keep source order.
      if (i + 1 < SOURCES.length) try { prepare(i + 1); } catch {}
      const translationId = insertTranslation(db, { ...src.meta, edition });
      const text = editionText(src.meta.abbrev);
      texts.set(scheme.id, [...(texts.get(scheme.id) ?? []), text]);
      editions.push({ scheme: scheme.id, text });
      console.log(`\n${src.meta.abbrev} — edition ${edition}`);
      for (const fix of src.textFixes ?? []) console.log(`  text fix ×${fix.count}: ${JSON.stringify(fix.find)} (${fix.why})`);

      const totals: Record<string, number> = {};
      let blockCount = 0;
      let tokenCount = 0;
      // One transaction per edition, held open across awaits: each book is
      // written as soon as it is parsed, in book order.
      sqlite.exec('BEGIN');
      try {
        for (const [j, file] of files.entries()) {
          const { usj, parseErrors, versifiedTitleRewrites } = JSON.parse(await outcomes[j]) as ParseOutcome;
          if (versifiedTitleRewrites > 0) {
            console.warn(
              `  ⚠ ${file.code}: ${versifiedTitleRewrites} versified \\d title(s) rewritten to \\qd (grammar gap, see parse.ts)`,
            );
          }
          if (parseErrors.length > 0) {
            console.warn(
              `  ⚠ ${file.code}: usfm-grammar strict parse failed, ingested with ignoreErrors —\n` +
                parseErrors.map((e) => `      ${e}`).join('\n'),
            );
          }
          const usjCode = usjBookCode(usj);
          if (usjCode !== file.code) {
            throw new Error(`${file.code}: USJ book code mismatch ("${usjCode}")`);
          }
          const { blocks, tokens, stats } = normalizeUsj(usj);
          validate(file.code, blocks.length, tokens);
          warnVerseGaps(file.code, tokens);
          checkScheme(scheme, file.code, tokens);
          insertBookRows(db, { translationId, book: file.code }, { blocks, tokens });
          addBookText(text, file.code, blocks, tokens);
          addStats(totals, stats);
          blockCount += blocks.length;
          tokenCount += tokens.length;
        }
        sqlite.exec('COMMIT');
        prepared.delete(i); // free this edition's parse results
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
      console.log(`  ${blockCount} blocks, ${tokenCount} tokens`);
      console.log(`  not modelled in Phase 1 (dropped/unwrapped, counted): ${JSON.stringify(totals)}`);
      console.log(`  ${seconds(started)}`);
    }
  } finally {
    await pool.close();
  }
  console.log(`\nparses: ${pool.counts.parsed} fresh, ${pool.counts.hits} from ${join(OUT_DIR, 'usj-cache')}`);

  // The snapshot first: when writeMappings stops on a conflict, it is what to look at.
  writeEditionTextSnapshot(editions, tvtms);
  writeMappings(db, schemes, tvtms, texts);

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
  const raw = readSourceFiles(src);
  const edition = computeEdition(raw);
  const files = applyTextFixes(raw, src.textFixes);
  const outcomes = files.map((f) => pool.parse(f.usfm, { rewriteVersifiedD: src.rewriteVersifiedD }));
  for (const o of outcomes) o.catch(() => {}); // awaited later; keep an early rejection from counting as unhandled
  return { edition, files, outcomes };
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

/**
 * Every verse an edition has must exist in its declared scheme (ADR-0002), or
 * its addresses would name verses the scheme lacks. A chapter that ends early
 * only warns: an edition may omit verses, and a verse bridge stores only its
 * first number (ADR-0004 rule 6).
 */
function checkScheme(scheme: Scheme, code: string, tokens: { chapter: number; verse: number | null }[]) {
  const verses = tokens.flatMap((t) => (t.verse == null ? [] : [{ chapter: t.chapter, verse: t.verse }]));
  const { unknown, short } = checkVerses(scheme, code, verses);
  if (unknown.length > 0) {
    const list = unknown.map((v) => `${v.chapter}:${v.verse}`).join(', ');
    throw new Error(`${code}: verses not in scheme ${scheme.id}: ${list}`);
  }
  for (const s of short) {
    console.warn(`  ⚠ ${code} ${s.chapter}: ends at verse ${s.last}, scheme ${scheme.id} has ${s.expected}`);
  }
}

/** Corpus invariants (CONTEXT.md) — fail the build, not the reader. */
function validate(code: string, blockCount: number, tokens: { blockId: number; verse: number | null; wordIndex: number | null; text: string; kind: string }[]) {
  const usedBlocks = new Set<number>();
  for (const t of tokens) {
    if (t.blockId < 0 || t.blockId >= blockCount) {
      throw new Error(`${code}: token references unknown block ${t.blockId}`);
    }
    usedBlocks.add(t.blockId);
    if (/\s/.test(t.text) || t.text.length === 0) {
      throw new Error(`${code}: whitespace leaked into token text ${JSON.stringify(t.text)}`);
    }
    if (t.verse === 0) throw new Error(`${code}: verse 0 sentinel — heading tokens must carry NULL`);
    if (t.verse == null && t.wordIndex != null) {
      throw new Error(`${code}: non-verse token carries a word_index`);
    }
    if (t.kind === 'punct' && t.wordIndex != null) {
      throw new Error(`${code}: punct token carries a word_index`);
    }
  }
  if (usedBlocks.size !== blockCount) {
    throw new Error(`${code}: ${blockCount - usedBlocks.size} empty block(s) break the partition`);
  }
}

/**
 * Non-fatal coverage check: a hole in 1..max(verse) per chapter usually means
 * the parser dropped text (a real translation may also legitimately omit
 * late-manuscript verses — hence warn, not throw; a human reads the log).
 */
function warnVerseGaps(code: string, tokens: { chapter: number; verse: number | null }[]) {
  const byChapter = new Map<number, Set<number>>();
  for (const t of tokens) {
    if (t.verse == null) continue;
    (byChapter.get(t.chapter) ?? byChapter.set(t.chapter, new Set()).get(t.chapter)!).add(t.verse);
  }
  for (const [chapter, verses] of byChapter) {
    const max = Math.max(...verses);
    const missing = [];
    for (let v = 1; v <= max; v++) if (!verses.has(v)) missing.push(v);
    if (missing.length > 0) {
      console.warn(`  ⚠ ${code} ${chapter}: no tokens for verse(s) ${missing.join(', ')}`);
    }
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});

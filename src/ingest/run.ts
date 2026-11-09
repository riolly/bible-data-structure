/**
 * Build-time corpus ingest (issue #6, ADR-0001): USFM → bundled SQLite.
 *
 *   pnpm ingest:download   # once: fetch + verify pinned sources
 *   pnpm ingest            # sources → build/corpus.db
 *
 * Translation-agnostic: every SOURCES entry runs through the same
 * parse (usfm-grammar → USJ) → normalize → write pipeline. The output
 * corpus.db is a generated build artifact (gitignored) that Metro bundles as
 * an asset; run this before a native/dev build that renders scripture.
 */

import { readdirSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { IngestStats } from './normalize';
import { PROTESTANT, canonBookCodes } from '../model/canon';
import { PIVOT, checkCoverage } from '../model/mapping';
import { checkVerses, type Scheme } from '../model/scheme';
import { loadSchemes } from './schemes';
import { computeEdition, type SourceFile } from './edition';
import { normalizeUsj } from './normalize';
import { usfmToUsj, usjBookCode } from './parse';
import { SOURCES } from './sources';
import { allVrsPivotRows, buildPivot } from './pivot';
import {
  createCorpusDb,
  insertBookRows,
  insertTranslation,
  insertMappings,
  seedBooksAndCanons,
  seedSchemes,
} from './write-db';

const SOURCES_ROOT = join(import.meta.dirname, 'sources');
const OUT_DIR = join(import.meta.dirname, '..', '..', 'build');
const OUT_PATH = join(OUT_DIR, 'corpus.db');

/** The books every bundled edition must have, in canon order. */
const EXPECTED_BOOKS = canonBookCodes(PROTESTANT);
const BOOK_ORDER = new Map(EXPECTED_BOOKS.map((code, i) => [code, i]));

function readSourceFiles(dir: string): SourceFile[] {
  const root = join(SOURCES_ROOT, dir);
  const files: SourceFile[] = [];
  for (const name of readdirSync(root)) {
    if (!name.toLowerCase().endsWith('.usfm')) continue;
    const usfm = readFileSync(join(root, name), 'utf8');
    const code = usfm.match(/^\\id (\w{3})/)?.[1];
    if (!code || !BOOK_ORDER.has(code)) continue; // FRT, Apocrypha, …
    files.push({ code, usfm });
  }
  if (files.length !== EXPECTED_BOOKS.length) {
    const seen = new Set(files.map((f) => f.code));
    const missing = EXPECTED_BOOKS.filter((c) => !seen.has(c));
    throw new Error(`${dir}: expected ${EXPECTED_BOOKS.length} protestant canon books, got ${files.length} (missing: ${missing.join(', ')})`);
  }
  return files;
}

const addStats = (into: Record<string, number>, from: IngestStats) => {
  for (const [k, v] of Object.entries(from)) {
    if (typeof v === 'number') into[k] = (into[k] ?? 0) + v;
  }
};

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  rmSync(OUT_PATH, { force: true });
  const { db, sqlite } = createCorpusDb(OUT_PATH);
  seedBooksAndCanons(db);
  const schemes = loadSchemes();
  const pivot = buildPivot(schemes);
  seedSchemes(db, new Map(schemes).set(PIVOT, pivot));
  const mappingRows = allVrsPivotRows(schemes);
  insertMappings(db, mappingRows, 'vrs');
  console.log(`schemes: ${[...schemes.keys()].join(', ')} + ${PIVOT}; ${mappingRows.length} mapping rows`);
  for (const s of schemes.values()) {
    const problems = checkCoverage(s, pivot, mappingRows);
    if (problems.length > 0) console.warn(`  ⚠ ${s.id}: ${problems.length} verse(s) map outside the pivot: ${problems.slice(0, 3).join('; ')}`);
  }

  for (const src of SOURCES) {
    const scheme = schemes.get(src.meta.scheme);
    if (!scheme) throw new Error(`${src.meta.abbrev}: unknown scheme "${src.meta.scheme}"`);
    const files = readSourceFiles(src.dir);
    const edition = computeEdition(files);
    const translationId = insertTranslation(db, { ...src.meta, edition });
    console.log(`\n${src.meta.abbrev} — edition ${edition}`);

    const totals: Record<string, number> = {};
    let blockCount = 0;
    let tokenCount = 0;
    const ingestAll = sqlite.transaction(() => {
      for (const file of [...files].sort(
        (a, b) => BOOK_ORDER.get(a.code)! - BOOK_ORDER.get(b.code)!,
      )) {
        const { usj, parseErrors, versifiedTitleRewrites } = usfmToUsj(file.usfm, {
          rewriteVersifiedD: src.rewriteVersifiedD,
        });
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
        addStats(totals, stats);
        blockCount += blocks.length;
        tokenCount += tokens.length;
      }
    });
    ingestAll();
    console.log(`  ${blockCount} blocks, ${tokenCount} tokens`);
    console.log(`  not modelled in Phase 1 (dropped/unwrapped, counted): ${JSON.stringify(totals)}`);
  }

  sqlite.exec('VACUUM; ANALYZE;');
  sqlite.close();
  console.log(`\n✓ wrote ${OUT_PATH}`);
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

main();

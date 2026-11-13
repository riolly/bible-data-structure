/**
 * The checks one book of an edition must pass before the ingest writes it:
 * its parse outcome, its USJ book code, the chapter documents and the rows
 * derived from them (ADR-0001), the corpus invariants (CONTEXT.md), its verse
 * text's words (ADR-0004) and its declared scheme (ADR-0002). Pure TS, so
 * book-check.test.ts runs without the native bindings or the sources.
 */

import { verseNumbers, type Block, type Token, type VerseText } from '../model/corpus';
import { checkVerses, hasVerse, titleChapters, type Scheme } from '../model/scheme';
import { normalizeChapters, splitChapters, type NormalizeResult, type UsjDoc } from './normalize';
import type { ParseOutcome } from './parse';
import { verseWords } from './tokenize';

/** A finding that doesn't stop the ingest. `text` is the log line without its `⚠` prefix. */
export interface BookWarning {
  readonly check: 'parse' | 'dropped-verse' | 'verse-gap' | 'short-chapter';
  readonly text: string;
}

/**
 * The book's rows, or the first error that stops the ingest. Either way the
 * warnings found before it, in the order the checks ran.
 */
export type BookCheck =
  | { readonly ok: true; readonly rows: NormalizeResult; readonly warnings: readonly BookWarning[] }
  | { readonly ok: false; readonly error: unknown; readonly warnings: readonly BookWarning[] };

/**
 * Check one book of an edition under its declared scheme. `code` is the book
 * the source file holds. `wordTags` collects the `\w strong=` tags (the KJV's,
 * ADR-0003).
 */
export function checkBook(code: string, parsed: ParseOutcome, scheme: Scheme, opts: { wordTags: boolean }): BookCheck {
  const warnings: BookWarning[] = [];
  const warn = (check: BookWarning['check'], text: string) => warnings.push({ check, text });
  try {
    return { ok: true, rows: checkRows(code, parsed, scheme, opts, warn), warnings };
  } catch (error) {
    return { ok: false, error, warnings };
  }
}

type Warn = (check: BookWarning['check'], text: string) => void;

function checkRows(
  code: string,
  { usj, parseErrors, versifiedTitleRewrites }: ParseOutcome,
  scheme: Scheme,
  opts: { wordTags: boolean },
  warn: Warn,
): NormalizeResult {
  if (versifiedTitleRewrites > 0) {
    warn('parse', `${code}: ${versifiedTitleRewrites} versified \\d title(s) rewritten to \\qd (grammar gap, see parse.ts)`);
  }
  if (parseErrors.length > 0) {
    warn(
      'parse',
      `${code}: usfm-grammar strict parse failed, ingested with ignoreErrors —\n` + parseErrors.map((e) => `      ${e}`).join('\n'),
    );
  }
  const usjCode = usjBookCode(usj);
  if (usjCode !== code) {
    throw new Error(`${code}: USJ book code mismatch ("${usjCode}")`);
  }
  // The chapter documents are the stored truth; every other row is derived from them (ADR-0001 amendment).
  const raw = splitChapters(usj);
  let rows;
  try {
    rows = normalizeChapters(raw, {
      titleChapters: titleChapters(scheme, code),
      hasVerse: (c, v) => hasVerse(scheme, code, c, v),
      wordTags: opts.wordTags,
    });
  } catch (e) {
    throw new Error(`${code}: ${(e as Error).message}`, { cause: e });
  }
  const { blocks, tokens, verses, droppedVerses } = rows;
  for (const v of droppedVerses) {
    warn('dropped-verse', `${code} ${v.chapter}:${v.verse}: printed with no words and not in scheme ${scheme.id}, no verse text`);
  }
  validate(code, blocks, tokens);
  checkVerseWords(code, tokens, verses);
  warnVerseGaps(code, tokens, verses, warn);
  // Every token's verse has a verse-text row, so the rows alone cover the check.
  checkScheme(scheme, code, verses.flatMap(unitVerses), warn);
  return rows;
}

/** The USFM book code from the \id line (USJ `book` element). */
function usjBookCode(usj: UsjDoc): string | null {
  for (const node of usj.content) {
    if (typeof node !== 'string' && node.type === 'book') return node.code ?? null;
  }
  return null;
}

function unitVerses(u: VerseText): { chapter: number; verse: number }[] {
  return verseNumbers(u).map((verse) => ({ chapter: u.chapter, verse }));
}

/**
 * Every verse an edition has, each number of a bridge included, must exist in
 * its declared scheme (ADR-0002), or its addresses would name verses the
 * scheme lacks. A chapter that ends early only warns: an edition may omit
 * verses.
 */
function checkScheme(scheme: Scheme, code: string, rows: readonly { chapter: number; verse: number }[], warn: Warn) {
  const { unknown, short } = checkVerses(scheme, code, rows);
  if (unknown.length > 0) {
    const list = unknown.map((v) => `${v.chapter}:${v.verse}`).join(', ');
    throw new Error(`${code}: verses not in scheme ${scheme.id}: ${list}`);
  }
  for (const s of short) {
    warn('short-chapter', `${code} ${s.chapter}: ends at verse ${s.last}, scheme ${scheme.id} has ${s.expected}`);
  }
}

/**
 * Each verse unit's word tokens are its verse text's words (`verseWords`): a
 * pack reads a word address from the verse text alone (plan step 13).
 * Exported for book-check.test.ts, like `validate`: no USJ input fails either
 * while normalize.ts is correct, so the test breaks the rows instead.
 */
export function checkVerseWords(code: string, tokens: readonly Token[], units: readonly VerseText[]) {
  const words = new Map<string, string[]>();
  for (const t of tokens) {
    if (t.wordIndex === null) continue;
    const key = `${t.chapter}:${t.verse}${t.segment}`;
    (words.get(key) ?? words.set(key, []).get(key)!).push(t.text);
  }
  for (const u of units) {
    const key = `${u.chapter}:${u.verse}${u.segment}`;
    const fromText = verseWords(u.text);
    const stored = words.get(key) ?? [];
    if (fromText.join(' ') !== stored.join(' ')) {
      throw new Error(`${code} ${key}: the verse text's words differ from its word tokens (${fromText.length} and ${stored.length} words)`);
    }
  }
}

/** Corpus invariants (CONTEXT.md) — fail the build, not the reader. */
export function validate(code: string, blocks: readonly Block[], tokens: readonly Token[]) {
  const blockCount = blocks.length;
  const usedBlocks = new Set<number>();
  for (const t of tokens) {
    if (t.blockId < 0 || t.blockId >= blockCount) {
      throw new Error(`${code}: token references unknown block ${t.blockId}`);
    }
    usedBlocks.add(t.blockId);
    if (/\s/.test(t.text) || t.text.length === 0) {
      throw new Error(`${code}: whitespace leaked into token text ${JSON.stringify(t.text)}`);
    }
    if (t.verse === 0 && blocks[t.blockId]?.marker !== 'd') {
      throw new Error(`${code}: verse 0 outside a psalm title — other heading tokens must carry NULL`);
    }
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
function warnVerseGaps(code: string, tokens: { chapter: number; verse: number | null }[], units: readonly VerseText[], warn: Warn) {
  // a bridge's tokens carry its first number and cover the rest (ADR-0004 v1.5)
  const last = new Map(units.map((u) => [`${u.chapter}:${u.verse}`, u.lastVerse]));
  const byChapter = new Map<number, Set<number>>();
  for (const t of tokens) {
    if (t.verse == null) continue;
    const verses = byChapter.get(t.chapter) ?? byChapter.set(t.chapter, new Set()).get(t.chapter)!;
    for (let v = t.verse; v <= (last.get(`${t.chapter}:${t.verse}`) ?? t.verse); v++) verses.add(v);
  }
  for (const [chapter, verses] of byChapter) {
    const max = Math.max(...verses);
    const missing = [];
    for (let v = 1; v <= max; v++) if (!verses.has(v)) missing.push(v);
    if (missing.length > 0) {
      warn('verse-gap', `${code} ${chapter}: no tokens for verse(s) ${missing.join(', ')}`);
    }
  }
}

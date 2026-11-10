/**
 * Read one pinned source's books as USFM: its own `.usfm` files, or upstream
 * SBLGNT's XML converted by sblgnt-xml.ts. The edition stamp is computed over
 * the upstream files before any conversion or text fix, so it names the
 * upstream text (ADR-0005).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeEdition, type SourceFile } from './edition';
import { SBLGNT_BOOKS, sblgntXmlToUsfm } from './sblgnt-xml';
import type { SourceDef } from './sources';
import { applyTextFixes } from './text-fixes';

export const SOURCES_ROOT = join(import.meta.dirname, 'sources');

/** The upstream files of a source's listed books, in book order, as `{ code, usfm }` (raw text for XML). */
function readUpstream(src: SourceDef, root: string): SourceFile[] {
  const wanted = new Set(src.books);
  const byCode = new Map<string, SourceFile>();
  const add = (code: string | undefined, text: string) => {
    if (!code || !wanted.has(code)) return;
    if (byCode.has(code)) throw new Error(`${src.dir}: two files for ${code}`);
    byCode.set(code, { code, usfm: text });
  };
  if (src.format?.kind === 'sblgnt-xml') {
    const dir = join(root, src.dir, src.format.path);
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.xml')) add(SBLGNT_BOOKS[name.slice(0, -4)], readFileSync(join(dir, name), 'utf8'));
    }
  } else {
    for (const name of readdirSync(join(root, src.dir))) {
      if (!name.toLowerCase().endsWith('.usfm')) continue;
      const usfm = readFileSync(join(root, src.dir, name), 'utf8');
      add(usfm.match(/^\\id (\w{3})/)?.[1], usfm);
    }
  }
  const missing = src.books.filter((c) => !byCode.has(c));
  if (missing.length > 0) throw new Error(`${src.dir}: no file for ${missing.join(', ')}`);
  return src.books.map((c) => byCode.get(c)!);
}

/** A source's books as USFM, after conversion and its counted text fixes, and its edition stamp. */
export function readSource(src: SourceDef, root = SOURCES_ROOT): { edition: string; files: SourceFile[] } {
  const raw = readUpstream(src, root);
  const usfm =
    src.format?.kind === 'sblgnt-xml' ? raw.map((f) => ({ code: f.code, usfm: sblgntXmlToUsfm(f.usfm, f.code) })) : raw;
  return { edition: computeEdition(raw), files: applyTextFixes(usfm, src.textFixes) };
}

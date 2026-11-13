/**
 * Read one pinned source's books as USFM: its own `.usfm` files, upstream
 * SBLGNT's XML converted by sblgnt-xml.ts, or upstream OSHB's XML converted by
 * oshb-xml.ts with its qere readings. The edition stamp is computed over the
 * upstream files before any conversion or text fix, so it names the upstream
 * text (ADR-0005).
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeEdition, type SourceFile } from './edition';
import { OSHB_BOOKS, oshbXmlToUsfm, type OshbReading, type OshbVerse } from './oshb-xml';
import { SBLGNT_BOOKS, sblgntXmlToUsfm } from './sblgnt-xml';
import type { PinnedFile, SourceDef } from './sources';
import { applyTextFixes } from './text-fixes';

export const SOURCES_ROOT = join(import.meta.dirname, 'sources');

/**
 * The path of a pinned data file (MACULA, Clear) under `root`, once the file
 * is there and its sha256 is the pin's. The ingest opens these files only
 * through here, so an edited or truncated file stops the build (ADR-0005,
 * step 6 amendment), as `readTvtms` does for TVTMS. The download checks a
 * file it already has the same way.
 */
export function pinnedPath(pin: Pick<PinnedFile, 'id' | 'sha256' | 'file'>, root = SOURCES_ROOT): string {
  const path = join(root, pin.file);
  if (!existsSync(path)) throw new Error(`${path} is missing: run \`bun run ingest:download\` first`);
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (digest !== pin.sha256) {
    throw new Error(
      `${pin.id}: ${path} does not match its pin.\n  pinned: ${pin.sha256}\n  file:   ${digest}\n` +
        '  Delete it and run `bun run ingest:download` to fetch the pinned file again.',
    );
  }
  return path;
}

/** The upstream files of a source's listed books, in book order, as `{ code, usfm }` (raw text for XML). */
function readUpstream(src: SourceDef, root: string): SourceFile[] {
  const wanted = new Set(src.books);
  const byCode = new Map<string, SourceFile>();
  const add = (code: string | undefined, text: string) => {
    if (!code || !wanted.has(code)) return;
    if (byCode.has(code)) throw new Error(`${src.dir}: two files for ${code}`);
    byCode.set(code, { code, usfm: text });
  };
  if (src.format) {
    const dir = join(root, src.dir, src.format.path);
    const books = src.format.kind === 'sblgnt-xml' ? SBLGNT_BOOKS : OSHB_BOOKS;
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.xml')) add(books[name.slice(0, -4)], readFileSync(join(dir, name), 'utf8'));
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

/**
 * A source's books as USFM, after conversion and its counted text fixes, its
 * edition stamp, and the readings (ADR-0007) and OSHB words (ADR-0003) its
 * conversion found, checked against the stored tokens: the readings by
 * edition-writer.ts, the words by run.ts.
 */
export function readSource(
  src: SourceDef,
  root = SOURCES_ROOT,
): { edition: string; files: SourceFile[]; readings: OshbReading[]; oshbVerses: OshbVerse[] } {
  const raw = readUpstream(src, root);
  const readings: OshbReading[] = [];
  const oshbVerses: OshbVerse[] = [];
  const usfm = raw.map((f) => {
    if (src.format?.kind === 'sblgnt-xml') return { code: f.code, usfm: sblgntXmlToUsfm(f.usfm, f.code) };
    if (src.format?.kind === 'oshb-xml') {
      const converted = oshbXmlToUsfm(f.usfm, f.code);
      readings.push(...converted.readings);
      oshbVerses.push(...converted.verses);
      return { code: f.code, usfm: converted.usfm };
    }
    return f;
  });
  return { edition: computeEdition(raw), files: applyTextFixes(usfm, src.textFixes), readings, oshbVerses };
}

/** The edition stamp of a source's unpacked files under `root`, as the ingest computes it. */
export function sourceEdition(src: SourceDef, root = SOURCES_ROOT): string {
  return computeEdition(readUpstream(src, root));
}

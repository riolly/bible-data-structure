/**
 * Read one pinned source's books as USFM through its format's adapter
 * (source-formats.ts). The edition stamp is computed over the upstream files
 * before any conversion or text fix, so it names the upstream text (ADR-0005).
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeEdition, type SourceFile } from './edition';
import { formatOf, type ConvertedSource, type OpenPinned } from './source-formats';
import type { PinnedFile, SourceDef } from './sources';
import { applyTextFixes } from './text-fixes';

export const SOURCES_ROOT = join(import.meta.dirname, 'sources');

/**
 * The path of a pinned data file (TVTMS, MACULA, Clear) under `root`, once the
 * file is there and its sha256 is the pin's. The ingest and
 * `api-bible:facts` open these files only through here, so a missing, edited
 * or truncated file stops them with the same fix (ADR-0005, step 6
 * amendment). The download checks a file it already has the same way.
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
  const format = formatOf(src);
  const wanted = new Set(src.books);
  const byCode = new Map<string, SourceFile>();
  const dir = join(root, format.dir(src));
  for (const name of readdirSync(dir)) {
    if (!format.isBookFile(name)) continue;
    const text = readFileSync(join(dir, name), 'utf8');
    const code = format.bookOf(name, text);
    if (!code || !wanted.has(code)) continue;
    if (byCode.has(code)) throw new Error(`${src.dir}: two files for ${code}`);
    byCode.set(code, { code, usfm: text });
  }
  const missing = src.books.filter((c) => !byCode.has(c));
  if (missing.length > 0) throw new Error(`${src.dir}: no file for ${missing.join(', ')}`);
  return src.books.map((c) => byCode.get(c)!);
}

/**
 * A source's books as USFM, after conversion and its counted text fixes, its
 * edition stamp, and `open`, which starts the edition's by-products
 * (`ConvertedSource`).
 */
export function readSource(
  src: SourceDef,
  root = SOURCES_ROOT,
  openPinned: OpenPinned = (pin) => pinnedPath(pin, root),
): { edition: string; files: SourceFile[]; open: ConvertedSource['open'] } {
  const raw = readUpstream(src, root);
  const { files, open } = formatOf(src).convert(raw, openPinned);
  return { edition: computeEdition(raw), files: applyTextFixes(files, src.textFixes), open };
}

/** The edition stamp of a source's unpacked files under `root`, as the ingest computes it. */
export function sourceEdition(src: SourceDef, root = SOURCES_ROOT): string {
  return computeEdition(readUpstream(src, root));
}

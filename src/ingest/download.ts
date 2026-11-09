/**
 * Fetch the pinned USFM source zips and the TVTMS file into src/ingest/sources/
 * (gitignored) and verify their sha256 against sources.ts. Run once before `pnpm ingest`:
 *
 *   pnpm ingest:download
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { SOURCES, TVTMS } from './sources';

const SOURCES_ROOT = join(import.meta.dirname, 'sources');

async function main() {
  await mkdir(SOURCES_ROOT, { recursive: true });
  for (const src of SOURCES) {
    const dest = join(SOURCES_ROOT, src.dir);
    if (existsSync(dest)) {
      console.log(`✓ ${src.meta.abbrev}: ${dest} exists — skipping (rm it to re-download)`);
      continue;
    }
    console.log(`↓ ${src.meta.abbrev}: ${src.url}`);
    const res = await fetch(src.url);
    if (!res.ok) throw new Error(`${src.url} → HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const digest = createHash('sha256').update(buf).digest('hex');
    if (digest !== src.sha256) {
      throw new Error(
        `${src.meta.abbrev}: sha256 mismatch — upstream re-published.\n` +
          `  pinned:   ${src.sha256}\n  fetched:  ${digest}\n` +
          `Updating the pin is a NEW EDITION (ADR-0005): bump sources.ts consciously.`,
      );
    }
    const zipPath = join(SOURCES_ROOT, `${src.dir}.zip`);
    await writeFile(zipPath, buf);
    await mkdir(dest, { recursive: true });
    execFileSync('unzip', ['-oq', zipPath, '-d', dest]);
    await rm(zipPath);
    console.log(`✓ ${src.meta.abbrev}: verified sha256, unpacked to ${dest}`);
  }

  const tvtmsPath = join(SOURCES_ROOT, TVTMS.file);
  if (existsSync(tvtmsPath)) {
    console.log(`✓ TVTMS: ${tvtmsPath} exists — skipping (rm it to re-download)`);
    return;
  }
  console.log(`↓ TVTMS: ${TVTMS.url}`);
  const res = await fetch(TVTMS.url);
  if (!res.ok) throw new Error(`${TVTMS.url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const digest = createHash('sha256').update(buf).digest('hex');
  if (digest !== TVTMS.sha256) {
    throw new Error(`TVTMS: sha256 mismatch.\n  pinned:   ${TVTMS.sha256}\n  fetched:  ${digest}`);
  }
  await mkdir(dirname(tvtmsPath), { recursive: true });
  await writeFile(tvtmsPath, buf);
  console.log(`✓ TVTMS: verified sha256, saved to ${tvtmsPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

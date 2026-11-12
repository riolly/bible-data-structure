/**
 * Fetch the pinned source zips, the TVTMS file and the MACULA Greek word table into src/ingest/sources/
 * (gitignored). Run once before `bun run ingest`:
 *
 *   bun run ingest:download
 *
 * A source zip passes when its unpacked text gives the pinned edition stamp
 * (ADR-0005 amendment, step 6), so a rebuilt zip with the same text passes.
 * When upstream gives another stamp or fails, the download tries our own copy
 * (`mirrorLabel` in sources.ts). When neither gives the pinned stamp, it stops:
 * a changed stamp is a new edition, never accepted here.
 *
 * Each verified zip is kept under sources/mirror/ under its mirror file name,
 * ready to upload to the mirror release.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { sourceEdition } from './source-files';
import { MACULA_GREEK, MIRROR, SOURCES, TVTMS, mirrorAsset, mirrorLabel, type SourceDef } from './sources';

const SOURCES_ROOT = join(import.meta.dirname, 'sources');
const STAGING = join(SOURCES_ROOT, '.staging');
const MIRROR_DIR = join(SOURCES_ROOT, 'mirror');

async function main() {
  await mkdir(MIRROR_DIR, { recursive: true });
  for (const src of SOURCES) await fetchSource(src);
  for (const file of [{ id: 'TVTMS', ...TVTMS }, MACULA_GREEK]) await fetchPinnedFile(file);
}

async function fetchSource(src: SourceDef) {
  const name = src.meta.abbrev;
  const dest = join(SOURCES_ROOT, src.dir);
  if (existsSync(dest)) {
    const stamp = sourceEdition(src, SOURCES_ROOT);
    if (stamp !== src.edition) {
      throw new Error(`${name}: ${dest} gives edition ${stamp}, not the pinned ${src.edition}. Delete it and run again.`);
    }
    console.log(`✓ ${name}: ${dest} exists and gives ${stamp}, skipping`);
    return;
  }

  const failures: string[] = [];
  for (const [from, url] of [['upstream', src.url], ['mirror', mirrorLabel(src)]] as const) {
    console.log(`↓ ${name}: ${url}`);
    await rm(STAGING, { recursive: true, force: true });
    await mkdir(join(STAGING, src.dir), { recursive: true });
    const zipPath = join(STAGING, `${src.dir}.zip`);
    let stamp: string;
    try {
      if (from === 'upstream') await fetchTo(url, zipPath);
      else fetchMirror(src, zipPath);
      execFileSync('unzip', ['-oq', zipPath, '-d', join(STAGING, src.dir)]);
      stamp = sourceEdition(src, STAGING); // throws when a listed book is missing
    } catch (e) {
      const err = e as Error & { stderr?: Buffer };
      failures.push(`${from}: ${(err.stderr?.toString().trim() || err.message).split('\n')[0]}`);
      continue;
    }
    if (stamp !== src.edition) {
      failures.push(`${from}: gives edition ${stamp}`);
      continue;
    }
    await rename(join(STAGING, src.dir), dest);
    await rename(zipPath, join(MIRROR_DIR, mirrorAsset(src)));
    await rm(STAGING, { recursive: true, force: true });
    console.log(`✓ ${name}: ${from} gives the pinned edition ${stamp}, unpacked to ${dest}`);
    // A different stamp upstream means a new edition exists there. Say so even
    // though our copy passed, or nobody learns of it.
    for (const f of failures) console.warn(`⚠ ${name}: ${f}`);
    return;
  }
  await rm(STAGING, { recursive: true, force: true });
  throw new Error(
    `${name}: no copy gives the pinned edition ${src.edition}.\n  ${failures.join('\n  ')}\n` +
      `A changed stamp is a new edition (ADR-0005): update \`edition\` in sources.ts consciously, ` +
      `record it in README.md Editions, and upload its zip to the mirror.`,
  );
}

async function fetchTo(url: string, path: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
}

/** The mirror release is on a private repo, so fetch through the GitHub CLI's login. */
function fetchMirror(src: SourceDef, path: string) {
  execFileSync('gh', ['release', 'download', MIRROR.tag, '--repo', MIRROR.repo, '--pattern', mirrorAsset(src), '--output', path], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

/** A file pinned by its URL at a git commit and its sha256 (TVTMS, MACULA). Its bytes can't change. */
async function fetchPinnedFile(pin: { id: string; url: string; sha256: string; file: string }) {
  const path = join(SOURCES_ROOT, pin.file);
  if (existsSync(path)) {
    console.log(`✓ ${pin.id}: ${path} exists, skipping (delete it to download again)`);
    return;
  }
  console.log(`↓ ${pin.id}: ${pin.url}`);
  const res = await fetch(pin.url);
  if (!res.ok) throw new Error(`${pin.url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const digest = createHash('sha256').update(buf).digest('hex');
  if (digest !== pin.sha256) {
    throw new Error(`${pin.id}: sha256 mismatch.\n  pinned:   ${pin.sha256}\n  fetched:  ${digest}`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
  console.log(`✓ ${pin.id}: verified sha256, saved to ${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pinnedPath } from './source-files';

/** A pinned file under a temporary root, so no downloaded source is needed. */
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pinned-'));
  mkdirSync(join(root, 'macula'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const BYTES = 'xml:id\tref\ttext\no010010010011\tGEN 1:1!1\tבְּ\n';
const pin = { id: 'macula-test', file: 'macula/test.tsv', sha256: createHash('sha256').update(BYTES).digest('hex') };

describe('pinnedPath: a pinned data file is checked before the ingest reads it (#48)', () => {
  it('gives the path of a file whose sha256 is the pin', () => {
    writeFileSync(join(root, pin.file), BYTES);
    expect(pinnedPath(pin, root)).toBe(join(root, 'macula', 'test.tsv'));
  });

  it('stops on a file that was edited or truncated, naming both hashes', () => {
    for (const bytes of [BYTES.replace('בְּ', 'בַּ'), BYTES.slice(0, -10), '']) {
      writeFileSync(join(root, pin.file), bytes);
      const digest = createHash('sha256').update(bytes).digest('hex');
      expect(() => pinnedPath(pin, root)).toThrow(
        `macula-test: ${join(root, pin.file)} does not match its pin.\n  pinned: ${pin.sha256}\n  file:   ${digest}`,
      );
    }
  });

  it('says to download a file that is missing', () => {
    expect(() => pinnedPath(pin, root)).toThrow(/test\.tsv is missing: run `bun run ingest:download` first/);
  });
});

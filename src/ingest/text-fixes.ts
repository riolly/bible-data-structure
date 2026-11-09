/**
 * Apply a source's TextFix list (sources.ts) to its files before parsing.
 * Each fix must occur exactly `count` times across the source, so a fix that
 * stops matching, or starts matching more, stops the ingest.
 */

import type { SourceFile } from './edition';
import type { TextFix } from './sources';

export function applyTextFixes(files: readonly SourceFile[], fixes: readonly TextFix[] = []): SourceFile[] {
  let out = [...files];
  for (const fix of fixes) {
    let seen = 0;
    out = out.map((f) => {
      const parts = f.usfm.split(fix.find);
      seen += parts.length - 1;
      return parts.length === 1 ? f : { ...f, usfm: parts.join(fix.replace) };
    });
    if (seen !== fix.count) {
      throw new Error(`text fix ${JSON.stringify(fix.find)} occurs ${seen} times, expected ${fix.count} (${fix.why})`);
    }
  }
  return out;
}

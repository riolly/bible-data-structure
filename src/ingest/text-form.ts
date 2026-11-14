/**
 * The form the ingest stores text in (ADR-0004 v1.6). Text in the Hebrew
 * script (U+0590 to U+05FF, and the presentation forms U+FB1D to U+FB4F) stays
 * as the source wrote it: NFC reorders Hebrew points, and the source order is
 * the reading order (research/hebrew-ketiv-qere.md). Everything else is NFC,
 * which Greek needs (ADR-0004 v1.1 rule 1). Every place the ingest or a
 * provider normalizes text calls this, never a bare `normalize('NFC')`.
 */
const NOT_HEBREW = /[^֐-׿יִ-ﭏ]+/g;

export const storedText = (s: string): string => s.replace(NOT_HEBREW, (run) => run.normalize('NFC'));

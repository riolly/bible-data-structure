/**
 * The chapter stamp (ADR-0005 amendment, 2026-11-11): sha256 over a chapter's
 * stored document, as its JSON, and its verse units with their text, cut to
 * 16 hex digits. The ingest (`src/ingest/edition.ts`) and a provider that
 * fetches a chapter at a time (plan step 10) hash the same bytes, so a
 * fetched chapter's stamp is computed as for a local edition.
 *
 * No Node-only import here: `chapterStampAsync` uses Web Crypto.
 */

type StampVerse = { readonly verse: number; readonly lastVerse: number; readonly segment: string; readonly text: string };

/** The text the stamp hashes: the document's JSON, then one line per verse unit. */
export function chapterStampInput(usj: string, verses: readonly StampVerse[]): string {
  let s = `${usj}\n`;
  for (const v of verses) s += `${v.verse}-${v.lastVerse}${v.segment}\t${v.text}\n`;
  return s;
}

/** The chapter stamp through Web Crypto, for code that runs on a reader's device. */
export async function chapterStampAsync(usj: string, verses: readonly StampVerse[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chapterStampInput(usj, verses)));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex.slice(0, 16)}`;
}

/**
 * THE REGISTERED TOKENIZATION POLICY (ADR-0004) — part of the locked anchor
 * seam. `word_index` counts word tokens, so these rules define what every
 * anchor coordinate means, forever. ANY change here is an anchor migration
 * (same gravity as changing the anchor columns), guarded by the adversarial
 * golden fixtures and ADR-0005's quote-witness reconciliation.
 *
 * Rules (recorded in ADR-0004):
 *  1. A WORD token BEGINS with a letter/digit, then runs over letters/digits
 *     and COMBINING MARKS (\p{M}), joined by INTERNAL apostrophes (' or ’) or
 *     hyphens (-). Possessives ("LORD's") and hyphenated compounds
 *     ("father-in-law") are ONE word — one tap target. A combining mark binds
 *     to its base letter, so a decomposed accent or a Hebrew vowel point stays
 *     inside its word instead of splitting off as punct (ADR-0004 v1.1);
 *     ingest runs NFC first (normalize.ts) so Greek polytonic recomposes.
 *  2. A grouped NUMBER — digits joined by , or . ("144,000", "3.5") — is ONE
 *     word token.
 *  3. A trailing bare apostrophe (plural possessive "disciples’") and a
 *     leading elision apostrophe ("’Twas") are PUNCT, not part of the word —
 *     so a quote-style revision (' → ’) at a word edge never touches word
 *     text, only punct (ADR-0005 immunity).
 *  4. Everything else non-space is PUNCT; a maximal run of punct characters
 *     (",”" / "—") collapses into a SINGLE punct token. A combining mark binds
 *     to a preceding base (rule 1); an ORPHAN mark — one with no base before it
 *     (run edge, after space, after punct) — falls here as punct rather than
 *     vanishing, so tokens still cover every non-space character.
 *  5. Whitespace is NEVER a token — spacing belongs to the presentation layer.
 *  6. In verse text, a STANDALONE unpointed פ or ס (no letter or mark touching
 *     it) is PUNCT: the petuha and setuma paragraph marks of Hebrew
 *     manuscripts, not words (ADR-0004 v1.3). Headings keep them as words,
 *     where they label Psalm 119's stanzas beside the other 20 letters.
 */

import type { TokenKind } from '../model/corpus';

const TOKEN_PATTERN =
  /((?<![\p{L}\p{M}])[פס](?![\p{L}\p{M}]))|(\p{N}+(?:[,.]\p{N}+)+|[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’-][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*)|([^\s\p{L}\p{N}]+)/gu;

export interface TokenizeOptions {
  /** Rule 6: read a standalone פ or ס as a paragraph mark. Normalize sets it outside headings. */
  readonly paragraphMarks?: boolean;
}

export interface RawToken {
  readonly kind: TokenKind;
  readonly text: string;
}

/** Split one contiguous text run into word/punct tokens per the policy above. */
export function tokenize(run: string, opts: TokenizeOptions = {}): RawToken[] {
  const out: RawToken[] = [];
  for (const m of run.matchAll(TOKEN_PATTERN)) {
    if (m[1] !== undefined) out.push({ kind: opts.paragraphMarks ? 'punct' : 'word', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'word', text: m[2] });
    else out.push({ kind: 'punct', text: m[3] });
  }
  return out;
}

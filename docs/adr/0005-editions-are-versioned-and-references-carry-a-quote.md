# Editions are versioned, and references from outside carry a quote witness

Status: accepted. Carried from old bible-codex ADR-0013, commit `c2643a2`.

Word addresses survive a re-ingest because they are coordinates, not row ids. They don't survive a text revision. If a revision inserts or reorders words, `word_index` shifts and every reference to that verse silently lands on the wrong words. Translations do get revised: on 2026-11-09 both pinned ebible.org zips (KJV and BSB) no longer matched their July checksums. Three rules close the gap:

1. **Every edition gets an edition stamp at ingest.** `src/ingest/edition.ts` computes sha256 over the source text, so repackaging a zip doesn't change it and a text change does. `src/ingest/sources.ts` pins each upstream zip by checksum, and a mismatch stops the download. Updating a pin is a new edition.
2. **A reference held outside the corpus carries a quote witness**: the surface text of the words it points at, plus the edition stamp it was made against. The coordinate stays the address, and the quote is proof (the W3C Web Annotation `TextQuoteSelector` pattern, as used by Hypothes.is).
3. **A changed edition triggers a reconciliation pass.** References whose quote still matches pass untouched. A mismatch is repaired automatically only when the quote occurs exactly once in the same verse. Anything else is flagged as displaced for review, never guessed across verses.

## Considered options

- **No witness.** Rejected. Corruption would be silent, with no way to detect it.
- **Quote plus prefix and suffix context (the full W3C selector).** Rejected. The verse already limits the search to a few words.
- **Checking at render time.** Rejected. An edition change is rare and detectable, so reconcile once.

## Consequences

- The same pass catches tokenizer-policy drift (ADR-0004).
- Rules 2 and 3 apply to whatever holds references: app user data, cross-reference datasets, structure overlays keyed by word index. The data model supplies the edition stamp and the quote lookup.
- The 2026-11-09 pin update has no stamp from July to compare against, so whether the text changed or only the packaging is unknown. From now on the README records each edition stamp beside its pin.

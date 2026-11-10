# Editions are versioned, and references from outside carry a quote witness

Status: accepted. Carried from old bible-codex ADR-0013, commit `c2643a2`.

Word addresses survive a re-ingest because they are coordinates, not row ids. They don't survive a text revision. If a revision inserts or reorders words, `word_index` shifts and every reference to that verse silently lands on the wrong words. Translations do get revised: on 2026-11-09 both pinned ebible.org zips (KJV and BSB) no longer matched their July checksums. Three rules close the gap:

1. **Every edition gets an edition stamp at ingest.** `src/ingest/edition.ts` computes sha256 over the source text, so repackaging a zip doesn't change it and a text change does. `src/ingest/sources.ts` pins each upstream zip by checksum, and a mismatch stops the download. Updating a pin is a new edition. (Amended 2026-11-10: the pin is the edition stamp, see below.)
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

## Amendment: a words stamp beside the edition stamp (2026-11-09)

The edition stamp hashes only the upstream files. Stored words also depend on the counted text fixes in `sources.ts`, the tokenizer (ADR-0004), the normalizer and the USFM parser version. Any of these can change what a word address holds while the edition stamp stays the same, so rule 3's reconciliation pass would never start. ADR-0004 v1.3 and v1.4 are such changes.

- Each edition also gets a **words stamp**, `translation.words_stamp`: sha256 over every word address (book, chapter, verse, segment, word index) and the word text stored there, in book order (`wordsStamp` in `src/ingest/edition.ts`).
- Punctuation is left out, for the reason ADR-0004 leaves it out of word indexes.
- **Rule 3 keys on the words stamp.** A changed words stamp starts the reconciliation pass, whatever caused it. The edition stamp stays the name of the upstream text, and the README records both.

## Amendment: a source is pinned by its edition stamp (2026-11-10, step 6)

On 2026-11-10 ebible.org rebuilt the KJV zip. Its sha256 changed from `c7ba60db…621aaf` to `941ef56e…0b8133`, so rule 1's zip pin stopped the download, but the text still gives the pinned edition stamp `sha256:7ead3d28b2b34c9b`. A zip hash names the packaging, and the edition stamp names the text, so rule 1 pinned the wrong thing.

- **Each text source is pinned by its edition stamp**, `edition` in `src/ingest/sources.ts`. `bun run ingest:download` unpacks a zip into a staging directory and computes the stamp the ingest would. A zip that gives the pinned stamp passes, whatever its bytes. Any other stamp stops the download, and the ingest stops on files that don't give the pinned stamp. Updating `edition` is still a new edition, recorded in the README's Editions table.
- The sources pinned to a git commit (WLC from OSHB, SBLGNT) are pinned by edition stamp too. GitHub builds those archives on request, so their bytes aren't guaranteed, and one rule is simpler than two. TVTMS keeps its file hash: it is one raw file at a commit, which can't change, and it has no edition stamp.
- **We keep our own copy of every pinned text source**: a GitHub release `sources` on this repo, one zip per edition stamp (`mirrorUrl` in sources.ts). When upstream gives another stamp or fails, the download tries the copy. A person uploads the zips, which the download keeps in `src/ingest/sources/mirror/`. Every text source may be redistributed (research/licensing.md). SBLGNT and the OSHB archive are CC BY 4.0, so the release notes carry their attribution. TVTMS has no copy, because STEPBible asks that the raw file not be re-posted.

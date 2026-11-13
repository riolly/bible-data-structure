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

- Each edition also gets a **words stamp**, `translation.words_stamp`: sha256 over every word address (book, chapter, verse, segment, word index) and the word text stored there, in book order (`wordsStamp` in `src/ingest/edition.ts`). A bridge's word address includes its last verse, `4MA 8:28-29!3` (ADR-0004 v1.5).
- Punctuation is left out, for the reason ADR-0004 leaves it out of word indexes.
- **Rule 3 keys on the words stamp.** A changed words stamp starts the reconciliation pass, whatever caused it. The edition stamp stays the name of the upstream text, and the README records both.

## Amendment: a source is pinned by its edition stamp (2026-11-10, step 6)

On 2026-11-10 ebible.org rebuilt the KJV zip. Its sha256 changed from `c7ba60db…621aaf` to `941ef56e…0b8133`, so rule 1's zip pin stopped the download, but the text still gives the pinned edition stamp `sha256:7ead3d28b2b34c9b`. A zip hash names the packaging, and the edition stamp names the text, so rule 1 pinned the wrong thing.

- **Each text source is pinned by its edition stamp**, `edition` in `src/ingest/sources.ts`. `bun run ingest:download` unpacks a zip into a staging directory and computes the stamp the ingest would. A zip that gives the pinned stamp passes, whatever its bytes. Any other stamp stops the download, and the ingest stops on files that don't give the pinned stamp. Updating `edition` is still a new edition, recorded in the README's Editions table.
- The sources pinned to a git commit (WLC from OSHB, SBLGNT) are pinned by edition stamp too. GitHub builds those archives on request, so their bytes aren't guaranteed, and one rule is simpler than two. TVTMS keeps its file hash: it is one raw file at a commit, which can't change, and it has no edition stamp.
- **We keep our own copy of every pinned text source**: a GitHub release `sources` on this repo, one zip per edition stamp (`mirrorUrl` in sources.ts). When upstream gives another stamp or fails, the download tries the copy. A person uploads the zips, which the download keeps in `src/ingest/sources/mirror/`. Every text source may be redistributed (research/licensing.md). SBLGNT and the OSHB archive are CC BY 4.0, so the release notes carry their attribution. TVTMS has no copy, because STEPBible asks that the raw file not be re-posted.

## Amendment: chapter stamps cover what a reader sees (2026-11-11, steps 5 to 9 review)

The contract tells a caller to store the verse text as its quote. The words stamp skips punctuation, and the edition stamp names the upstream files, so a change to a converter, usfm-grammar or the verse-text join rule could change a stored quote while both stamps stayed the same. A fetched edition (plan step 10) also has no source files to give an edition stamp, and is reconciled a chapter at a time.

- Each chapter gets a **chapter stamp**, `chapter_doc.stamp`: sha256 over the stored chapter document's JSON and the chapter's verse units with their text (`chapterStamp` in `src/ingest/edition.ts`). Chapter 0, the front matter, has one too.
- Each edition gets a **text stamp**, `translation.text_stamp`: sha256 over its chapter stamps in book order. The README records it beside the words stamp.
- **A quote reconciles on its chapter stamp.** Every `Verse` the contract returns carries `chapterStamp`, and a caller stores it beside the quote. When it changes, rule 3's pass runs for the quotes in that chapter. Word anchors still reconcile on the words stamp.
- A fetched chapter's stamp uses the same formula over the chapter document its adapter writes, not the hash of the provider's response, so a change to the adapter starts reconciliation too. A fetched edition has no edition, words or text stamp, so those fields of `EditionStamp` may be null.

## Amendment: a user mark is a verse address and a quote (2026-11-13, step 14)

Apps will keep a reader's highlights, notes and bookmarks on the device, and sync and export them (old-repo ADR-0006 and ADR-0011 in `docs/prior-art/`). Rules 2 and 3 don't say which part of a mark wins when its parts disagree, what a mark on a licensed edition may keep, or when a fetched edition reconciles. This amendment decides those. Apps build the storage.

- **A mark's truth is its verse address and its quote.** A mark stores the edition's abbreviation, the address of each unit as the contract returns it with its scheme (`JHN 3:16/kjv`), the quote witness and the stamp it was made against. A word index is a hint. When the words at the hint no longer match the quote, the quote wins.
- **A verse mark** covers whole verse units. For each unit it keeps the unit's `text` as its quote and the unit's `chapterStamp`, so a mark over several chapters reconciles a chapter at a time.
- **A word mark** covers part of one verse unit and exists only on a Full edition (ADR-0008). It stores the unit's address, the word indexes as its hint, the edition's words stamp, and as its quote the `text` of the words with an address in that range, as the `words` call returns them, joined by single spaces. A qere has no address, so it is never part of a quote. A selection that crosses verses is one word mark per verse unit, because rule 3 never repairs across verses.
- **A mark reads back through `resolve`.** `resolve` takes the unit's address under any scheme, so a mark made before an edition changed scheme still reads, and it throws on a word address. For a word mark, the app calls `words` with the address of the unit `resolve` found, and takes the words at the hint's indexes.
- **A licensed edition's quote is a hash.** Unless the edition's rights record has `offline: 'full'`, the quote witness is the sha256 of the quote's UTF-8 text in hex, and the text is never stored. An edition with no rights record yet gets a hash too, which covers the licensed editions until step 10 adds their records. A mark outlives the cache, and syncs and exports, but API.Bible requires kept content to be refreshed within 30 days (section 11) and removed within 72 hours of termination (section 10.2), and Lockman and Crossway cap how many verses a system may store (research/licensing.md). A hash still shows that the text changed, and a word mark's repair compares it with the hash of each run of the same number of addressed words in the unit.
- **A verse mark keeps its verse.** It reconciles when its chapter stamp changes. The units are the same when `resolve` finds, for each stored unit, one whole unit of the same kind: a verse for a verse, or a bridge over as many verses for a bridge. Then the mark stays on them whatever the quote, and the app stores the addresses `resolve` gave, which differ only when the edition changed scheme (BSB's `PHP 1:16/kjv` is `PHP 1:17/bsb`). On an edition we hold, a changed quote means the wording changed, because we ingest a revision as a new edition and check its numbering against its scheme then, and a renumbered edition is on a new scheme (ADR-0002). The app stores the new quote and stamp. A fetched edition's numbering is checked only when we collect its facts (step 10), not on the device, so there a changed quote is flagged for the reader to confirm. If `resolve` finds other units than the mark stored, such as a verse now inside a bridge, the mark moves to the units found and is flagged for review. If it finds the verse absent, the mark is displaced: the app keeps it with its old quote and shows it for review.
- **A word mark falls back to its verse.** It reconciles when the words stamp changes. If the words at the hint still match the quote, nothing changes. Otherwise, if the quote occurs exactly once in the unit as consecutive addressed words, the hint moves there. Otherwise, or when `resolve` finds other units than the mark stored, as defined for a verse mark, the mark becomes a verse mark on the units found, flagged for review, with its old quote and hint kept. This is rule 3, except that a failed repair keeps the verse.
- **A held edition reconciles after an app update, and a fetched edition after a refresh.** An edition we hold as files never changes in place (ADR-0008), so its stamps change only when an app ships a new pack, and the pass runs once after that update. A fetched edition reconciles on the device. When the cache refresh (step 10) gives a chapter a new chapter stamp, the pass runs for the marks in that chapter. A mark whose chapter the cache no longer holds reconciles when the chapter is next fetched. Importing an export file runs the same pass.

### Considered options

- **The word index as the truth, checked by the quote** (rule 2 as first written). Rejected. A revision that inserts a word moves every later index in the verse, and a repair that fails loses the mark. With the quote as the truth, the worst case is a mark on its whole verse.
- **Storing a licensed edition's quote as text.** Rejected for the license limits above.
- **Word marks on Reading editions, anchored by the quote alone.** Rejected in ADR-0008. A fetched edition also has no words stamp and its quote is a hash, so a displaced word mark would have no text left to show the reader.

### Consequences

- No edition is Full yet (README step 12), so no app can make a word mark until the KJV's tags are stored or the BSB's remaining words have numbers. The contract doesn't yet say which editions are Full. It gets that field when the first edition becomes Full.
- The contract returns what a mark stores: `Verse.text` and `chapterStamp`, `Word.text` and `address`, the words stamp in `EditionStamp`, and `offline` in the rights record. No call is added. The licensed editions' rights records are still to come (step 10).

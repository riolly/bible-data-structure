# Original words keep external ids, split Hebrew into morphemes, and keep the lexicon separable

Status: accepted. Carried from old bible-codex ADR-0007, commit `c2643a2`. Not built yet.

The **Original Word** hub is the word-level link between translations: a translation's Tokens align to original Hebrew/Greek words, and two translations relate at word level only through that hub. The storage shape:

1. **`ow_id` is an opaque external per-occurrence id** from a maintained corpus (MACULA, STEPBible, OSHB class), never a coordinate we mint. Stability comes from the source, importing an alignment becomes a join instead of a fuzzy match, and the id is never parsed, so swapping sources only needs a translation table.
2. **The hub is morpheme-grained.** An Original Word is a segment occurrence: a whole word in Greek, a morpheme in Hebrew. The source corpora mint ids at that grain, and alignment targets morphemes (English "in" aligns to the Hebrew preposition). A written word is rebuilt from `segment_of` plus `segment_index`.
3. **`token.ow_id` is the denormalized head; `interlinear_alignment` is the many-to-many truth.** The column answers "the one original word this token mostly maps to". The junction table `(token_id, original_word_id)` holds the full mapping. Relation type, confidence and a primary flag are added when a source supplies them.
4. **Three tiers join by string keys, with foreign keys only inside a tier.** Corpus, hub and lexicon reference each other by stable string keys. The only real foreign key is `alignment.token_id → token.id`, rebuilt on every ingest. An ingest-time validation pass checks that every cross-tier key resolves.
5. **The hub stores both addresses inline**: the address in the edition's scheme that links to reading texts, and the native Hebrew/Greek chapter and verse, plus position.
6. **`lemma` is the spine and `strongs` is the first dictionary.** Strong's is a join key only, never an address. Fuller lexicons (BDB, Thayer), Hebrew roots and semantic domains (Louw-Nida) are added later as tables hanging off `lemma`.
7. **Morphology is a raw parse code on the word**, decoded through a small code-to-features table.
8. **One editorial gloss per Original Word.** Reverse-interlinear (a translation's words under the original) is derived from alignment, never stored.

## Considered options

- **Self-minted original-text coordinates as ids.** Rejected. Re-segmenting Hebrew renumbers positions, and every word-level reference would orphan.
- **Whole-word table plus a child morpheme table.** Rejected. It fights the sources' id grain and forces special code paths.
- **Foreign keys everywhere in one file.** Rejected. Re-sourcing Strong's or shipping a translation pack separately would become a coordinated migration.
- **1:1 token to original word.** Rejected. It loses compounds and phrase glosses.
- **Per-translation gloss rows, a generic multi-lexicon table at launch, pre-decoded morphology columns.** Rejected as duplication, mis-keying risk and a wide sparse two-language table respectively.

## Consequences

- With ADR-0002, the hub's address names the scheme it uses. Original-language editions have their own native schemes (Masoretic, Septuagint), which is one more reason the old single-scheme model had to go.
- The validation pass must also check `token.ow_id ∈ interlinear_alignment(token)`, because the head can't be derived from the bare junction.
- "Lemma is the spine" depends on the source supplying a lemma id per occurrence. If it doesn't, `lemma_id` is null and statistics hang off `strong_id` until a lemma source arrives.
- A translation's own inline `\w strong=` tags can't bootstrap the hub. The old prototype found WEB's Hebrew tags systematically shifted. The hub needs a dedicated aligned corpus (`research/interlinear-corpus-sourcing.md`).
- Sourcing and licensing are the open risk, not the schema.

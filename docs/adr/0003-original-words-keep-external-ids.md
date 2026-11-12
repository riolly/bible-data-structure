# Original words keep external ids, split Hebrew into morphemes, and keep the lexicon separable

Status: accepted. Carried from old bible-codex ADR-0007, commit `c2643a2`. Built for WLC and SBLGNT on 2026-11-13, at word grain (amendment below). Alignment is not built.

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

## Amendment: the hub at word grain, from OSHB and MACULA (2026-11-13, plan step 11)

Built for WLC and SBLGNT in `original_word` (`src/ingest/original-words.ts`). Three points change:

1. **Word grain in both languages, not morpheme grain (replaces point 2).** A row is one OSHB `<w>` element or one MACULA Greek word. OSHB mints ids per word, and ADR-0007 already points the qere at them, so a morpheme row would need an id no source gives. A Hebrew word's morphemes stay readable: `lemma` and `morph` keep OSHB's `/` between them (`c/1961`, `HC/Vqw3ms`). Morpheme rows can be added later under the word's id, without changing any `ow_id`, when an alignment source targets morphemes. The Berean tables (plan step 12) tag whole words.
2. **The ids.** Hebrew: OSHB's word id, ketiv and qere words alike, so `reading.ow_ids` resolve. Greek: MACULA's `xml:id` (`n43003016001`), because the SBLGNT has no word ids. `(source, ow_id)` is the key.
3. **Strong's numbers and the gloss on the row (refines points 6 and 8).** `strongs` holds the word's main number (`H7225`, `G3056`), read from OSHB's lemma (its last number, or for a lemma with only prefix letters, MACULA's number for the last letter) or from MACULA Greek. Five Greek compounds have several (`5228+1537+4053`), and two Greek words Strong's dictionary lacks have none (`LUK 3:33` Ἀρνί, `REV 18:13` ἄμωμον). `lemma` stays the source's own. The Hebrew glosses are MACULA Hebrew's, joined verse by verse through the read text, since MACULA follows the qere. A ketiv has no gloss: show its qere's. The `lemma` and `strongs` tables wait until a lexicon arrives.

Where OSHB divides one written word in two for exegesis (12 places, `1CH 15:13`), both rows carry the token's word index. The ingest stops when a verse's words differ between the sources: in count, or in letters once accents, points and case are set aside. One Greek word differs (`JHN 8:5` Μωσῆς, MACULA Μωϋσῆς, from an older SBLGNT commit) and is a counted exception.

`token.ow_id` (point 3) stays null: the hub texts' own tokens are their original words by word index, and translation alignment still waits for a source.

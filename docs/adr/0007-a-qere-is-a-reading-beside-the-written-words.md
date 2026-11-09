# A qere is a reading beside the written words, keyed by a word range

Status: accepted 2026-11-10, from [research/hebrew-ketiv-qere.md](../../research/hebrew-ketiv-qere.md).

In about 1,260 places the Hebrew Bible's written consonants (the ketiv) differ from the word tradition reads aloud (the qere). Translations follow the qere, so an alignment (ADR-0003) needs it. ebible's `hboWLC` dropped it. WLC now comes from upstream OSHB (`openscriptures/morphhb` at `3d15126`), which keeps both, converted by `src/ingest/oshb-xml.ts` the way SBLGNT is.

1. **The ketiv stays in the token stream.** Word indexes count the written words, as before. A manuscript has the ketiv on the line, and keeping it there means no reading can move a word address (ADR-0004).
2. **A qere is a row in `reading`**, beside the tokens: the edition, the verse address, a word range, `kind = 'qere'`, the pointed text and the OSHB ids of its words (`ow_ids`, space-separated, in order). Adding, changing or removing a reading never touches a token.
3. **One row per OSHB variant note, keyed by the half-open range `[word_index, word_index + word_count)`** of the written words the note follows. A note can join or split words: two written words read as one (`1SA 9:1`, מבן ימין read מִבִּנְיָמִין), or one read as two (`2SA 18:20`, על read עַל־כֵּן). The row keeps them together, because the source pairs them as a unit and doesn't say which written word goes with which read word. In the pinned OSHB: 1,212 notes pair one word with one, 16 one with two, 9 two with one, 8 two with two.
4. **A qere with no written word has `word_count` 0.** Its `word_index` is the written word it is read before, or the verse's word count when it comes last (`2SA 8:3`, פְּרָת after the verse's last word). OSHB has 9.
5. **A ketiv with no qere has empty `text` and `ow_ids`.** The word is written and not read (`2KI 5:18`, נא). OSHB has 6.
6. **An alignment to a qere word points at that word's OSHB id**, from `ow_ids`, never at the ketiv's word address. The ketiv tokens keep no OSHB id until the original-word hub (ADR-0003) is built; the hub will hold ketiv and qere words alike.
7. **Readings are left out of the words stamp** (ADR-0005), because they never change what a word address holds. The edition stamp hashes the upstream files, so a changed qere still changes it.
8. **OSHB's paragraph marks** (`<seg type="x-pe">`, `<seg type="x-samekh">`) are written as a standalone `פ` or `ס` with spaces around, so ADR-0004 rule 6 makes them punctuation, as it did in ebible's copy. No tokenizer rule changes.

## Considered options

- **The qere as tokens in the verse, the ketiv as the reading.** Rejected. It would renumber every word after a qere, and the written text is what the codex has.
- **Both as tokens, one flagged.** Rejected. A word index would count words nobody reads, or skip words on the line, depending on the flag.
- **One row per qere word, split from multi-word notes.** Rejected. OSHB doesn't say which written word each read word replaces, and guessing would make up data.
- **A reading anchored on the word before a qere with no ketiv.** Rejected. It breaks at the start of a verse, and "read before word N" works everywhere.

## Migration from ebible's copy

Measured over every verse by `src/ingest/oshb-xml.test.ts` (it runs where the old ebible copy is still unpacked) and against the previous `corpus.db`:

- **The verse list is the same**: 23,213 verses, all under `org`.
- **10 verses get new word addresses.** ebible's copy leaked markup into the 11 words that have a large, small or suspended letter (`DEU 6:4` שְׁמַע, `JDG 18:30` מְנַשֶּׁה): the corpus stored fragments such as `l`, `s` and `H8085` as words. They go away, 77 word addresses in all, and later words in those verses move down.
- **About 3,800 words keep their address and change text.** Where a pashta accent is written twice on a word, the pinned OSHB writes the first one as U+05A8 (the qadma code point, which looks the same) and ebible's copy has U+0599 twice. 11 more words differ in a point or letter, where OSHB corrected the text after ebible copied it, among them `DAN 2:39`, now a ketiv with its qere, and `EZK 4:6`.
- **No word moves because of a ketiv or qere.** One verse changes punctuation only (`PRO 14:31` lost a maqqef).

No outside reference to a WLC word existed yet.

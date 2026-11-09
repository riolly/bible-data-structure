# Hebrew written and read forms (ketiv and qere)

Status: noted 2026-11-09, not decided. Raised in a review of step 3.

## The terms

In about 1,300 places the Hebrew Bible's consonants (the **ketiv**, "what is written") differ from the word tradition reads aloud (the **qere**, "what is read"). Manuscripts keep the written consonants in the line and give the reading in the margin. The vowel points in the line belong to the qere, so a printed ketiv is either unpointed or carries another word's vowels. Translations, KJV and BSB included, almost always follow the qere.

## What the pinned WLC has

ebible's `hboWLC` keeps only the ketiv, unpointed, and drops the qere. GEN 8:17 has `הוצא`, where tradition reads `הַיְצֵא` ("bring out"). In the corpus built on 2026-11-09, 1,336 WLC word tokens in verses have no vowel point or accent (the paragraph marks of ADR-0004 v1.3 not counted), which is about the ketiv count.

Upstream OSHB ([morphhb at `3d15126`][oshb]) keeps both. A ketiv is `<w type="x-ketiv">`, followed by `<note type="variant"><catchWord>…</catchWord><rdg type="x-qere"><w>…</w></rdg></note>` holding the pointed qere with its own lemma, morphology and id. Its `wlc/*.xml` has 1,268 ketiv words and 1,260 qere readings. The counts differ because some readings span several words and some have a reading with no written word.

## Why it matters

- **Alignment (ADR-0003).** English words translate the qere. Aligned to a ketiv-only text, they meet consonants with a different lemma, or no word at all where the qere has a word the ketiv lacks.
- **Word addresses (ADR-0004).** A word index counts the ketiv tokens. If the qere is added later as its own tokens in the same verse, every later index moves. Adding it as a separate layer keyed to the ketiv word does not.
- **Licensing.** OSHB's lemma and morphology are CC BY 4.0 ([licensing.md](licensing.md)). The qere's text is public domain, like the rest of WLC.

## What to decide next

1. Whether WLC moves to upstream OSHB at a pinned commit, as SBLGNT moved to upstream (`src/ingest/sblgnt-xml.ts`). OSHB also marks the paragraph marks as their own elements, 1,181 `<seg type="x-pe">` and 1,981 `<seg type="x-samekh">`, so they would not need ADR-0004 rule 6.
2. How a qere is stored without moving the ketiv's word indexes: a reading layer on the ketiv token, or a second token stream. Decide before any outside reference to a WLC word exists.

[oshb]: https://github.com/openscriptures/morphhb/tree/3d15126fb1ef74867fc1434be1942e837932691f/wlc
